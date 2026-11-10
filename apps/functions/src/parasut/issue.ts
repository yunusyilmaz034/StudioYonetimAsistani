import {
  completeEArchive,
  FirestoreCatalogRepository,
  failEArchive,
  FirestoreFinanceRepository,
  FirestoreInvoiceRepository,
  netUnitPrice,
  serviceLineFor,
  systemClock,
  type Category,
  type EArchiveFailureCode,
  type InvoiceDeps,
  type InvoiceMark,
  type InvoicePolicy,
  type StudioId,
  type SystemJobId,
  type TenantContext,
} from '@studio/core'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import * as logger from 'firebase-functions/logger'

import { systemTenantContext } from '../shared/context'
import {
  activeEDocument,
  contactBody,
  dataId,
  eArchiveBody,
  istanbulDate,
  jobStatus,
  PARASUT_PROD,
  readError,
  salesInvoiceBody,
  type Buyer,
} from './api'
import { credentialsFromEnv, ParasutClient, ParasutHttpError, ParasutNotConnected } from './client'
import { sendPdfMail } from './mail'

// FT-2 · cut ONE e-Arşiv for ONE payment whose request is in flight (OR-132: a human pressed for it).
//
// Re-entrant by design — the trigger runs it the moment the request is made, the 5-minute sweep runs
// it again for anything still pending, and either may be cut short at any line. Every step first asks
// "does this already exist?" and its answer is kept in `eArchiveJobs/{paymentId}` (server-only):
//   1. the sales invoice  — found by OUR requestId, Paraşüt's idempotency key (never made twice)
//   2. the e-Arşiv job    — its id is kept; while it runs, nobody posts a second one
//   3. the e-Arşiv itself — read off the invoice's `active_e_document`, which is the truth
// A lease on the job document keeps the trigger and the sweep from working the same payment at once.

export const E_ARCHIVE_ACTOR = 'e_archive' as SystemJobId
const LEASE_MS = 3 * 60_000
/** Network/5xx trouble this many times in a row → the row says "Kesilemedi" and offers a retry. */
const MAX_TRANSIENT = 5

export type Outcome = 'issued' | 'running' | 'failed' | 'skipped'

interface JobDoc {
  requestId?: string
  leaseUntil?: Timestamp
  salesInvoiceId?: string | null
  jobId?: string | null
  transient?: number
  eArchiveId?: string | null
  pdfSaved?: boolean
  /** The PDF is owed to this address (owner, 2026-11-05). PII — server-only collection. */
  emailTo?: string | null
  documentNo?: string
  emailPending?: boolean
  emailedAt?: Timestamp | null
  emailError?: string | null
}

export const pdfPath = (studioId: string, paymentId: string) => `studios/${studioId}/invoices/${paymentId}.pdf`

