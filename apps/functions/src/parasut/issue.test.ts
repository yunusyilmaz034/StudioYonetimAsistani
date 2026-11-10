import { decideRequestEArchive, DEFAULT_INVOICE_POLICY, instant, money, type BranchId, type CorrelationId, type MemberId, type Payment, type StaffUserId, type StudioId } from '@studio/core'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activeEDocument, contactBody, eArchiveBody, exactProduct, readError, salesInvoiceBody, UNKNOWN_TC } from './api'
import { seal, unseal } from './client'
import { processEArchive } from './issue'

const saved: string[] = []
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ file: (p: string) => ({ save: async () => void saved.push(p), download: async () => [Buffer.from('%PDF')] }) }),
  }),
}))
const mails: { to: string[]; attachments: { filename: string }[]; key: string }[] = []

// ── a Firestore small enough to read: paths → plain objects ─────────────────────────────────────
type Data = Record<string, unknown>
function fakeDb() {
  const store = new Map<string, Data>()
  const get = (o: Data, path: string) => path.split('.').reduce<unknown>((v, k) => (v as Data | undefined)?.[k], o)
  const snap = (path: string) => {
    const d = store.get(path)
    return { exists: d !== undefined, id: path.split('/').pop()!, data: () => (d ? { ...d } : undefined), get: (f: string) => (d ? get(d, f) : undefined) }
  }
  const ref = (path: string): Data => ({
    path,
    id: path.split('/').pop(),
    get: async () => snap(path),
    set: async (data: Data, o?: { merge?: boolean }) => void store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data }),
    delete: async () => void store.delete(path),
    collection: (c: string) => col(`${path}/${c}`),
  })
  const col = (path: string): Data => {
    const query = (filters: [string, unknown][]) => ({
      where: (f: string, _op: string, v: unknown) => query([...filters, [f, v]]),
      limit: () => query(filters),
      get: async () => ({
        docs: [...store.keys()]
          .filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
          .filter((k) => filters.every(([f, v]) => get(store.get(k)!, f) === v))
          .map(snap),
      }),
    })
    return { doc: (id: string) => ref(`${path}/${id}`), ...query([]) }
  }
  const database = {
    doc: (p: string) => ref(p),
    collection: (c: string) => col(c),
    getAll: async (...refs: Data[]) => refs.map((r) => snap(String(r.path))),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({ get: (r: Data) => (r.get as () => Promise<unknown>)(), set: (r: Data, d: Data, o?: { merge?: boolean }) => (r.set as (d: Data, o?: unknown) => Promise<void>)(d, o) }),
  }
  return { database: database as unknown as Firestore, store }
}

