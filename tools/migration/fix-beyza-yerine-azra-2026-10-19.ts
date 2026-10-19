import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  cancelEntitlement,
  cancelSale,
  collect,
  instant,
  money,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ARZU DOĞAN'IN KIZI BEYZA DOĞAN DEĞİL, AZRA İREM YILDIZ (owner, 2026-10-19)
//
//   pnpm tsx tools/migration/fix-beyza-yerine-azra-2026-10-19.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-beyza-yerine-azra-2026-10-19.ts --apply    # yaz
//
// `fix-arzu-beyza-dogan-6-aylik-2026-10-19.ts` kızın 6 aylığını yanlış üyeye — Beyza Doğan'a — açtı ve
// Arzu'nun PAYTR ödemesinden 8.000'i oraya yazdı. Owner: *"Beyza Doğan değil, Azra İrem Yıldız kızıymış."*
//
// Işıl bu arada Azra'yı açmış ve masadan 6 Aylık 14.000 satmış (20.10 başlangıç), 6.000 tahsil etmiş;
// satış 8.000 açık. Yapılan:
//   1) Beyza: 8.000 ödeme payı iptal → yanlış 6 aylık satış iptal → yanlış paket iptal. Reformer paketine dokunulmaz.
//   2) Azra: 8.000 aynı PAYTR ödemesi (aynı an, aynı referans) Işıl'ın satışına → satış kapanır.
// Azra'nın başlangıcı (20.10) masanın kararı; dokunulmuyor.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-beyza-yerine-azra-2026-10-19'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  beyza: 'mem_01M2AWAJP8SMD5HEH6E1PN0WAD' as MemberId,
  beyzaPaket: 'ent_01M5AETHK6YG6W9XE4P39HGK19' as EntitlementId,
  beyzaSatis: 'sal_01M5AETHK5CWKADR4W60Z6FQMV',
  beyzaOdeme: 'pay_fix-arzu-beyza-dogan-6-aylik-2026-10-19_beyza',
  azra: 'mem_01M5AE0FM7MG4PPXWT3F3JD475' as MemberId,
  urun: 'prd_01KXJD2D1EMQRC6C0RD777VG2Y',
  kurus: 800_000,
} as const

const REASON =
  'Arzu Doğan\'ın kızı Beyza Doğan değil Azra İrem Yıldız: yanlış üyeye açılan 6 Aylık ve Arzu\'nun PAYTR ' +
  'ödemesinden 8.000 payı Beyza\'dan alındı, Azra\'nın masada açılan 6 Aylık satışına yazıldı (owner, 2026-10-19).'

const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))

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
  const ent = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const col = (c: string) => db.collection(`studios/${STUDIO}/${c}`)

  const [bPaket, bSatis, bOdeme, aSatislar] = await Promise.all([
    col('entitlements').doc(VAKA.beyzaPaket).get(),
    col('sales').doc(VAKA.beyzaSatis).get(),
    col('payments').doc(VAKA.beyzaOdeme).get(),
    col('sales').where('memberId', '==', VAKA.azra).get(),
  ])
  if (bPaket.get('memberId') !== VAKA.beyza || bSatis.get('memberId') !== VAKA.beyza || bOdeme.get('memberId') !== VAKA.beyza) return dur('Beyza kayıtları beklenen gibi değil.')
  if (Number(bOdeme.get('amount.amount')) !== VAKA.kurus) return dur('Beyza ödeme payı 8.000 değil.')
  const aSatis = aSatislar.docs.filter((s) => s.get('status') !== 'cancelled' && (s.get('lines') as { productId?: string }[]).some((l) => l.productId === VAKA.urun))
  if (aSatis.length !== 1) return dur(`Azra'da tek bir 6 aylık satış bekleniyordu (${aSatis.length}).`)
  const satis = aSatis[0]!
  const odemeId = `pay_${RUN}_azra`
  const azraOdeme = await col('payments').doc(odemeId).get()
  const borc = Number(satis.get('total.amount')) - Number(satis.get('paid.amount'))
  if (!azraOdeme.exists && borc !== VAKA.kurus) return dur(`Azra'nın satışında açık ${tl(borc)} — 8.000 bekleniyordu.`)

  console.log(`━━ BEYZA → AZRA · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   Beyza ödeme payı iptal : ${tl(VAKA.kurus)}${bOdeme.get('voided') ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   Beyza 6 aylık satış    : ${bSatis.get('status')}`)
  console.log(`   Beyza 6 aylık paket    : ${bPaket.get('status')}`)
  console.log(`   Azra satış ${satis.id}: ${tl(Number(satis.get('total.amount')))} · ödenen ${tl(Number(satis.get('paid.amount')))} → +${tl(VAKA.kurus)} online${azraOdeme.exists ? ' — ZATEN VAR' : ''}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  if (!bOdeme.get('voided')) {
    const r = await voidPayment(fin, ctx, { paymentId: VAKA.beyzaOdeme, reason: REASON })
    if (!r.ok) return dur(`Beyza ödeme iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ Beyza ödeme payı iptal')
  }
  if (bSatis.get('status') !== 'cancelled') {
    const r = await cancelSale(fin, ctx, { saleId: VAKA.beyzaSatis, reason: REASON })
    if (!r.ok) return dur(`Beyza satış iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ Beyza 6 aylık satış iptal')
  }
  if (bPaket.get('status') !== 'cancelled') {
    const r = await cancelEntitlement(ent, ctx, { entitlementId: VAKA.beyzaPaket, reason: REASON, refundPaymentId: null })
    if (!r.ok) return dur(`Beyza paket iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ Beyza 6 aylık paket iptal')
  }
  if (!azraOdeme.exists) {
    const r = await collect(fin, ctx, {
      paymentId: odemeId,
      memberId: VAKA.azra,
      branchId: BRANCH as BranchId,
      amount: money(VAKA.kurus),
      method: 'online',
      receivedAt: instant(ms(bOdeme.get('receivedAt'))),
      drawerId: null,
      allowNoDrawer: true,
      giftCardCode: null,
      providerRef: (bOdeme.get('providerRef') as string | null) ?? '52e7045a9a0f4226ade0568d9599d03f',
      note: REASON,
      allocateTo: [{ saleId: satis.id, amount: money(VAKA.kurus), allocationId: `alc_${RUN}_azra` }],
    })
    if (!r.ok) return dur(`Azra ödeme: ${JSON.stringify(r.error)}`)
    console.log(`   ✓ Azra ${tl(VAKA.kurus)} online`)
  }
  const s = await col('sales').doc(satis.id).get()
  console.log(`\n✅ Azra satış ${s.get('status')} · ${tl(Number(s.get('total.amount')))} / ödenen ${tl(Number(s.get('paid.amount')))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
