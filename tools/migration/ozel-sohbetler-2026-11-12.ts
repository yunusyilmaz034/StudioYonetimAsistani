import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// SAHİPLERİN KENDİ YAZIŞMALARI SOHBETLER'DEN ÇIKAR (owner, 2026-11-12: "ışıl ve benim yunus olan yazışmalar
// buraya gelmesin"). OR-135.
//   pnpm tsx tools/migration/ozel-sohbetler-2026-11-12.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ozel-sohbetler-2026-11-12.ts --apply
//
// 1 · `settings/ai.ignoredContacts` — bu anahtarlardan gelen mesaj artık hiç saklanmaz, AI cevap vermez.
// 2 · Mevcut sohbet belgeleri SİLİNMEZ: `conversationsPrivate/` altına taşınır (aynı id, aynı içerik). Panel o
//     koleksiyonu okumaz; içerik kaybolmaz, gerekirse geri taşınır.
const STUDIO = 'retro'
const KEYS = [
  '905536152629', // Işıl Yılmaz — WhatsApp
  '905079666783', // Yunus Yılmaz — WhatsApp (henüz sohbeti yok)
  'ig_1666205161584508', // Işıl Yılmaz — Instagram
  'ig_1480695200595334', // Yunus Yılmaz — Instagram
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ai = db.doc(`studios/${STUDIO}/settings/ai`)
  const before = ((await ai.get()).get('ignoredContacts') as string[] | undefined) ?? []
  const list = [...new Set([...before, ...KEYS])]
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`ignoredContacts: ${JSON.stringify(before)} → ${JSON.stringify(list)}`)
  const moves: { id: string; data: FirebaseFirestore.DocumentData }[] = []
  for (const id of KEYS) {
    const s = await db.doc(`studios/${STUDIO}/conversations/${id}`).get()
    if (s.exists) moves.push({ id, data: s.data()! })
    console.log(`  ${id}: ${s.exists ? `"${s.get('name')}" — taşınacak` : 'sohbet yok'}`)
  }
  if (!apply) return void console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const b = db.batch()
  b.set(ai, { ignoredContacts: list, updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: 'ozel-sohbetler-2026-11-12' } }, { merge: true })
  for (const m of moves) {
    b.set(db.doc(`studios/${STUDIO}/conversationsPrivate/${m.id}`), { ...m.data, movedAt: Timestamp.now(), movedBy: 'ozel-sohbetler-2026-11-12' })
    b.delete(db.doc(`studios/${STUDIO}/conversations/${m.id}`))
  }
  await b.commit()
  console.log(`✅ liste yazıldı, ${moves.length} sohbet conversationsPrivate/ altına taşındı`)
  process.exit(0)
}
void main()