export async function processEArchive(database: Firestore, studioId: StudioId, paymentId: string, now: number, f?: typeof fetch): Promise<Outcome> {
  const ctx = systemTenantContext(studioId, E_ARCHIVE_ACTOR)
  const invoices = new FirestoreInvoiceRepository(database)
  const finance = new FirestoreFinanceRepository(database)
  const deps: InvoiceDeps = { repo: finance, invoices, clock: systemClock }
  const mark = await invoices.getInvoiceMark(ctx, paymentId)
  const req = mark?.eArchive
  if (!mark || mark.issued || !req || req.status !== 'pending') return 'skipped'

  const jobRef = database.doc(`studios/${studioId}/eArchiveJobs/${paymentId}`)
  const job = await database.runTransaction(async (tx) => {
    const s = await tx.get(jobRef)
    const d = (s.data() ?? {}) as JobDoc
    if (d.requestId === req.requestId && d.leaseUntil && d.leaseUntil.toMillis() > now) return null
    // A NEW request (after a revert) starts clean; the same request keeps what it learned.
    const next: JobDoc = d.requestId === req.requestId ? { ...d } : { requestId: req.requestId, salesInvoiceId: null, jobId: null, transient: 0, eArchiveId: null, pdfSaved: false }
    next.leaseUntil = Timestamp.fromMillis(now + LEASE_MS)
    tx.set(jobRef, next)
    return next
  })
  if (!job) return 'skipped'
  const save = (patch: Partial<JobDoc>) => jobRef.set(patch, { merge: true })
  const release = () => save({ leaseUntil: Timestamp.fromMillis(0) })
  const fail = async (code: EArchiveFailureCode, message: string): Promise<Outcome> => {
    await failEArchive(deps, ctx, { paymentId, requestId: req.requestId, code, message })
    await save({ jobId: null, transient: 0 })
    await release()
    return 'failed'
  }

  const policy = await invoices.getInvoicePolicy(ctx)
  const credentials = credentialsFromEnv()
  if (!credentials || !policy.parasut.companyId || policy.vatRatePercent === null) {
    return fail('not_connected', 'Paraşüt bağlı değil ya da KDV oranı girilmemiş.')
  }
  const client = new ParasutClient({
    database,
    studioId,
    companyId: policy.parasut.companyId,
    credentials,
    apiBase: policy.parasut.apiBase ?? PARASUT_PROD.apiBase,
    idBase: policy.parasut.idBase ?? PARASUT_PROD.idBase,
    ...(f ? { fetch: f } : {}),
  })

  try {
    // 1 · the sales invoice — ours if it exists, made once if it does not.
    let invoiceId = job.salesInvoiceId ?? (await findByKey(client, req.requestId))
    if (!invoiceId) {
      const made = await createInvoice(client, database, ctx, finance, mark, policy, now)
      if ('fail' in made) return fail(made.fail, made.message)
      invoiceId = made.id
    }
    await save({ salesInvoiceId: invoiceId, transient: 0 })

    // 3 first — the invoice itself says whether the e-Arşiv already exists.
    const done = await readEDocument(client, invoiceId)
    if (done) return finish(deps, ctx, database, client, paymentId, req.requestId, done, save, release, req.emailTo)

    // 2 · the e-Arşiv job.
    let jobId = job.jobId ?? null
    if (!jobId) {
      const payment = await finance.getPayment(ctx, paymentId)
      // An online (PAYTR) sale is an internet sale: the law wants the shop's address on the e-Arşiv.
      const sale = payment?.method === 'online' && policy.internetSaleUrl ? { url: policy.internetSaleUrl, paymentDate: istanbulDate(payment.receivedAt) } : null
      const r = await client.request('POST', 'e_archives', eArchiveBody(invoiceId, sale))
      if (r.status < 200 || r.status >= 300) {
        // A post whose answer was lost on the way may have gone through: Paraşüt then refuses the
        // second one. The invoice is the truth — if it already carries the e-Arşiv, we are done.
        const already = await readEDocument(client, invoiceId)
        if (already) return finish(deps, ctx, database, client, paymentId, req.requestId, already, save, release, req.emailTo)
        throw new ParasutHttpError(r.status, r.body)
      }
      jobId = dataId(r.body)
      await save({ jobId })
    }
    for (let i = 0; i < 6 && jobId; i++) {
      const st = jobStatus(await client.ok('GET', `trackable_jobs/${jobId}`))
      if (st.status === 'error') return fail('rejected', st.errors.join(' · ') || 'Paraşüt e-Arşiv işini reddetti.')
      if (st.status === 'done') {
        const doc = await readEDocument(client, invoiceId)
        if (doc) return finish(deps, ctx, database, client, paymentId, req.requestId, doc, save, release, req.emailTo)
      }
      await new Promise((r) => setTimeout(r, 3_000))
    }
    await release()
    return 'running'
  } catch (e) {
    if (e instanceof ParasutNotConnected) return fail('not_connected', 'Paraşüt bağlantısı düştü. Belge ayarlarından yeniden bağlanın.')
    if (e instanceof ParasutHttpError && e.rejected) return fail('rejected', readError(e.body).message)
    const transient = (job.transient ?? 0) + 1
    logger.warn('e-archive: transient error', { studioId, paymentId, transient, error: (e as Error)?.message })
    if (transient >= MAX_TRANSIENT) return fail('provider_error', 'Paraşüt şu an yanıt vermiyor. Biraz sonra tekrar deneyin.')
    await save({ transient })
    await release()
    return 'running'
  }
}

async function findByKey(client: ParasutClient, key: string): Promise<string | null> {
  const r = await client.request('GET', `sales_invoices/find_by_external_reference_key?external_reference_key=${encodeURIComponent(key)}`)
  if (r.status === 404) return null
  if (r.status < 200 || r.status >= 300) throw new ParasutHttpError(r.status, r.body)
  return dataId(r.body)
}

async function readEDocument(client: ParasutClient, invoiceId: string) {
  const doc = activeEDocument(await client.ok('GET', `sales_invoices/${invoiceId}?include=active_e_document`))
  if (!doc) return null
  if (doc.type !== 'e_archives') return { ...doc, wrongType: true as const }
  return { ...doc, wrongType: false as const }
}

