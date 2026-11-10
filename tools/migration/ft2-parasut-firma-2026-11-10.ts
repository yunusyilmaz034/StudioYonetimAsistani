import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// FT-2 — PARAŞÜT FİRMASI (owner, 2026-11-10: Paraşüt satın alındı, API onaylandı, firma 858102).
// Yalnız `settings/invoicing.parasut` yazılır: canlı ortam + firma numarası. apiBase/idBase boş kalır →
// kod Paraşüt'ün canlı adreslerini kullanır. Başka alana dokunmaz.
//   pnpm tsx tools/migration/ft2-parasut-firma-2026-11-10.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ft2-parasut-firma-2026-11-10.ts --apply
const STUDIO = 'retro'
const PARASUT = { environment: 'production', companyId: '858102', apiBase: null, idBase: null }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/invoicing`)
  const before = (await ref.get()).get('parasut') ?? null
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`Paraşüt: ${JSON.stringify(before)} → ${JSON.stringify(PARASUT)}`)
  if (apply) {
    await ref.set(
      { parasut: PARASUT, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'ft2-parasut-firma-2026-11-10' } },
      { merge: true },
    )
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
