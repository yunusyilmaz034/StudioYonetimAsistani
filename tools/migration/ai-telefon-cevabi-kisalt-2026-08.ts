// "Arayabilir miyim?" sorusunun cevabı TEK cümle olsun (owner, 2026-08-31).
//
//   pnpm tsx tools/migration/ai-telefon-cevabi-kisalt-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-telefon-cevabi-kisalt-2026-08.ts --apply
//
// WHY. A customer asked *"Arayarak bilgi almak istiyorum, bu numaradan mı aramalıyım?"* — a yes/no
// question with a phone number as its answer. She got four sentences: the number, then the number
// again ("aynı numaradan bizi arayabilirsiniz"), then an explanation that this line cannot take
// voice calls, then an offer to keep talking here instead. The owner: *"çok uzatmış, karıştırmış."*
//
// The rule that produced it was not wrong — it already said to give the number in a short sentence.
// Two things went wrong around it:
//
//   1. The card explains WHY to the assistant ("bu hattan sesli görüşme yapılamaz"), and the
//      assistant recited that explanation to the customer. **Background is not copy.** Our own
//      technical limitation is not something a customer needs to be told; it makes the studio sound
//      like it is apologising for its telephone.
//   2. It appended "bu arada burada da anlatabilirim" — pulling her back to the channel she had just
//      said she did not want. A customer who asks to call has already chosen; answering with a
//      counter-offer reads as not listening.
//
// So the rule now carries THE ANSWER, verbatim, with the padding named and forbidden. A rule that
// describes the tone gets interpreted; a rule that contains the sentence gets copied.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

const ESKI =
  'İLETİŞİM NUMARASI (ÖNEMLİ): Bu WhatsApp hattı üzerinden SESLİ GÖRÜŞME yapılamaz. Müşteri aramak isterse, telefon numarası sorarsa, "sizinle konuşabilir miyim / arayabilir miyim" derse ya da yazışma dışında ulaşmak isterse 0533 199 41 23 numarasını ver: "Bize 0533 199 41 23 numaralı hattımızdan ulaşabilirsiniz 🌸". Bu numarayı vermek DEVRETMENİN yerine geçmez — yetkiliye aktarman gereken bir durum varsa yine [[DEVRET]] yaz; numara müşterinin bizzat aramak istediği durumlar içindir. Her mesaja numara ekleme, sadece gerektiğinde.'

const YENI =
  'İLETİŞİM NUMARASI (ÖNEMLİ — CEVAP KISA OLACAK): Müşteri aramak isterse, telefon numarası sorarsa, "bu numaradan mı arayayım / sizinle konuşabilir miyim" derse CEVAP TEK CÜMLEDİR ve şudur: ' +
  '"Tabii hanımefendi 🌸 0533 199 41 23 numaralı hattımızdan bizi arayabilirsiniz 🙏" (ismini biliyorsan "hanımefendi" yerine "Ayşe Hanım"). ' +
  'BU CEVABA HİÇBİR ŞEY EKLEME. Özellikle şunları YAZMA: (a) "bu yazışma hattından sesli görüşme yapılamıyor" — bu BİZİM iç kısıtımız, müşterinin bilmesi gereken bir şey değil ve stüdyoyu telefonu için özür diliyormuş gibi gösterir; ' +
  '(b) numarayı iki kez tekrarlama ("aynı numaradan da arayabilirsiniz" gibi); (c) "bu arada isterseniz burada da anlatabilirim / aklınıza takılan bir şey var mı" — aramak isteyen müşteri seçimini yapmıştır, karşı teklif onu dinlemediğin anlamına gelir. ' +
  'GENEL KURAL: kendi teknik kısıtlarımızı müşteriye ANLATMA; sadece yapabildiğimiz şeyi söyle. ' +
  'Numara vermek DEVRETMENİN yerine geçmez — yetkiliye aktarman gereken bir durum varsa yine [[DEVRET]] yaz. Her mesaja numara ekleme, sadece istendiğinde.'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as { policies?: string } | undefined
  if (typeof cur?.policies !== 'string') throw new Error('settings/ai okunamadı — hiçbir şey yazılmadı')

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  if (cur.policies.includes('CEVAP KISA OLACAK')) {
    console.log('ZATEN UYGULANMIŞ. Çıkılıyor.')
    return
  }
  if (!cur.policies.includes(ESKI)) {
    console.log('⚠ Beklenen kural bulunamadı — kart elle düzenlenmiş olabilir. Hiçbir şey yazılmadı.')
    return
  }

  const next = cur.policies.replace(ESKI, YENI)
  console.log('── YENİ KURAL ──')
  console.log(YENI)

  if (!apply) {
    console.log('\n(uygulamak için --apply)')
    return
  }
  await ref.set({ policies: next }, { merge: true })
  console.log('\n✓ Bilgi kartı güncellendi. AI bir sonraki mesajdan itibaren bunu okur — deploy gerekmez.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
