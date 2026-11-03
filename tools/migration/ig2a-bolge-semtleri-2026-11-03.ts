import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// IG-2a — İÇERİK PLANININ BÖLGE SEMTLERİ (owner, 2026-11-03).
//
//   pnpm tsx tools/migration/ig2a-bolge-semtleri-2026-11-03.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ig2a-bolge-semtleri-2026-11-03.ts --apply
//
// Owner'ın verdiği liste, olduğu gibi: hashtag ve açıklamalarda stüdyonun bulunmak istediği semtler.
// Veri, kod değil (AD-41 ruhu): sonradan İçerik ekranındaki "Bölge → Düzenle" ile owner değiştirir.
// `settings/content` belgesine yalnızca `areas` yazılır (merge) — başka alan yoksa da varsa da korunur.

const STUDIO = 'retro'
const AREAS = ['Çayırova', 'Gebze', 'Mutlukent', 'Kirazpınar', 'Şekerpınar', 'Güzeltepe']

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/content`)
  const before = ((await ref.get()).get('areas') as string[] | undefined) ?? []
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──')
  console.log(`önce : ${before.length ? before.join(', ') : '(yok)'}`)
  console.log(`sonra: ${AREAS.join(', ')}`)
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  await ref.set({ areas: AREAS }, { merge: true })
  console.log('✓ yazıldı')
  process.exit(0)
}

void main()