// ── a Paraşüt that remembers what it was asked ───────────────────────────────────────────────────
function fakeParasut(opts: { failEArchivePostOnce?: boolean; rejectInvoice?: boolean; products?: { id: string; name: string }[] } = {}) {
  const calls: string[] = []
  const invoices = new Map<string, { id: string; eDoc: string | null }>()
  const products: { id: string; name: string }[] = [...(opts.products ?? [])]
  let failNext = opts.failEArchivePostOnce ?? false
  let jobPolls = 0
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status })
  const f = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const m = init?.method ?? 'GET'
    const p = u.pathname.replace(/^\/v4\/115\//, '')
    calls.push(`${m} ${p}`)
    if (u.pathname.endsWith('/token')) return json(200, { access_token: 'acc', refresh_token: 'rot' })
    if (p === 'sales_invoices/find_by_external_reference_key') {
      const inv = invoices.get(u.searchParams.get('external_reference_key')!)
      return inv ? json(200, { data: { id: inv.id } }) : json(404, null)
    }
    if (m === 'POST' && p === 'contacts') return json(201, { data: { id: 'c1' } })
    if (m === 'GET' && p === 'products') return json(200, { data: products.map((x) => ({ id: x.id, attributes: { name: x.name, archived: false } })) })
    if (m === 'POST' && p === 'products') {
      const name = (JSON.parse(String(init!.body)) as { data: { attributes: { name: string } } }).data.attributes.name
      products.push({ id: `pr${products.length + 1}`, name })
      return json(201, { data: { id: `pr${products.length}` } })
    }
    if (m === 'POST' && p === 'sales_invoices') {
      if (opts.rejectInvoice) return json(422, { errors: [{ title: 'Geçersiz', detail: 'KDV oranı geçersiz' }] })
      const key = (JSON.parse(String(init!.body)) as { data: { relationships: { external_reference_key: { data: { attributes: { key: string } } } } } }).data.relationships.external_reference_key.data.attributes.key
      const existing = invoices.get(key)
      if (existing) return json(422, { errors: [{ detail: 'Bu key ile daha önce bir fatura oluşturulmuş.', meta: { sales_invoice_id: existing.id } }] })
      const id = `si${invoices.size + 1}`
      invoices.set(key, { id, eDoc: null })
      return json(201, { data: { id } })
    }
    if (m === 'GET' && /^sales_invoices\/si\d+$/.test(p)) {
      const inv = [...invoices.values()].find((x) => x.id === p.split('/')[1])!
      return json(200, {
        data: { id: inv.id, relationships: { active_e_document: { data: inv.eDoc ? { id: inv.eDoc, type: 'e_archives' } : null } } },
        included: inv.eDoc ? [{ id: inv.eDoc, type: 'e_archives', attributes: { invoice_number: 'RTA2026000000118' } }] : [],
      })
    }
    if (m === 'POST' && p === 'e_archives') {
      if (failNext) {
        failNext = false
        throw new Error('ECONNRESET')
      }
      const sid = (JSON.parse(String(init!.body)) as { data: { relationships: { sales_invoice: { data: { id: string } } } } }).data.relationships.sales_invoice.data.id
      ;[...invoices.values()].find((x) => x.id === sid)!.eDoc = 'ea1'
      return json(202, { data: { id: 'job1' } })
    }
    if (p === 'trackable_jobs/job1') return json(200, { data: { attributes: { status: jobPolls++ >= 0 ? 'done' : 'running' } } })
    if (p === 'e_archives/ea1/pdf') return json(200, { data: { attributes: { url: 'https://cdn.parasut.test/x.pdf' } } })
    if (p.startsWith('e_invoice_inboxes')) return json(200, { data: [] })
    if (p.startsWith('contacts')) return json(200, { data: [] })
    return json(500, { errors: [{ detail: `unexpected ${m} ${p}` }] })
  }) as unknown as typeof fetch
  return { f, calls, invoices, products }
}

const SID = 'retro' as StudioId
const ctx = { studioId: SID, actor: { type: 'owner' as const, id: 'usr_owner' as StaffUserId }, now: instant(1_793_800_000_000), correlationId: 'cor' as CorrelationId, source: 'reception_web' as const }
const payment = {
  id: 'pay_1', studioId: SID, branchId: 'br_1' as BranchId, memberId: 'mem_1' as MemberId, amount: money(400_000), method: 'bank_transfer',
  receivedAt: instant(1_793_700_000_000), takenBy: { type: 'owner', id: 'usr_owner' }, drawerId: null, providerRef: null, giftCardId: null,
  allocated: money(400_000), voided: false, voidReason: null, note: null,
} as Payment
const KEY = '0b8f4a1e-3c55-4c1e-9a62-2f8d7c9e5a10'
const policy = { ...DEFAULT_INVOICE_POLICY, vatRatePercent: 20, parasut: { ...DEFAULT_INVOICE_POLICY.parasut, companyId: '115', apiBase: 'https://api.parasut.test/v4', idBase: 'https://id.parasut.test/oidc', accountByMethod: { bank_transfer: '4242', online: '4243', cash: '4244' } } }
const creds = { clientId: 'cid', clientSecret: 'secret' }

