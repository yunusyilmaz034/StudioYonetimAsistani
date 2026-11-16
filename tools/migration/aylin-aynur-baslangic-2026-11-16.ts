import { FirestoreEntitlementRepository, amendEntitlement, instant, systemClock, type EntitlementId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AYLİN ŞANLI + AYNUR KAYA — BAŞLANGIÇ 11.11 DEĞİL 09.11 (owner, 2026-11-16: "düzelt").
//
//   pnpm tsx tools/migration/aylin-aynur-baslangic-2026-11-16.ts [--apply]
//
// Satış 09.11 20:44'te başlangıç 11.11 seçilerek girilmiş; ikisi de 09.11 19:27'de turnikeden geçmiş (paketle).
// 3 aylık paket: 09.11.2026 → 07.02.2027 (90 gün). Para kayıtları değişmez.

const STUDIO = 'retro'
const RUN = 'aylin-aynur-baslangic-2026-11-16'
const PAKETLER = [
  ['AYLİN ŞANLI', 'ent_01M70PKCQXGP40605FPRBWDVYN'],
  ['AYNUR KAYA', 'ent_01M70PHTVFAYTG6D06NK2SS3GA'],
] as const
const ESKI = Date.parse('2026-11-11T00:00:00+03:00')
const YENI = Date.parse('2026-11-09T00:00:00+03:00')
const DAY = 86_400_000
const SEBEP = 'Başlangıç yanlış seçilmiş: üye 09.11 19:27 turnikeden geçti, paket 09.11 başlar (owner, 16.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const repo = new FirestoreEntitlementRepository(getFirestore())
  const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
  for (const [ad, id] of PAKETLER) {
    const ent = await repo.getEntitlement(ctx, id as EntitlementId)
    if (!ent || Number(ent.validFrom) !== ESKI || ent.productSnapshot.name !== 'Fitness - 3 Aylık' || Number(ent.validUntil) !== ESKI + 90 * DAY) {
      console.error(`DUR: ${ad} paketi beklenen durumda değil`); process.exit(1)
    }
  }
  for (const [ad, id] of PAKETLER) {
    console.log(`${ad}: ${d(ESKI)}→${d(ESKI + 90 * DAY)}  ⇒  ${d(YENI)}→${d(YENI + 90 * DAY)}`)
    if (!apply) continue
    const r = await amendEntitlement({ repo, clock: systemClock }, ctx, { entitlementId: id as EntitlementId, patch: { validFrom: instant(YENI), validUntil: instant(YENI + 90 * DAY) }, reason: SEBEP })
    if (!r.ok) { console.error(`DUR: ${ad}: ${JSON.stringify(r.error)}`); process.exit(1) }
    console.log('  ✅')
  }
  if (!apply) console.log('\nkuru çalışma — hiçbir şey yazılmadı')
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
