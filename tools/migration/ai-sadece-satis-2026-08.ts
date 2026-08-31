// AI hattı SATIŞ hattıdır. Satış dışı her konuyu 0533 199 41 23'e yönlendirsin. (owner, 2026-08-31)
//
//   pnpm tsx tools/migration/ai-sadece-satis-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-sadece-satis-2026-08.ts --apply
//
// WHY, and it happened today. Reception sent the Monday motivation message to the whole roster over
// WhatsApp — 154 members received it from the API number. That number had, until then, only ever
// been seen by people who wrote to the ads. Now 154 existing members have it saved as "the studio",
// and they are writing to it about their own memberships: what time is my class, can I move it, my
// package is ending. The assistant, built to sell, is trying to answer all of it.
//
// The owner's rule: **this line is for new customers and sales. Everything else goes to
// 0533 199 41 23** — the line reception actually watches.
//
// The rule is written by TOPIC, not by whether the writer is a member. The assistant does not know
// who is writing; it knows what is being asked. And the two do not line up anyway: a member may ask
// about a new package (answer it), and a stranger may ask about a lost item (redirect).
//
// It is placed in `escalation`, which already exists for "hand this over", and given its own explicit
// block so it is not buried among the older cases. The existing `[[DEVRET]]` operator hand-off is
// UNTOUCHED: that is for a live conversation the desk should take over inside the panel. This is
// different — it tells the person to write somewhere else, because the answer lives with reception
// and not in this thread.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'
const HAT = '0533 199 41 23'

const YENI_KURAL = `
BU HAT SATIŞ HATTIDIR — SATIŞ DIŞI KONULARI ${HAT}'E YÖNLENDİR (owner, 31.08.2026)
Bu numarayı artık mevcut üyeler de biliyor ve kendi üyelikleriyle ilgili yazıyorlar. Bu hat yeni
müşteri ve satış içindir; günlük işleri resepsiyon ${HAT} hattından yürütür.
CEVAPLA (satış): paket içerikleri ve fiyatları · hizmetlerin nasıl işlediği · stüdyo/adres/park ·
  kadınlara özel olması · nasıl başlanır · yeni üyelik almak isteyen mevcut üye.
YÖNLENDİR (satış değil): "dersimi değiştirir misiniz / iptal eder misiniz" · "hangi saatte yerim
  var" · "bugün geliyorum" · "paketim ne zaman bitiyor / kaç dersim kaldı" · "uygulamaya giremiyorum
  / şifremi unuttum" · eşya kaybı · fatura/dekont · hoca veya ders şikâyeti · sağlık durumu ·
  "Işıl Hoca'ya ulaşabilir miyim" · ve tanımadığın her konu.
YÖNLENDİRME CÜMLESİ (kısa tut, tek seferde, ARDINDAN KONUYU TAKİP ETME):
  "Bu konuda size resepsiyonumuz yardımcı olsun hanımefendi 🌸 ${HAT} numarasına yazarsanız hemen
   ilgilenirler 🙏"
Yönlendirdikten sonra o konuda tahminde bulunma, saat verme, söz verme. Kişi ısrar ederse aynı
numarayı bir kez daha nazikçe hatırlat.
ÖNEMLİ — ÖNCE SELAM, SONRA YÖNLENDİRME: kuru bir "başka numaraya yazın" soğuk durur. Önce kısa bir
karşılama/anlayış cümlesi kur, sonra numarayı ver.
İSTİSNA: kişi aynı mesajda hem satış hem işlem soruyorsa, SATIŞ kısmını cevapla, işlem kısmı için
numarayı ver.
`.trim()

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as { escalation?: string } | undefined
  if (typeof cur?.escalation !== 'string') throw new Error('settings/ai okunamadı — hiçbir şey yazılmadı')

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  if (cur.escalation.includes('BU HAT SATIŞ HATTIDIR')) {
    console.log('ZATEN UYGULANMIŞ. Çıkılıyor.')
    return
  }

  // Öne konuyor: model uzun bir metnin BAŞINI daha güvenilir uyguluyor, ve bu kural artık
  // eskilerinden daha sık devreye girecek.
  const next = `${YENI_KURAL}\n\n${cur.escalation}`

  console.log('── ESKİ escalation ──')
  console.log(cur.escalation)
  console.log('\n── YENİ escalation (başa eklendi) ──')
  console.log(next)

  if (!apply) {
    console.log('\n(uygulamak için --apply)')
    return
  }
  await ref.set({ escalation: next }, { merge: true })
  console.log('\n✓ Bilgi kartı güncellendi. AI bir sonraki mesajdan itibaren bunu okur — deploy gerekmez.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
