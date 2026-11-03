import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// IG-5a — REKLAM TAVANLARI VE META KİMLİKLERİ (owner, 2026-11-04).
//
//   pnpm tsx tools/migration/ig5a-reklam-tavanlari-2026-11-04.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ig5a-reklam-tavanlari-2026-11-04.ts --apply
//
// Owner: *"tavan günde 300 TL kampanya başı 6000 TL"*. Tavan VERİDİR (kodda sabit değil): domain
// `settings/ads`tan okur; tavan yoksa hiçbir kampanya önerilemez. Sayfa ve Instagram kimlikleri de
// burada — reklam bunlardan yayınlanır. Para kuruş (#10).

const STUDIO = 'retro'
const PATCH = {
  dailyCapKurus: 30_000, // 300 TL / gün
  campaignCapKurus: 600_000, // 6.000 TL / kampanya
  pageId: '105975022531045', // FB sayfası "Pilates By Işıl"
  igUserId: '17841458516080649', // @pilatesbyisil
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/ads`)
  const before = (await ref.get()).data() ?? {}
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──')
  for (const [k, v] of Object.entries(PATCH)) console.log(`${k}: ${before[k] ?? '(yok)'}  →  ${v}`)
  console.log(`adAccountId (dokunulmuyor): ${before.adAccountId ?? '(yok)'}`)
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  await ref.set(PATCH, { merge: true })
  console.log('✓ yazıldı')
  process.exit(0)
}

void main()