async function finish(
  deps: InvoiceDeps,
  ctx: TenantContext,
  database: Firestore,
  client: ParasutClient,
  paymentId: string,
  requestId: string,
  doc: { id: string; invoiceNumber: string | null; wrongType: boolean },
  save: (p: Partial<JobDoc>) => Promise<unknown>,
  release: () => Promise<unknown>,
  emailTo: string | null,
): Promise<Outcome> {
  if (doc.wrongType) {
    // Someone formalised it as an e-Fatura in the Paraşüt panel. Real, but not what was asked: say so.
    await failEArchive(deps, ctx, { paymentId, requestId, code: 'rejected', message: 'Bu fatura Paraşüt’te e-Fatura olarak resmileşmiş; elle işaretleyin.' })
    await release()
    return 'failed'
  }
  let number = doc.invoiceNumber
  if (!number) {
    const a = (await client.ok('GET', `e_archives/${doc.id}`)) as { data?: { attributes?: { invoice_number?: string } } }
    number = a.data?.attributes?.invoice_number ?? ''
  }
  await completeEArchive(deps, ctx, { paymentId, requestId, documentNo: number })
  await save({ eArchiveId: doc.id, jobId: null, documentNo: number, pdfSaved: false, emailTo, emailPending: emailTo !== null, emailedAt: null, emailError: null })
  await followUp(database, ctx.studioId, client, paymentId)
  await release()
  return 'issued'
}

/**
 * After the invoice exists: keep our copy of the PDF, then e-mail it if asked. Both may lag (Paraşüt
 * renders the PDF a little after GİB accepts), so the 5-minute sweep calls this again for any job that
 * still owes either — the mark is already issued by then and would never be picked up as "pending".
 */
export async function followUp(database: Firestore, studioId: StudioId, client: ParasutClient, paymentId: string): Promise<void> {
  const ref = database.doc(`studios/${studioId}/eArchiveJobs/${paymentId}`)
  const job = ((await ref.get()).data() ?? {}) as JobDoc
  const save = (patch: Partial<JobDoc>) => ref.set(patch, { merge: true })
  if (!job.eArchiveId) return
  if (!job.pdfSaved) {
    try {
      await savePdf(client, studioId, paymentId, job.eArchiveId, save)
    } catch (e) {
      logger.warn('e-archive: pdf not saved yet', { studioId, paymentId, error: (e as Error)?.message })
      return
    }
  }
  if (job.emailPending && job.emailTo) {
    const [pdf] = await getStorage().bucket().file(pdfPath(studioId, paymentId)).download()
    const studio = await database.doc(`studios/${studioId}/settings/studio`).get()
    const r = await sendPdfMail({
      to: job.emailTo,
      requestId: job.requestId ?? paymentId,
      documentNo: job.documentNo ?? '',
      studioName: (studio.get('company.displayName') as string | undefined) ?? null,
      pdf,
    })
    if (r.ok) await save({ emailPending: false, emailedAt: Timestamp.now(), emailError: null })
    else {
      logger.warn('e-archive: pdf e-mail failed', { studioId, paymentId, permanent: r.permanent, error: r.message })
      await save(r.permanent ? { emailPending: false, emailError: r.message } : { emailError: r.message })
    }
  }
}

/** Paraşüt hands out a short-lived PDF link; we keep our own copy so the row's PDF never expires. */
export async function savePdf(
  client: ParasutClient,
  studioId: string,
  paymentId: string,
  eArchiveId: string,
  save: (p: Partial<JobDoc>) => Promise<unknown>,
): Promise<void> {
  const r = await client.request('GET', `e_archives/${eArchiveId}/pdf`)
  const url = (r.body as { data?: { attributes?: { url?: string } } } | null)?.data?.attributes?.url
  if (r.status !== 200 || !url) throw new Error(`pdf not ready (${r.status})`)
  const pdf = await fetch(url)
  if (!pdf.ok) throw new Error(`pdf download ${pdf.status}`)
  await getStorage().bucket().file(pdfPath(studioId, paymentId)).save(Buffer.from(await pdf.arrayBuffer()), { contentType: 'application/pdf' })
  await save({ pdfSaved: true })
}

