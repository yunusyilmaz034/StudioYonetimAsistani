// v1.24 Finance & CRM — proven end to end against the emulator.
//
// What must be true:
//   • the cari hesap is DERIVED: sell 5.000, pay 2.000 → owes 3.000. Nothing is a stored balance.
//   • partial payment settles the oldest debt first, and the surplus stays as member credit (I-33)
//   • a payment is never mutated — a void is a movement, and it un-pays the sale it settled (I-31)
//   • a gift card is never spent below zero (I-35)
//   • a kasa discrepancy is RECORDED, and the domain refuses to close without an explanation
//   • the sale, its payment and its allocation share ONE OperationId (OP-2) → one act in the feed
//   • a lead's name and phone NEVER enter the event log (#6)
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  closeDrawer,
  collect,
  decideCaptureLead,
  decideConvertLead,
  FirestoreCrmRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  instant,
  issueGiftCard,
  loadMemberAccount,
  money,
  newOperationId,
  openDrawer,
  saleBalanceDue,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type CashDrawer,
  type FinanceDeps,
  type GiftCard,
  type Lead,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const SID = 'std_demo' as StudioId
const BRANCH = 'brn_demo' as BranchId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'owner',
  actor: { type: 'owner', id: 'usr_verify' as never },
}

const fin: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
const crm = new FirestoreCrmRepository(db)
const members = new FirestoreMemberRepository(db)

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

const eventsOf = async (correlationId: string): Promise<readonly string[]> => {
  const snap = await db.collection(`studios/${SID}/events`).where('correlationId', '==', correlationId).get()
  return snap.docs.map((d) => d.data().type as string)
}

