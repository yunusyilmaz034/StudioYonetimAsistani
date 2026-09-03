import {
  FirestoreEntitlementRepository,
  amendEntitlement,
  money,
  systemClock,
  type EntitlementId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ABONELİK TUTARINI SATIŞLA AYNI HÂLE GETİR — `fix-fitness-3aylik-link-odemesi`in ikinci yarısı.
//
//   pnpm tsx tools/migration/fix-fitness-3aylik-abonelik-tutari-2026-09.ts
//   pnpm tsx tools/migration/fix-fitness-3aylik-abonelik-tutari-2026-09.ts --apply
//
// ── NEDEN AYRI BİR ADIM ─────────────────────────────────────────────────────────────────────
//
// Kardeş script satışı 8.500'den 9.500'e çekti ve tahsilatı yazdı — ama `sell` ABONELİĞE dokunmaz;
// yeni satışın satırı mevcut aboneliği gösterir, onu değiştirmez. Sonuç: defter (satış + ödeme)
// 9.500 diyordu, `entitlement.priceAgreed` hâlâ 8.500 duruyordu.
//
// Bu görünmez bir tutarsızlık DEĞİL, ekranda yazan bir sayı:
//
//   · Üye → Paketler kartı: "Paket tutarı" satırı `priceAgreed`ten okuyor
//     (`subscriptions.tsx:411`)
//   · **Bilgi fişi** aynı alandan basıyor (`receipt-query.ts:86`) — yani müşteriye 8.500 ₺'lik
//     bir fiş verilebilirdi, oysa kartından 9.500 ₺ çekildi.
//
// Uygulamadan sonra fark edildi ve ayrı bırakıldı: kardeş script'i yeniden çalıştırmak satışı ikinci
// kez kurmaya kalkardı (orada "zaten var" koruması bunun için duruyor). Düzeltmenin doğru şekli,
// yapılmış işi geri almak değil, eksik kalan adımı ayrıca yapmaktır.

const STUDIO = 'retro'
const RUN = 'fix-fitness-3aylik-abonelik-tutari-2026-09'
const DOGRU_KURUS = 950_000
const REASON = 'Kartla 9.500 ₺ ödendi; abonelik tutarı nakit fiyatında (8.500 ₺) kalmıştı (owner, 2026-09-03).'

const VAKALAR = [
  { ad: 'İDİL ÖZDEDE', entitlementId: 'ent_01M1M3Z1BDGN1NN2YFRPBAFPCK' },
  { ad: 'İREM YILMAZ', entitlementId: 'ent_01M1M3ZNY31Q4ES5PA0609XDCQ' },
] as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  for (const v of VAKALAR) {
    const d = await db.doc(`studios/${STUDIO}/entitlements/${v.entitlementId}`).get()
    const simdi = (d.get('priceAgreed.amount') as number | undefined) ?? 0
    console.log(`━━ ${v.ad}: ${tl(simdi)} → ${tl(DOGRU_KURUS)}`)
    if (!d.exists) { console.log('   DUR: abonelik yok.\n'); continue }
    if (simdi === DOGRU_KURUS) { console.log('   ZATEN DOĞRU — atlandı.\n'); continue }
    if (!apply) { console.log(''); continue }
    const r = await amendEntitlement(deps, ctx, {
      entitlementId: v.entitlementId as EntitlementId,
      patch: { priceAgreed: money(DOGRU_KURUS) },
      reason: REASON,
    })
    if (!r.ok) { console.error('   BAŞARISIZ:', r.error); return }
    console.log('   ✓ düzeltildi\n')
  }
  if (!apply) console.log('(uygulamak için --apply)')
}

void main()