async function createInvoice(
  client: ParasutClient,
  database: Firestore,
  ctx: TenantContext,
  finance: FirestoreFinanceRepository,
  mark: InvoiceMark,
  policy: InvoicePolicy,
  now: number,
): Promise<{ id: string } | { fail: EArchiveFailureCode; message: string }> {
  const req = mark.eArchive!
  // A PEŞİN invoice needs the Paraşüt account the money went into — checked before anything is made
  // on Paraşüt's side, so a missing setting leaves no orphan contact behind.
  const payment = await finance.getPayment(ctx, mark.paymentId)
  const accountId = payment ? policy.parasut.accountByMethod[payment.method] : undefined
  if (!payment || !accountId) {
    return { fail: 'not_connected', message: 'Bu ödeme yöntemi için Paraşüt hesabı seçilmemiş (Ayarlar → Fatura → Paraşüt hesapları).' }
  }
  const member = await database.doc(`studios/${ctx.studioId}/members/${mark.memberId}`).get()
  const tc = member.get('nationalId')
  const buyer: Buyer = {
    name: String(member.get('fullName') ?? 'Nihai Tüketici'),
    nationalId: typeof tc === 'string' && /^\d{11}$/.test(tc) && tc !== '11111111111' ? tc : null,
    // The studio's il/ilçe for every buyer (owner, 2026-11-05: "sadece il ilçe … kocaeli çayırova").
    city: policy.buyerCity,
    district: policy.buyerDistrict,
  }

  // A buyer registered for e-Fatura must get an e-Fatura, not an e-Arşiv — out of scope (panel).
  if (buyer.nationalId) {
    const inbox = (await client.ok('GET', `e_invoice_inboxes?filter[vkn]=${buyer.nationalId}`)) as { data?: unknown[] }
    if (Array.isArray(inbox.data) && inbox.data.length > 0) {
      return { fail: 'buyer_is_e_invoice_user', message: 'Alıcı e-Fatura mükellefi: faturayı Paraşüt panelinden e-Fatura olarak kesin.' }
    }
  }

  let contactId: string | null = null
  if (buyer.nationalId) {
    const found = (await client.ok('GET', `contacts?filter[tax_number]=${buyer.nationalId}&page[size]=1`)) as { data?: { id?: string }[] }
    contactId = found.data?.[0]?.id ? String(found.data[0].id) : null
  }
  if (!contactId) contactId = dataId(await client.ok('POST', 'contacts', contactBody(buyer)))
  if (!contactId) throw new Error('contact id missing')

  const categories = await saleCategories(database, finance, ctx, mark)
  const body = salesInvoiceBody(
    {
      requestId: req.requestId,
      issueDate: istanbulDate(now),
      serviceLine: serviceLineFor(policy, categories),
      city: policy.buyerCity,
      district: policy.buyerDistrict,
      netUnitPrice: netUnitPrice(req.invoicedAmount.amount, policy.vatRatePercent!),
      vatRatePercent: policy.vatRatePercent!,
      description: `Tahsilat ${mark.paymentId}`,
      cashSale: { accountId, paymentDate: istanbulDate(payment.receivedAt) },
    },
    contactId,
  )
  const r = await client.request('POST', 'sales_invoices', body)
  if (r.status >= 200 && r.status < 300) {
    const id = dataId(r.body)
    if (!id) throw new Error('sales invoice id missing')
    return { id }
  }
  // The key was used already — a previous attempt got this far. That invoice is ours.
  const existing = readError(r.body).existingSalesInvoiceId
  if (r.status === 422 && existing) return { id: existing }
  throw new ParasutHttpError(r.status, r.body)
}

/**
 * What the payment paid for — its CATEGORY, never the package (owner, 2026-11-05). Best effort: a
 * payment that bought nothing from the catalogue gets the fallback line.
 */
async function saleCategories(database: Firestore, finance: FirestoreFinanceRepository, ctx: TenantContext, mark: InvoiceMark): Promise<Category[]> {
  try {
    const catalog = new FirestoreCatalogRepository(database)
    const allocs = (await finance.listAllocationsByMember(ctx, mark.memberId)).filter((a) => a.paymentId === mark.paymentId)
    const sales = await Promise.all([...new Set(allocs.map((a) => a.saleId))].map((id) => finance.getSale(ctx, id)))
    const productIds = [...new Set(sales.flatMap((s) => (s ? s.lines.map((l) => l.productId).filter((x) => x !== null) : [])))]
    const products = await Promise.all(productIds.map((id) => catalog.getProduct(ctx, id)))
    return products.flatMap((p) => (p ? [p.category] : []))
  } catch {
    return []
  }
}
