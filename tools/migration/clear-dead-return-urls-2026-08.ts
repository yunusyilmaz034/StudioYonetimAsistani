// Ayarlardaki ölü dönüş adreslerini temizle.
//
//   pnpm tsx tools/migration/clear-dead-return-urls-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/clear-dead-return-urls-2026-08.ts --apply
//
// WHY. `settings/paymentProvider.successUrl` and `.failUrl` both pointed at
// `https://panel.pilatesfitnessbyisil.com/payments/return` — a page that does not exist and never
// has. Anyone paying for a PACKAGE (Sanal POS or link) was sent there afterwards, got a 307 to the
// staff login, and saw nothing telling her the payment had gone through. It has been live on PayTR
// this whole time; it surfaced only while wiring TAMI, because TAMI's return is the same field.
//
// Blanking them is the fix rather than creating the page: the code already falls back to `/portal`,
// which is the member's own screen and shows her the package she just bought. An empty field means
// "use the sane default" and cannot rot again.
//
// The wallet, collection and public-membership flows carry their own destinations and are untouched.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'
const DEAD = '/payments/return'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/paymentProvider`)
  const snap = await ref.get()
  const cur = (snap.data() ?? {}) as Record<string, unknown>

  const patch: Record<string, string> = {}
  for (const field of ['successUrl', 'failUrl'] as const) {
    const v = String(cur[field] ?? '')
    if (v.includes(DEAD)) patch[field] = ''
    console.log(`${field.padEnd(12)} ${v || '(boş)'}${v.includes(DEAD) ? '   → BOŞALTILACAK (varsayılan: /portal)' : '   (dokunulmuyor)'}`)
  }

  if (Object.keys(patch).length === 0) {
    console.log('\nTemizlenecek bir şey yok.')
    process.exit(0)
  }
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  await ref.set(patch, { merge: true })
  console.log('\n✓ Temizlendi. Ödeme sonrası üye artık /portal ekranına döner.')
  process.exit(0)
}

void main()