function seed(emailTo: string | null = null) {
  const { database, store } = fakeDb()
  store.set(`studios/${SID}/payments/pay_1`, { ...payment, receivedAt: Timestamp.fromMillis(payment.receivedAt) })
  store.set(`studios/${SID}/members/mem_1`, { fullName: 'Ayşe Demir', nationalId: null })
  store.set(`studios/${SID}/settings/invoicing`, policy)
  store.set(`studios/${SID}/secrets/parasut`, { refreshToken: seal(creds, 'refresh-1') })
  const r = decideRequestEArchive(ctx, payment, null, policy, 400_000, KEY, emailTo)
  if (!r.ok) throw new Error('setup')
  const e = r.value.next.eArchive!
  store.set(`studios/${SID}/invoiceMarks/pay_1`, { ...r.value.next, issuedAt: null, eArchive: { ...e, requestedAt: Timestamp.fromMillis(e.requestedAt) } })
  return { database, store }
}
const mark = (store: Map<string, Data>) => store.get(`studios/${SID}/invoiceMarks/pay_1`)!
const events = (store: Map<string, Data>) => [...store.entries()].filter(([k]) => k.startsWith(`studios/${SID}/events/`)).map(([, v]) => v)

beforeEach(() => {
  saved.length = 0
  process.env.PARASUT_CLIENT_ID = creds.clientId
  process.env.PARASUT_CLIENT_SECRET = creds.clientSecret
  mails.length = 0
  process.env.RESEND_API_KEY = 're_test'
  process.env.EMAIL_FROM = 'Stüdyo <bildirim@ornek.com>'
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('resend.com')) {
      const b = JSON.parse(String(init!.body)) as { to: string[]; attachments: { filename: string }[] }
      mails.push({ ...b, key: String((init!.headers as Record<string, string>)['Idempotency-Key']) })
      return new Response('{"id":"m1"}', { status: 200 })
    }
    return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })
  })
  vi.useFakeTimers({ toFake: ['setTimeout'] })
})

const run = async (database: Firestore, f: typeof fetch, now: number) => {
  const p = processEArchive(database, SID, 'pay_1', now, f)
  await vi.runAllTimersAsync()
  return p
}

