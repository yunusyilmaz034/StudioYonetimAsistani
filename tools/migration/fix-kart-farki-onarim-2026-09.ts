import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  instant,
  money,
  sell,
  systemClock,
  voidPayment,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// KART FARKI DÜZELTMESİ — ONARIM TURU (2026-09-04).
//
//   pnpm tsx tools/migration/fix-kart-farki-onarim-2026-09.ts
//   pnpm tsx tools/migration/fix-kart-farki-onarim-2026-09.ts --apply
//
// ── NEDEN İKİNCİ BİR TUR ────────────────────────────────────────────────────────────────────
//
// İlk turda BENİM hatam vardı: vaka tablosuna abonelik kimliklerini bir ekran çıktısından
// kopyalamıştım ve o çıktı `.slice(0, 24)` ile KESİLMİŞTİ. Yani yeni satışların satırı var olmayan
// bir aboneliği gösterdi (`ent_01M0HPDE19370D2PTDR8` ≠ `ent_01M0HPDE19370D2PTDR8M01QNM`), ve
// abonelik tutarını düzelten adım "Entitlement not found" ile patlayıp script'i durdurdu.
//
// Sonuç: iki üyede satış doğru tutarda ama YANLIŞ aboneliğe bağlı, ikisi hiç işlenmemiş.
//
// Ders, ve burada yazılı duruyor: **kimlik asla ekrana basılmış bir metinden alınmaz.** Kesilmiş bir
// id, yanlış bir id'dir; ve para kaydında yanlış bir bağ, gözle görülmeyen bir kopukluktur — satış
// ekranda doğru görünür, yalnızca hiçbir pakete bağlanmaz.
//
// Bu turda kimlikler veritabanından TAM okundu ve script çalışmadan önce hepsinin var olduğunu
// DOĞRULUYOR.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-kart-farki-onarim-2026-09'
const APPLY = process.argv.includes('--apply')
const REASON =
  'Kart farkı tahsil edilmiş ama satışa yazılmamıştı; satış tahsil edilen tutardan yeniden kuruldu (owner onayı, 2026-09-04).'

