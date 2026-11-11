import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// KVKK — ÜYEYE E-POSTA KAPALI (owner, 2026-11-10: "1" — üyeye giden e-posta kapansın, personel kalsın).
// Resend KVKK standart sözleşmesini imzalamadı. Yalnız `settings/studio.notifications.memberEmail = false`
// yazılır; personel e-postası (şifre sıfırlama, gece uyarıları) etkilenmez. Geri açmak: true.
//   pnpm tsx tools/migration/kvkk-uye-eposta-kapali-2026-11-11.ts            (kuru çalışma)
//   pnpm tsx tools/migration/kvkk-uye-eposta-kapali-2026-11-11.ts --apply
const STUDIO = 'retro'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/studio`)
  const before = (await ref.get()).get('notifications') ?? null
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`notifications: ${JSON.stringify(before)} → memberEmail: false`)
  if (apply) {
    await ref.set(
      { notifications: { ...(before ?? {}), memberEmail: false }, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'kvkk-uye-eposta-kapali-2026-11-11' } },
      { merge: true },
    )
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