describe('processEArchive — one payment, one e-Arşiv', () => {
  it('cuts it: unlisted contact (no TC), invoice under OUR key, e-Arşiv, number on the row, PDF kept', async () => {
    const { database, store } = seed()
    const p = fakeParasut()
    expect(await run(database, p.f, ctx.now + 1000)).toBe('issued')
    expect(mark(store)).toMatchObject({ issued: true, document: 'e_archive', provider: 'parasut', documentNo: 'RTA2026000000118', eArchive: null })
    expect(p.invoices.has(KEY)).toBe(true)
    // the line stands on a product card, made once for the service line
    expect(p.products.map((x) => x.name)).toEqual(['Hizmet bedeli'])
    expect(events(store).map((e) => e.type)).toEqual(['invoice.issued'])
    expect(saved).toEqual([`studios/${SID}/invoices/pay_1.pdf`])
    // the refresh token rotated, and what is stored is ciphertext
    const sealed = String(store.get(`studios/${SID}/secrets/parasut`)!.refreshToken)
    expect(sealed).not.toContain('rot')
    expect(unseal(creds, sealed)).toBe('rot')
  })

  it('an existing product card with that name is used, not a second one', async () => {
    const { database } = seed()
    const p = fakeParasut({ products: [{ id: 'pr9', name: 'Hizmet bedeli' }] })
    expect(await run(database, p.f, ctx.now + 1000)).toBe('issued')
    expect(p.calls.filter((c) => c === 'POST products')).toEqual([])
    expect(p.products).toHaveLength(1)
  })
  it('a line names its product card; a card is found by its exact name only', () => {
    const b = salesInvoiceBody({ requestId: KEY, issueDate: '2026-11-10', serviceLine: 'Fitness', netUnitPrice: 1, vatRatePercent: 20, description: 'x', city: null, district: null, cashSale: { accountId: '1', paymentDate: '2026-11-10' }, productId: 'pr7' }, 'c1')
    expect(b.data.relationships.details.data[0]!.relationships).toEqual({ product: { data: { id: 'pr7', type: 'products' } } })
    expect(exactProduct({ data: [{ id: '1', attributes: { name: 'Pilates Reformer' } }, { id: '2', attributes: { name: 'pilates', archived: true } }, { id: '3', attributes: { name: 'Pilates ' } }] }, 'Pilates')).toBe('3')
    expect(exactProduct({ data: [] }, 'Pilates')).toBe(null)
  })

  it('asked for it → the PDF goes to that address, once, with the e-Arşiv number', async () => {
    const { database, store } = seed('uye@ornek.com')
    expect(await run(database, fakeParasut().f, ctx.now + 1000)).toBe('issued')
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ to: ['uye@ornek.com'], key: `e-archive-pdf-${KEY}`, attachments: [{ filename: 'RTA2026000000118.pdf' }] })
    expect(store.get(`studios/${SID}/eArchiveJobs/pay_1`)).toMatchObject({ emailPending: false, pdfSaved: true })
    expect(mark(store).emailTo).toBe('uye@ornek.com')
    expect(JSON.stringify(events(store))).not.toContain('ornek.com')
  })

  it('not asked → no e-mail', async () => {
    const { database } = seed()
    await run(database, fakeParasut().f, ctx.now + 1000)
    expect(mails).toHaveLength(0)
  })

  it('a crash after the invoice was made never makes a second one', async () => {
    const { database, store } = seed()
    const p = fakeParasut({ failEArchivePostOnce: true })
    expect(await run(database, p.f, ctx.now + 1000)).toBe('running') // network died on the e-Arşiv post
    expect(mark(store).issued).toBe(false)
    // the sweep, after the lease ran out
    expect(await run(database, p.f, ctx.now + 5 * 60_000)).toBe('issued')
    expect(p.calls.filter((c) => c === 'POST sales_invoices')).toHaveLength(1)
  })

  it('even if our own bookkeeping was lost, the key finds the invoice Paraşüt already has', async () => {
    const { database, store } = seed()
    const p = fakeParasut({ failEArchivePostOnce: true })
    await run(database, p.f, ctx.now + 1000)
    store.delete(`studios/${SID}/eArchiveJobs/pay_1`)
    expect(await run(database, p.f, ctx.now + 5 * 60_000)).toBe('issued')
    expect(p.calls.filter((c) => c === 'POST sales_invoices')).toHaveLength(1)
    expect(p.calls).toContain('GET sales_invoices/find_by_external_reference_key')
  })

  it('a second worker on the same payment, while the first holds it, does nothing', async () => {
    const { database, store } = seed()
    store.set(`studios/${SID}/eArchiveJobs/pay_1`, { requestId: KEY, leaseUntil: Timestamp.fromMillis(ctx.now + 60_000) })
    const p = fakeParasut()
    expect(await run(database, p.f, ctx.now + 1000)).toBe('skipped')
    expect(p.calls).toEqual([])
  })

  it('Paraşüt says no → "Kesilemedi" with its sentence on the row, a closed code in the log', async () => {
    const { database, store } = seed()
    const p = fakeParasut({ rejectInvoice: true })
    expect(await run(database, p.f, ctx.now + 1000)).toBe('failed')
    expect(mark(store).eArchive).toMatchObject({ status: 'failed', error: 'KDV oranı geçersiz' })
    expect(events(store).map((e) => [e.type, (e.payload as Data).code])).toEqual([['invoice.e_archive_failed', 'rejected']])
  })

  it('no Paraşüt keys yet → "not_connected", nothing sent anywhere', async () => {
    delete process.env.PARASUT_CLIENT_SECRET
    const { database, store } = seed()
    const p = fakeParasut()
    expect(await run(database, p.f, ctx.now + 1000)).toBe('failed')
    expect(p.calls).toEqual([])
    expect(events(store).map((e) => (e.payload as Data).code)).toEqual(['not_connected'])
  })

  it('no Paraşüt account for the method → refused before anything is made on Paraşüt', async () => {
    const { database, store } = seed()
    store.set(`studios/${SID}/settings/invoicing`, { ...policy, parasut: { ...policy.parasut, accountByMethod: { cash: '4244' } } })
    const p = fakeParasut()
    expect(await run(database, p.f, ctx.now + 1000)).toBe('failed')
    expect(p.calls.filter((c) => /POST (contacts|sales_invoices)/.test(c))).toEqual([])
    expect(events(store).map((e) => (e.payload as Data).code)).toEqual(['not_connected'])
    expect(String((mark(store).eArchive as Data).error)).toContain('Paraşüt hesabı seçilmemiş')
  })

  it('an already settled mark is left alone', async () => {
    const { database, store } = seed()
    store.set(`studios/${SID}/invoiceMarks/pay_1`, { ...mark(store), eArchive: null })
    const p = fakeParasut()
    expect(await run(database, p.f, ctx.now + 1000)).toBe('skipped')
  })
})