async function main(): Promise<void> {
  const all = await members.list(ctx)
  const member = all[0]!
  const uniq = String(Date.now()).slice(-6)

  // ── 1. SELL 5.000 ₺, collect nothing. Selling without collecting is legal here. ────────────
  const sold = await sell(fin, ctx, {
    saleId: `sal_v124_${uniq}`,
    memberId: member.id,
    branchId: BRANCH,
    lines: [
      {
        productId: null,
        description: 'Reformer 8 Ders',
        quantity: 1,
        unitPrice: money(500_000),
        entitlementId: null,
        giftCardId: null,
      },
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: null,
  })
  ok('Satış oluşturuldu (tahsilatsız — bu yasal)', sold.ok)
  if (!sold.ok) throw new Error('sell failed')

  const afterSale = await loadMemberAccount(fin, ctx, member.id)
  const openBefore = afterSale.openSales.find((s) => s.id === sold.value.saleId)!
  ok('Cari hesap borcu gösteriyor', saleBalanceDue(openBefore) === 500_000, tl(saleBalanceDue(openBefore)))

  // Oldest debt first — deterministic, and the only order that does not surprise a member reading
  // her own statement. On a re-run this may be a sale from an earlier run, and that is the POINT.
  const oldest = [...afterSale.openSales].sort((a, b) => a.soldAt - b.soldAt)[0]!
  const oldestDueBefore = saleBalanceDue(oldest)

  // ── 2. KISMİ ÖDEME — 2.000 ₺, allocated oldest-first. ──────────────────────────────────────
  const balanceBefore = afterSale.balanceKurus
  const partial = await collect(fin, ctx, {
    paymentId: `pay_v124a_${uniq}`,
    memberId: member.id,
    branchId: BRANCH,
    amount: money(200_000),
    method: 'bank_transfer',
    receivedAt: instant(Date.now()),
    drawerId: null,
    giftCardCode: null,
    note: 'Kısmi ödeme',
  })
  ok('Kısmi ödeme alındı', partial.ok)
  if (!partial.ok) throw new Error('collect failed')

  const afterPartial = await loadMemberAccount(fin, ctx, member.id)
  const oldestAfter = afterPartial.sales.find((s) => s.id === oldest.id)!
  ok(
    'Ödeme EN ESKİ borca mahsup edildi',
    saleBalanceDue(oldestAfter) === Math.max(0, oldestDueBefore - 200_000),
    `${tl(oldestDueBefore)} → ${tl(saleBalanceDue(oldestAfter))}`,
  )
  ok(
    'Cari hesap TÜRETİLİYOR (saklanan bakiye yok): borç 2.000 ₺ azaldı',
    afterPartial.balanceKurus === balanceBefore - 200_000,
    `${tl(balanceBefore)} → ${tl(afterPartial.balanceKurus)}`,
  )

  // ── 3. VOID — a payment is never mutated; the void un-pays the sale (I-31). ────────────────
  const voided = await voidPayment(fin, ctx, {
    paymentId: partial.value.paymentId,
    reason: 'Yanlış üyeye işlendi',
  })
  ok('Tahsilat void edildi (silinmedi)', voided.ok)

  const afterVoid = await loadMemberAccount(fin, ctx, member.id)
  const saleAfterVoid = afterVoid.sales.find((s) => s.id === oldest.id)!
  const paymentRow = afterVoid.payments.find((p) => p.id === partial.value.paymentId)!
  // Money is an object in the model (#10) — comparing it to a number is how a figure silently reads
  // as "not equal" forever.
  ok(
    'I-31: ödeme kaydı duruyor, tutarı değişmedi (void bir hareket, silme değil)',
    paymentRow.amount.amount === 200_000 && paymentRow.voided,
    `${tl(paymentRow.amount.amount)} · voided=${paymentRow.voided}`,
  )
  ok(
    'Void, satışın ödemesini GERİ ALDI — borç eski haline döndü',
    saleBalanceDue(saleAfterVoid) === oldestDueBefore,
    `${tl(saleBalanceDue(saleAfterVoid))} (önce ${tl(oldestDueBefore)})`,
  )

  // ── 4. KASA — açılış, nakit tahsilat, gün sonu farkı. ──────────────────────────────────────
  const drawerId = `drw_v124_${uniq}`
  const drawer: CashDrawer = {
    id: drawerId,
    studioId: SID,
    branchId: BRANCH,
    name: 'Doğrulama Kasası',
    kind: 'cash',
    status: 'closed',
    openingFloat: money(0),
    expected: money(0),
    openedAt: null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    countedAmount: null,
    discrepancy: null,
    closeNote: null,
  }
  await db.doc(`studios/${SID}/cashDrawers/${drawerId}`).set({
    ...drawer,
    openedAt: null,
    closedAt: null,
  })

  ok('Kasa açıldı', (await openDrawer(fin, ctx, { drawerId, openingFloat: money(50_000) })).ok)

  const cash = await collect(fin, ctx, {
    paymentId: `pay_v124b_${uniq}`,
    memberId: member.id,
    branchId: BRANCH,
    amount: money(300_000),
    method: 'cash',
    receivedAt: instant(Date.now()),
    drawerId,
    giftCardCode: null,
    note: null,
  })
  ok('Nakit tahsilat kasaya işlendi', cash.ok)

  const drawerNow = await fin.repo.getDrawer(ctx, drawerId)
  ok(
    'Kasanın beklenen bakiyesi para ile birlikte hareket etti',
    drawerNow?.expected.amount === 350_000,
    tl(drawerNow?.expected.amount ?? 0),
  )

  // The day-end REFUSES to close with a difference and no explanation.
  const silent = await closeDrawer(fin, ctx, { drawerId, counted: money(340_000), note: null })
  ok(
    'Gün sonu: açıklamasız fark REDDEDİLDİ (örtbas edilemez)',
    !silent.ok && silent.error.code === 'reason_required',
    silent.ok ? 'kapandı!' : silent.error.code,
  )

  const closed = await closeDrawer(fin, ctx, {
    drawerId,
    counted: money(340_000),
    note: 'Kasa açığı — araştırılıyor',
  })
  ok(
    'Gün sonu farkı KAYDA GEÇTİ',
    closed.ok && closed.value.discrepancy === -10_000,
    closed.ok ? tl(closed.value.discrepancy) : 'kapanmadı',
  )

  const drawerEvents = await db
    .collection(`studios/${SID}/events`)
    .where('type', '==', 'drawer.discrepancy_recorded')
    .get()
  ok('drawer.discrepancy_recorded event’i yazıldı', drawerEvents.size > 0)

  // ── 5. GIFT CARD — sıfırın altına harcanamaz (I-35). ───────────────────────────────────────
  const cardId = `gft_v124_${uniq}`
  const card: GiftCard = {
    id: cardId,
    studioId: SID,
    code: `HEDIYE${uniq}`,
    issuedValue: money(100_000),
    redeemed: money(0),
    expired: money(0),
    validUntil: null,
    issuedToMemberId: null,
    issuedAt: instant(Date.now()),
    issuedBy: ctx.actor,
    saleId: null,
    active: true,
  }
  ok('Hediye kartı oluşturuldu', (await issueGiftCard(fin, ctx, card)).ok)

  const tooMuch = await collect(fin, ctx, {
    paymentId: `pay_v124c_${uniq}`,
    memberId: member.id,
    branchId: BRANCH,
    amount: money(150_000),
    method: 'gift_card',
    receivedAt: instant(Date.now()),
    drawerId: null,
    giftCardCode: card.code,
    note: null,
  })
  ok(
    'I-35: hediye kartı bakiyesinin üstünde harcama REDDEDİLDİ (kırpılmadı)',
    !tooMuch.ok && tooMuch.error.code === 'giftcard_insufficient',
    tooMuch.ok ? 'geçti!' : tooMuch.error.code,
  )

  // ── 6. OP-2 — satış + tahsilat + mahsup tek İşlem No altında. ──────────────────────────────
  const oneShot = await sell(fin, ctx, {
    saleId: `sal_v124b_${uniq}`,
    memberId: member.id,
    branchId: BRANCH,
    lines: [
      {
        productId: null,
        description: 'Deneme Paketi',
        quantity: 1,
        unitPrice: money(100_000),
        entitlementId: null,
        giftCardId: null,
      },
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_v124d_${uniq}`,
      allocationId: `alc_v124_${uniq}`,
      amount: money(100_000),
      method: 'bank_transfer',
      receivedAt: instant(Date.now()),
      drawerId: null,
      giftCardCode: null,
      note: null,
    },
  })
  ok('Satış + tahsilat tek işlemde yapıldı', oneShot.ok)

  const saleEvent = await db
    .collection(`studios/${SID}/events`)
    .where('type', '==', 'sale.created')
    .get()
  const corr = saleEvent.docs
    .map((d) => d.data())
    .filter((d) => (d.subject as { id: string }).id === `sal_v124b_${uniq}`)
    .map((d) => d.correlationId as string)[0]!
  const opTypes = await eventsOf(corr)
  ok(
    'OP-2: satış · tahsilat · mahsup · kapanış AYNI İşlem No altında',
    opTypes.includes('sale.created') &&
      opTypes.includes('payment.received') &&
      opTypes.includes('allocation.applied') &&
      opTypes.includes('sale.settled'),
    opTypes.join(', '),
  )

  // ── 7. CRM — lead, ve #6: adın ve telefonun log'a girmemesi. ───────────────────────────────
  const dctx = {
    studioId: SID,
    actor: ctx.actor,
    now: instant(Date.now()),
    correlationId: newOperationId(),
    source: 'reception_web' as const,
  }
  const lead: Lead = {
    id: `led_v124_${uniq}`,
    studioId: SID,
    branchId: null,
    fullName: 'Zeynep Kaya',
    phone: '+905559998877',
    email: null,
    source: 'instagram',
    sourceDetail: 'Reels kampanyası',
    stage: 'new',
    ownerStaffId: null,
    createdAt: instant(Date.now() - 3 * 86_400_000),
    createdBy: ctx.actor,
    lostReason: null,
    lostNote: null,
    convertedMemberId: null,
    closedAt: null,
    note: null,
  }
  const captured = decideCaptureLead(dctx, lead)
  if (!captured.ok) throw new Error('capture failed')
  await crm.saveLead(ctx, captured.value.next, captured.value.events)
  ok('Aday kaydedildi', true)

  const leadEvents = await db
    .collection(`studios/${SID}/events`)
    .where('type', '==', 'lead.captured')
    .get()
  const leadPayloads = JSON.stringify(leadEvents.docs.map((d) => d.data().payload))
  ok(
    '#6: adayın ADI ve TELEFONU event log’una GİRMEDİ',
    !leadPayloads.includes('Zeynep') && !leadPayloads.includes('905559998877'),
    'yalnızca kaynak yazıldı',
  )

  const converted = decideConvertLead(
    { ...dctx, correlationId: newOperationId() },
    captured.value.next,
    member.id as MemberId,
  )
  if (!converted.ok) throw new Error('convert failed')
  await crm.saveLead(ctx, converted.value.next, converted.value.events)
  ok(
    'Aday → üye dönüşümü AÇIK bir işlem; aday kapandı',
    converted.value.next.stage === 'won' && converted.value.next.convertedMemberId === member.id,
  )

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