// `iptalEdilecek`: şu an CANLI olan ve yerine doğrusu kurulacak satış + ödemesi.
const VAKALAR = [
  {
    ad: 'LEMAN DEMİREL TATOĞLU',
    memberId: 'mem_01M0HP6FZ705H9B1EF63JHTGVS',
    saleId: 'sal_fix-kart-farki-2026-09_mem_01M0HP6FZ705H9B1EF63JHTGVS',
    paymentId: 'pay_fix-kart-farki-2026-09_mem_01M0HP6FZ705H9B1EF63JHTGVS',
    entitlementId: 'ent_01M0HPDE19370D2PTDR8M01QNM',
    productId: 'prd_01KXJD2CW08CNP08KJRSW34DRR',
    urun: 'Fitness - 3 Aylık',
    dogruKurus: 950_000,
    odemeIso: '2026-08-21T08:18:49.000Z',
  },
  {
    ad: 'HAYRUNİSA KIRAÇ',
    memberId: 'mem_01KXN38ZABKWNHA26EGAZRJSDW',
    saleId: 'sal_fix-kart-farki-2026-09_mem_01KXN38ZABKWNHA26EGAZRJSDW',
    paymentId: 'pay_fix-kart-farki-2026-09_mem_01KXN38ZABKWNHA26EGAZRJSDW',
    entitlementId: 'ent_01M0WXQ38R62EHHJKR8CGWQP7V',
    productId: 'prd_01KXJD2CQ8WWKZMJCFBSP8HYDE',
    urun: 'Reformer Pilates - 16 Ders',
    dogruKurus: 860_000,
    odemeIso: '2026-08-25T16:58:04.000Z',
  },
  {
    ad: 'İREM KILIÇ',
    memberId: 'mem_01KY536PHC5RCSM3TDXJS1D8GS',
    saleId: 'sal_01M1E2T65JC874N1GCNRQEFK15',
    paymentId: 'pay_01M1E2T65JC874N1GCNRQEFK15',
    entitlementId: 'ent_01M1E2T65M9BV1K9NE3DMHWXBM',
    productId: 'prd_01KXJD2CHDK9EA6RM869W45J60',
    urun: 'Reformer Pilates - 8 Ders',
    dogruKurus: 450_000,
    odemeIso: '2026-09-01T08:54:14.000Z',
  },
] as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
  const entDeps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  // HER KİMLİK, YAZMADAN ÖNCE DOĞRULANIR. İlk turu batıran şey tam olarak doğrulanmamış bir kimlikti.
  for (const v of VAKALAR) {
    const e = await db.doc(`studios/${STUDIO}/entitlements/${v.entitlementId}`).get()
    if (!e.exists) { console.error(`DUR: abonelik bulunamadı → ${v.ad} · ${v.entitlementId}`); process.exit(1) }
  }
  console.log('✓ üç aboneliğin de kimliği doğrulandı\n')

  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  for (const v of VAKALAR) {
    console.log(`━━ ${v.ad}`)
    const s = await db.doc(`studios/${STUDIO}/sales/${v.saleId}`).get()
    const p = await db.doc(`studios/${STUDIO}/payments/${v.paymentId}`).get()
    const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}_${v.memberId}`).get()
    console.log(`   iptal edilecek satış: ${s.exists ? `${tl(s.get('total.amount') ?? 0)} · ${s.get('status')}` : 'YOK'}`)
    console.log(`   yeniden kurulacak   : ${tl(v.dogruKurus)} → abonelik ${v.entitlementId}`)

    if (!s.exists || s.get('status') === 'cancelled') { console.log('   DUR: satış yok ya da iptal.\n'); continue }
    if (!p.exists || p.get('voided') === true) { console.log('   DUR: ödeme yok ya da iptal.\n'); continue }
    if (yeni.exists) { console.log('   DUR: onarım zaten uygulanmış.\n'); continue }
    if (!APPLY) { console.log(''); continue }

    const vo = await voidPayment(fin, ctx, { paymentId: v.paymentId, reason: REASON })
    if (!vo.ok) { console.error('   ÖDEME İPTALİ BAŞARISIZ:', vo.error); return }
    const ca = await cancelSale(fin, ctx, { saleId: v.saleId, reason: REASON })
    if (!ca.ok) { console.error('   SATIŞ İPTALİ BAŞARISIZ:', ca.error); return }

    const sold = await sell(fin, ctx, {
      saleId: `sal_${RUN}_${v.memberId}`,
      memberId: v.memberId as MemberId,
      branchId: BRANCH as never,
      lines: [
        {
          productId: v.productId as never,
          description: v.urun,
          quantity: 1,
          unitPrice: money(v.dogruKurus),
          entitlementId: v.entitlementId as never,
          giftCardId: null,
        },
      ],
      discounts: [],
      discountCeilingPercent: null,
      payment: {
        paymentId: `pay_${RUN}_${v.memberId}`,
        allocationId: `alc_${RUN}_${v.memberId}`,
        amount: money(v.dogruKurus),
        method: 'credit_card',
        receivedAt: instant(Date.parse(v.odemeIso)), // para o gün girdi, bugün değil
        drawerId: null,
        giftCardCode: null,
        note: REASON,
      },
    })
    if (!sold.ok) { console.error('   SATIŞ BAŞARISIZ:', sold.error); return }

    const am = await amendEntitlement(entDeps, ctx, {
      entitlementId: v.entitlementId as EntitlementId,
      patch: { priceAgreed: money(v.dogruKurus) },
      reason: REASON,
    })
    if (!am.ok) { console.error('   ABONELİK TUTARI DÜZELTİLEMEDİ:', am.error); return }

    console.log(`   ✓ ${tl(v.dogruKurus)} satış + tahsilat + abonelik tutarı, DOĞRU aboneliğe bağlı\n`)
  }
  if (!APPLY) console.log('(uygulamak için --apply)')
}

void main()