describe('Paraşüt bodies and readers', () => {
  it('a buyer without a TC goes in with eleven ones, unlisted; with a TC, listed', () => {
    expect(contactBody({ name: 'Ayşe', nationalId: null, city: null, district: null }).data.attributes).toMatchObject({ tax_number: UNKNOWN_TC, untrackable: true, contact_type: 'person' })
    expect(contactBody({ name: 'Ayşe', nationalId: '10000000146', city: null, district: null }).data.attributes).toMatchObject({ tax_number: '10000000146', untrackable: false })
  })
  it('the sales invoice carries our key, one line, the net price', () => {
    const b = salesInvoiceBody({ requestId: KEY, issueDate: '2026-11-05', serviceLine: 'Pilates hizmeti', netUnitPrice: 3333.333333, vatRatePercent: 20, description: 'Tahsilat pay_1', city: 'Kocaeli', district: 'Çayırova', cashSale: { accountId: '4242', paymentDate: '2026-11-04' }, productId: 'pr1' }, 'c1')
    expect(b.data.relationships.external_reference_key.data.attributes.key).toBe(KEY)
    expect(b.data.relationships.details.data[0]!.attributes).toEqual({ quantity: 1, unit_price: 3333.333333, vat_rate: 20, description: 'Pilates hizmeti' })
    expect(b.data.attributes).toMatchObject({ city: 'Kocaeli', district: 'Çayırova' })
  })
  it('every invoice is PEŞİN: paid into the method\'s Paraşüt account on the day the money came', () => {
    // Paraşüt, first live attempt (2026-11-10): "Cari takibi yapılmayan müşteriye sadece peşin fatura kesilebilir."
    const b = salesInvoiceBody({ requestId: KEY, issueDate: '2026-11-10', serviceLine: 'Fitness', netUnitPrice: 1, vatRatePercent: 20, description: 'Tahsilat pay_1', city: null, district: null, cashSale: { accountId: '4242', paymentDate: '2026-11-09' }, productId: 'pr1' }, 'c1')
    expect(b.data.attributes).toMatchObject({ cash_sale: true, payment_account_id: 4242, payment_date: '2026-11-09' })
  })
  it('an online sale names PayTR as the payment intermediary', () => {
    expect(eArchiveBody('si1', { url: 'https://x.com', paymentDate: '2026-11-05' }).data.attributes).toEqual({ internet_sale: { url: 'https://x.com', payment_type: 'ODEMEARACISI', payment_platform: 'PayTR', payment_date: '2026-11-05' } })
    expect(eArchiveBody('si1', null).data.attributes).toEqual({})
  })
  it('reads the existing invoice off a key-repeat error, and the e-document off include', () => {
    expect(readError({ errors: [{ detail: 'Bu key ile daha önce bir fatura oluşturulmuş.', meta: { sales_invoice_id: 77 } }] })).toEqual({ message: 'Bu key ile daha önce bir fatura oluşturulmuş.', existingSalesInvoiceId: '77' })
    expect(activeEDocument({ data: { relationships: { active_e_document: { data: null } } } })).toBe(null)
  })
})
