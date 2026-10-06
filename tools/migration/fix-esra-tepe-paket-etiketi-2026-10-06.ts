import {
  available,
  ENTITLEMENT_AMENDED,
  FirestoreEntitlementRepository,
  instant,
  money,
  systemClock,
  type Entitlement,
  type EntitlementId,
  type NewEvent,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ESRA TEPE — PAKET ETİKETİ 8 DERS'E ÇEKİLİYOR (owner onayı, 2026-10-06)
//
//   pnpm tsx tools/migration/fix-esra-tepe-paket-etiketi-2026-10-06.ts
//   pnpm tsx tools/migration/fix-esra-tepe-paket-etiketi-2026-10-06.ts --apply
//
// Para ve kredi düzeltmesi `fix-esra-tepe-8ders-2026-10-06.ts` ile yapıldı (satış settled
// 4.200/4.200, kredi kalan 5). Kalan tek yanlış, paketin ANLIK GÖRÜNTÜSÜ: ekranda ve raporlarda
// "Reformer Pilates - 24 Ders" yazıyor ve pakete yazılı fiyat 11.000 ₺. Owner: *"etiketi de düzelt."*
//
// ── NEDEN `syncEntitlementsToProduct` DEĞİL ─────────────────────────────────────────────────
//
// `decideSyncSnapshotToProduct`, `product.productId !== ent.productSnapshot.productId` olduğunda
// `operation_not_applicable` ile REDDEDİYOR (kaynak: entitlements/domain/decide.ts:1102) ve
// yalnızca `category` ile `serviceIds` değiştiriyor. Yani başka bir ürüne geçiş, ad, kredi sayısı
// ve fiyat onun işi değil. Bu iş için desteklenen bir işlem yok.
//
// ── YENİ OLAY TÜRÜ EKLENMİYOR ───────────────────────────────────────────────────────────────
//
// `entitlement.amended` zaten bu iş için var: *"a generic amend: the changed field names plus each
// field's before/after value, and a mandatory reason (AD-22)."* Kalıcı şema eklemesi, golden
// fixture ve upcaster gerekmiyor — düzeltme mevcut katalogla, sebebiyle ve from→to değerleriyle
// kayda geçiyor (#9: telafi kaydı, sessiz üstüne yazma değil).
//
// ── İKİ ALANA BİLEREK DOKUNULMUYOR ──────────────────────────────────────────────────────────
//
//   · SÜRE 90 gün kalıyor (31.08 → 29.11). 8 Ders ürünü 30 günlük; eşitlemek paketi 30.09'da
//     bitmiş sayar ve üyenin KALAN 5 KREDİSİNİ yakar. Etiketi düzeltmek, üyeye ders kaybettirmek
//     değildir — ve `validUntil` 29.11 ile `validForDays: 90` böylece tutarlı kalır.
//   · `dailyReservationLimit` null kalıyor. 8 Ders ürününde 1; etiket düzeltmesinin yan etkisi
//     olarak üyeye yeni bir kısıt getirmek, istenmeyen bir kural değişikliği olurdu.
//
// Paketin ÜST DÜZEY `productId` ve `policyRef` alanları zaten 8 Ders ürününü gösteriyor (31
// Ağustos'taki düzeltme onları değiştirmiş, anlık görüntüyü bırakmış) — onlara dokunulmuyor.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-esra-tepe-paket-etiketi-2026-10-06'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  ad: 'ESRA TEPE',
  entitlementId: 'ent_01M1CA6JH244MSJ4R9Y1MM2H2J' as EntitlementId,
  eskiUrunId: 'prd_01KXZXDWJ6TGEFTRFJSS5QV5JB', // 24 Ders — anlık görüntüde duran yanlış
  yeniUrunId: 'prd_01KXJD2CHDK9EA6RM869W45J60', // 8 Ders — paketin üst düzeyinde zaten bu
  yeniAd: 'Reformer Pilates - 8 Ders',
  yeniKredi: 8,
  yeniListeKurus: 500_000,   // 8 Ders ürününün priceInKurus (katalogdan okundu)
  yeniAnlasilanKurus: 420_000, // cashPriceInKurus — gerçekten ödenen
  beklenenKalan: 5,
  eskiAnlasilanKurus: 1_100_000,
} as const

const REASON =
  '24 Ders yerine 8 Ders paketi geçerli (owner onayı, 2026-10-06). Para ve kredi düzeltmesi aynı gün ' +
  'yapıldı; paketin anlık görüntüsü 31 Ağustos düzeltmesinden 24 Ders olarak kalmıştı. Ad, ürün, ' +
  'kredi sayısı ve fiyat 8 Ders\'e çekildi. SÜRE ve günlük limit bilerek değiştirilmedi: süreyi 30 ' +
  'güne çekmek paketi 30.09\'da bitmiş sayar ve üyenin kalan 5 kredisini yakardı.'

