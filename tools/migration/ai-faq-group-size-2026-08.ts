// AI'ın cevaplayamadığı bir soruyu bilgi kartına ekle: "aletli pilates kaç kişilik grup?"
//
//   pnpm tsx tools/migration/ai-faq-group-size-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-faq-group-size-2026-08.ts --apply
//
// WHY. A prospective member asked the WhatsApp assistant how many people are in a reformer class and
// it could not answer — the knowledge card never said. That is exactly the kind of question that
// decides whether somebody comes in: "small group" is the product, and a number is what makes it
// believable.
//
// The number is not invented. Read from the studio's own sessions on 2026-08-19: 77 reformer
// sessions at capacity 8, one at 7, one at 6. Eight is the rule and the two others are exceptions,
// so the answer says "en fazla 8" rather than "8" — true on every session, including those two.
//
// Appended to `faq` rather than written into `basics`: the FAQ is where the assistant looks for a
// direct answer to a direct question, and it is the part the owner can edit alone without re-reading
// six thousand characters of free text.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

const ENTRY = {
  q: 'Aletli pilates (Reformer) kaç kişilik grupla yapılıyor?',
  a:
    'Reformer derslerimiz küçük gruplarla, en fazla 8 kişiyle yapılır. Herkesin kendi reformer aleti olur ve ' +
    'eğitmen ders boyunca tek tek ilgilenir; hareketleri seviyene göre uyarlar. Kalabalık bir salon değil, ' +
    'takip edilen bir ders — ilk kez yapıyorsan da rahatça başlayabilirsin. Rezervasyonlar uygulamadan yapılır, ' +
    'yerini önceden ayırtırsın.',
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() ?? {}
  const faq = ((cur as { faq?: { q: string; a: string }[] }).faq ?? []).slice()

  // Idempotent by the QUESTION: re-running must not give the assistant the same answer twice, which
  // would make it repeat itself in a reply.
  const already = faq.findIndex((f) => f.q.toLocaleLowerCase('tr').includes('kaç kişilik'))
  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')
  console.log(`mevcut SSS sayısı : ${faq.length}`)
  console.log(already >= 0 ? `→ var olan kayıt GÜNCELLENECEK (#${already + 1})` : '→ yeni kayıt EKLENECEK')
  console.log(`\nS: ${ENTRY.q}\nC: ${ENTRY.a}`)

  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  if (already >= 0) faq[already] = ENTRY
  else faq.push(ENTRY)

  // Merge, and only this field: the card carries the persona, the policies and the campaign note,
  // and a whole-document write here would take them with it.
  await ref.set({ faq }, { merge: true })
  console.log(`\n✓ Yazıldı. SSS sayısı: ${faq.length}`)
  process.exit(0)
}

void main()
