import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// FT-2 — PARAŞÜT TAHSİLAT HESABI (owner, 2026-11-10: "onayladım").
// Her e-Arşiv peşin gider; Paraşüt'te tek hesap var: Kasa Hesabı (1000700978). Bütün yöntemler ona.
// Muhasebeci banka ayrımı isterse Ayarlar → Fatura'dan değişir. Yalnız `parasut.accountByMethod` yazılır.
//   pnpm tsx tools/migration/ft2-parasut-kasa-hesabi-2026-11-10.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ft2-parasut-kasa-hesabi-2026-11-10.ts --apply
const STUDIO = 'retro'
const KASA = '1000700978'
const ACCOUNTS = { bank_transfer: KASA, online: KASA, cash: KASA, credit_card: KASA, pos: KASA }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/invoicing`)
  const before = (await ref.get()).get('parasut.accountByMethod') ?? null
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`Hesaplar: ${JSON.stringify(before)} → ${JSON.stringify(ACCOUNTS)}`)
  if (apply) {
    await ref.update({ 'parasut.accountByMethod': ACCOUNTS, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'ft2-parasut-kasa-hesabi-2026-11-10' } })
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