const tl = (k: unknown) => `${(Number((k as { amount?: number })?.amount ?? k ?? 0) / 100).toLocaleString('tr-TR')} ₺`

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
  const repo = new FirestoreEntitlementRepository(db)

  const ent = await repo.getEntitlement(ctx, VAKA.entitlementId)
  if (!ent) { console.error('DUR: paket bulunamadı.'); process.exit(1) }
  const snap = ent.productSnapshot

  console.log(`━━ ${VAKA.ad} · ${ent.id}`)
  console.log(`   ad          : ${snap.name}`)
  console.log(`   anlık ürün  : ${snap.productId}`)
  console.log(`   kredi (snap): ${(snap.grant as { credits?: number }).credits}`)
  console.log(`   liste fiyatı: ${tl(snap.listPrice)}`)
  console.log(`   anlaşılan   : ${tl(ent.priceAgreed)}`)
  console.log(`   defter      : KALAN ${ent.credits ? available(ent.credits) : '—'}`)
  console.log(`   süre        : ${new Date(ent.validFrom as number).toLocaleDateString('tr-TR')} → ${new Date(ent.validUntil as number).toLocaleDateString('tr-TR')} (DOKUNULMAYACAK)`)

  // ── KORUMALAR ──
  if (snap.productId === VAKA.yeniUrunId) { console.log('DUR: anlık görüntü zaten 8 Ders — düzeltme uygulanmış.'); return }
  if (snap.productId !== VAKA.eskiUrunId) { console.error(`DUR: anlık görüntüdeki ürün beklenenden farklı (${snap.productId}).`); process.exit(1) }
  if (ent.status !== 'active') { console.error(`DUR: paket aktif değil (${ent.status}).`); process.exit(1) }
  if (!ent.credits || available(ent.credits) !== VAKA.beklenenKalan) {
    console.error(`DUR: kalan kredi ${VAKA.beklenenKalan} değil — para/kredi düzeltmesi önce çalışmalı.`); process.exit(1)
  }
  if (Number((ent.priceAgreed as unknown as { amount: number }).amount) !== VAKA.eskiAnlasilanKurus) {
    console.error('DUR: anlaşılan fiyat beklenenden farklı.'); process.exit(1)
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {
    'productSnapshot.productId': { from: snap.productId, to: VAKA.yeniUrunId },
    'productSnapshot.name': { from: snap.name, to: VAKA.yeniAd },
    'productSnapshot.grant.credits': { from: (snap.grant as { credits?: number }).credits, to: VAKA.yeniKredi },
    'productSnapshot.listPrice': { from: snap.listPrice, to: money(VAKA.yeniListeKurus) },
    priceAgreed: { from: ent.priceAgreed, to: money(VAKA.yeniAnlasilanKurus) },
  }

  if (!APPLY) {
    console.log('\n── KURU ÇALIŞMA ── değişecek alanlar:')
    for (const [k, v] of Object.entries(changes)) {
      const g = (x: unknown) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))
      console.log(`   ${k.padEnd(32)} ${g(v.from)}  →  ${g(v.to)}`)
    }
    console.log(`\n   DOKUNULMAYAN: süre (${new Date(ent.validFrom as number).toLocaleDateString('tr-TR')} → ${new Date(ent.validUntil as number).toLocaleDateString('tr-TR')}), günlük limit (${snap.dailyReservationLimit ?? 'null'}), defter (KALAN ${available(ent.credits!)})`)
    console.log(`\n   olay: ${ENTITLEMENT_AMENDED} · sebep: ${REASON}`)
    console.log('\n   --apply ile çalıştır.')
    return
  }

  const next: Entitlement = {
    ...ent,
    priceAgreed: money(VAKA.yeniAnlasilanKurus),
    productSnapshot: {
      ...snap,
      productId: VAKA.yeniUrunId as typeof snap.productId,
      name: VAKA.yeniAd,
      listPrice: money(VAKA.yeniListeKurus),
      grant: { ...(snap.grant as object), credits: VAKA.yeniKredi } as typeof snap.grant,
    },
  }

  const olay = {
    studioId: STUDIO,
    branchId: null,
    type: ENTITLEMENT_AMENDED,
    version: 1,
    payload: { changedFields: Object.keys(changes), changes, reason: REASON },
    occurredAt: instant(systemClock.now()),
    actor: ctx.actor,
    source: 'migration',
    subject: { kind: 'entitlement', id: ent.id },
    related: { memberId: ent.memberId, entitlementId: ent.id },
    policyRef: { policyId: ent.policyRef.policyId, version: ent.policyRef.version },
    commandId: null,
    causationId: null,
    correlationId: RUN,
  } as unknown as NewEvent

  await repo.saveEntitlement(ctx, next, [olay])

  const sonra = await repo.getEntitlement(ctx, VAKA.entitlementId)
  console.log('\n✅ UYGULANDI')
  console.log(`   ad          : ${sonra?.productSnapshot.name}`)
  console.log(`   anlık ürün  : ${sonra?.productSnapshot.productId}`)
  console.log(`   kredi (snap): ${(sonra?.productSnapshot.grant as { credits?: number })?.credits}`)
  console.log(`   anlaşılan   : ${tl(sonra?.priceAgreed)}`)
  console.log(`   defter      : KALAN ${sonra?.credits ? available(sonra.credits) : '—'} (değişmedi)`)
  console.log(`   süre        : ${new Date(sonra!.validFrom as number).toLocaleDateString('tr-TR')} → ${new Date(sonra!.validUntil as number).toLocaleDateString('tr-TR')} (değişmedi)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
