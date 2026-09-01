import {
  FirestoreEntitlementRepository,
  amendEntitlement,
  instant,
  systemClock,
  type EntitlementId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// 30 AĞUSTOS İLE 7 EYLÜL ARASINDAKİ BOŞLUĞU KAPAT (owner, 2026-09-01).
//
//   pnpm tsx tools/migration/gamze-bosluk-kapat-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/gamze-bosluk-kapat-2026-09.ts --apply
//
// ── DURUM ───────────────────────────────────────────────────────────────────────────────────
//
// Gamze Baykaldı'nın fitness paketi 30 Ağustos'ta bitti; yenisi 7 Eylül'de başlıyor. Arada yedi gün
// boyunca hiçbir canlı paketi yok — üye "pasif" görünüyor ve dünkü kuraldan sonra turnike de ona
// açılmıyor. Owner'ın kararı: *"30'unda biten paketi aktif et, 7 Eylül'e çek."*
//
// ── NEDEN BU MÜMKÜN ─────────────────────────────────────────────────────────────────────────
//
// Dün eklenen kural (OR-52): süresi dolmuş bir SÜRELİ paketin bitiş tarihi ileriye alınınca paket
// canlanır. Bu tam olarak o durum — 31 Ağustos'ta yapılamayan şey bugün yapılabiliyor, çünkü o gün
// aynı hatayı iki üyede daha görmüştük.
//
// ── SINIR: BİR ÜYE, VE ADI DEĞİL TARİFİ DOĞRULANDI ─────────────────────────────────────────
//
// Owner mesajında "Gizem" yazdı ama tarif ettiği durum ("30 Ağustos'ta biten paket, 7 Eylül'de
// başlayacak olana kadar") Gizem Eşin'de YOK — onun tek paketi 24 Ders, 28.08 → 26.11. Tarif
// yalnızca GAMZE BAYKALDI'ya uyuyor ve dün konuşulan da oydu.
//
// 30 Ağustos'ta biten başka iki paket daha var (Hayal Tanrıkulu, Aysun Uzunoğlu) ve onlara
// DOKUNULMUYOR: 7 Eylül'de başlayan bir paketleri yok, yani anlatılan durum onlarda değil. Script
// tek bir id ile çalışır — "30 Ağustos'ta biten her paketi uzat" diye bir tarama, istenmeyen üç
// üyeye bedava bir hafta vermek olurdu.

const STUDIO = 'retro'
const ENTITLEMENT = 'ent_01KZY193JAZGBFGKFYB7Y3B7EN' // GAMZE BAYKALDI · Fitness 3 Aylık · 01.06 → 30.08
const MEMBER_ADI = 'GAMZE BAYKALDI'
const YENI_BITIS = '2026-09-07' // yeni paketinin başladığı gün — boşluk tam kapanır, çakışma olmaz
const REASON =
  'Paketi 30.08.2026’da bitti, yenisi 07.09.2026’da başlıyordu; aradaki 7 günlük boşluk owner kararıyla kapatıldı (01.09.2026).'

const DAY_MS = (iso: string) => {
  const ms = Date.parse(`${iso}T00:00:00+03:00`)
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`)
  return ms
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
  const g = (t: number) => new Date(t).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const ref = db.doc(`studios/${STUDIO}/entitlements/${ENTITLEMENT}`)
  const snap = await ref.get()
  if (!snap.exists) return void console.log('✗ Paket bulunamadı. Hiçbir şey yazılmadı.')

  // Yazmadan önce KİM olduğunu doğrula: tek bir id ile çalışan bir script, yanlış id ile de
  // çalışır. Ad eşleşmiyorsa dur.
  const member = await db.doc(`studios/${STUDIO}/members/${String(snap.get('memberId'))}`).get()
  const ad = String(member.get('fullName') ?? '')
  if (ad !== MEMBER_ADI) return void console.log(`✗ Beklenen üye ${MEMBER_ADI}, bulunan ${ad}. Durduruldu.`)

  const durum = String(snap.get('status'))
  console.log(`üye     : ${ad}`)
  console.log(`paket   : ${String((snap.get('productSnapshot') as { name?: string })?.name)}`)
  console.log(`durum   : ${durum}${durum === 'expired' ? ' → active (OR-52: bitiş ileri alınınca canlanır)' : ''}`)
  console.log(`bitiş   : ${g(ms(snap.get('validUntil')))} → ${YENI_BITIS}`)

  if (durum === 'active' && ms(snap.get('validUntil')) >= DAY_MS(YENI_BITIS)) {
    console.log('\nZATEN YAPILMIŞ. Çıkılıyor.')
    return
  }
  if (!apply) return void console.log('\n(uygulamak için --apply)')

  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:gamze-bosluk-2026-09' },
    branchIds: [],
    correlationId: 'mig_gamze_bosluk_2026_09',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext

  const res = await amendEntitlement(
    { repo: new FirestoreEntitlementRepository(db), clock: systemClock },
    ctx,
    { entitlementId: ENTITLEMENT as EntitlementId, patch: { validUntil: instant(DAY_MS(YENI_BITIS)) }, reason: REASON },
  )
  console.log(res.ok ? '✅ Paket 07.09.2026’ya uzatıldı ve aktife alındı.' : `✗ ${JSON.stringify(res.error)}`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
