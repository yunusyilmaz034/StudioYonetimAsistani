import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

// İŞ İÇİN YAZANLAR INSTAGRAM HATTINDAN ÇIKAR (owner, 2026-11-24: "müşteri dışındakileri getirme, örneğin
// meriç ve sunay"). Panelin yeni "Müşteri değil" düğmesiyle aynı yazım: `settings/ai.ignoredContacts`a eklenir.
// Sohbet belgeleri yerinde kalır (Sohbetler → "Müşteri değil" filtresi); yeni mesajları saklanmaz.
//   pnpm tsx tools/migration/musteri-degil-2026-11-24.ts            (kuru çalışma)
//   pnpm tsx tools/migration/musteri-degil-2026-11-24.ts --apply
const STUDIO = 'retro'
const RUN = 'musteri-degil-2026-11-24'
const KEYS = [
  'ig_1140057942055592', // @pt.meric — iş için yazdı
  'ig_1903572474415507', // @sunaydrna — işbirliği için yazdı
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ai = db.doc(`studios/${STUDIO}/settings/ai`)
  const before = ((await ai.get()).get('ignoredContacts') as string[] | undefined) ?? []
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const id of KEYS) {
    const s = await db.doc(`studios/${STUDIO}/conversations/${id}`).get()
    if (!s.exists) throw new Error(`${id}: sohbet yok — durdum`)
    console.log(`  ${id}: @${String(s.get('handle'))} ${before.includes(id) ? '(zaten listede)' : '→ eklenecek'}`)
  }
  if (!apply) return void console.log('\nkuru çalışma — hiçbir şey yazılmadı')
  await ai.set(
    { ignoredContacts: FieldValue.arrayUnion(...KEYS), updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: RUN } },
    { merge: true },
  )
  const after = ((await ai.get()).get('ignoredContacts') as string[] | undefined) ?? []
  console.log(`✅ ignoredContacts: ${before.length} → ${after.length}`)
  process.exit(0)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
