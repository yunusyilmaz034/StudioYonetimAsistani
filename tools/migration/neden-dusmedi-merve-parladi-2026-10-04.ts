import {
  FirestorePaymentIntentRepository,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// MERVE PARLADI · PAYTR ÖDEMESİ ALINDI, BORÇ DÜŞMEDİ (owner, 2026-10-04)
//
//   pnpm tsx tools/migration/neden-dusmedi-merve-parladi-2026-10-04.ts
//
// SALT OKUNUR. Hiçbir şey yazmaz, `--apply` yoktur.
//
// Owner: *"merve parladı bugün paytr üzerinden ödemesini yaptı ama borcu düşmedi, tam ödeme aldık
// aslında paytr panelde gördük."*
//
// ÖLÇÜLEN: bugün 07:03:34Z callback geldi (merchant_oid S1791097141443538676882302558,
// total_amount 1540154, status success) ve 07:03:35Z doğrulandı. SONRASINDA HİÇ LOG YOK —
// "intent bulunamadı" uyarısı da, "completion failed" hatası da yok. Yani intent bulundu,
// kod çakılmadı; `completePaidIntent` içindeki iki SESSİZ return'den biri işledi.
//
// Bu betik o sessizliği kırıyor: intent'in gerçek durumu, beklenen tutar, ve üyenin borcu.

const STUDIO = 'retro'
const REF = '3b39bd221191479bb1e7ea0d71088a8f'   // bugünkü callback_id = providerRef
const REF_DUN = 'e62e59735a374b66a9417cfbb2315716' // karşılaştırma için dünkü
const ARANAN = 'merve parladi'

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().trim()

const tl = (k: unknown): string => `${(Number(k ?? 0) / 100).toLocaleString('tr-TR')} ₺`
const an = (v: unknown): string =>
  v instanceof Timestamp ? v.toDate().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  : typeof v === 'number' ? new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  : '—'

/** Alan adlarını TAHMİN ETMEMEK için belgeyi olduğu gibi dök (önceki tuzak: membershipStatus=undefined). */
const dok = (data: Record<string, unknown>, girinti = '        ') => {
  for (const [k, v] of Object.entries(data).sort()) {
    const g = v instanceof Timestamp ? an(v)
      : v && typeof v === 'object' ? JSON.stringify(v).slice(0, 140)
      : String(v)
    console.log(`${girinti}${k.padEnd(22)} ${g}`)
  }
}

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:neden-dusmedi-merve' },
    branchIds: ['mutlukent'],
    correlationId: 'neden-dusmedi-merve',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext

  // ── 1. INTENT (asıl soru) ────────────────────────────────────────────────────────────────
  const repo = new FirestorePaymentIntentRepository(db)
  for (const [etiket, ref] of [['BUGÜN', REF], ['DÜN (karşılaştırma)', REF_DUN]] as const) {
    const intent = await repo.getIntentByProviderRef(ctx, ref)
    console.log(`\n━━ INTENT · ${etiket} · ref=${ref}`)
    if (!intent) { console.log('   BULUNAMADI'); continue }
    console.log(`   id            ${intent.id}`)
    console.log(`   status        ${intent.status}`)
    console.log(`   purpose       ${intent.purpose}`)
    console.log(`   memberId      ${intent.memberId}`)
    console.log(`   BEKLENEN      ${tl(intent.amount.amount)}  (${intent.amount.amount} kuruş)`)
    console.log(`   failureReason ${intent.failureReason ?? '—'}`)
    console.log(`   context:`)
    dok(intent.context as unknown as Record<string, unknown>, '      ')
  }
  console.log(`\n   PAYTR'ın BUGÜN tahsil ettiği: ${tl(1540154)} (1540154 kuruş)`)

  // ── 2. ÜYE ───────────────────────────────────────────────────────────────────────────────
  const uyeler = await db.collection(`studios/${STUDIO}/members`).get()
  const bulunan = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes(ARANAN))
  console.log(`\n━━ ÜYE "${ARANAN}" → ${bulunan.length} eşleşme (${uyeler.size} tarandı)`)
  if (bulunan.length === 0) {
    const kismi = uyeler.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('merve'))
    console.log(`   "merve" içerenler: ${kismi.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'yok'}`)
    return
  }
  const uye = bulunan[0]!
  console.log(`   ${uye.get('fullName')} · ${uye.id}`)

  // ── 3. SATIŞLARI ve BORCU ────────────────────────────────────────────────────────────────
  const satislar = await db.collection(`studios/${STUDIO}/sales`).where('memberId', '==', uye.id).get()
  console.log(`\n━━ SATIŞLARI (${satislar.size})`)
  for (const s of satislar.docs) {
    console.log(`   ▸ ${s.id}`)
    dok(s.data())
  }

  const odemeler = await db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', uye.id).get()
  console.log(`\n━━ ÖDEMELERİ (${odemeler.size})`)
  for (const p of odemeler.docs) {
    console.log(`   ▸ ${p.id}`)
    dok(p.data())
  }

  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => { console.error(e); process.exit(1) })
