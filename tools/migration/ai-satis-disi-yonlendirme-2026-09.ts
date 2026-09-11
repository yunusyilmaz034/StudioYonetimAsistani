import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AI YÖNLENDİRME CÜMLESİ — SÖZ VERMEYİ BIRAKIYOR (owner, 2026-09-11).
//
//   pnpm tsx tools/migration/ai-satis-disi-yonlendirme-2026-09.ts
//   pnpm tsx tools/migration/ai-satis-disi-yonlendirme-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Bir üye "bugün son günümdü ama gelemeyeceğim, haftaya gelsem olur mu" yazdı. AI cevapladı:
// *"hemen resepsiyonumuza iletelim, size dönüş yapsınlar."* Kimse iletmedi, kimse dönmedi — çünkü
// AI ne iletebilir ne de iletildiğini görebilir. Owner: *"AI bu şekilde yaparsa bizi zor durumda
// bırakıyor."*
//
// Bilgi kartındaki YÖNLENDİR listesi zaten doğruydu. Bozuk olan, modelin birebir kopyaladığı
// YÖNLENDİRME CÜMLESİ'ydi: *"…yazarsanız hemen ilgilenirler"* — bu bir söz, ve sözü stüdyo tutmak
// zorunda kalıyor.
//
// Yeni cümle hiçbir şey vaat etmiyor: nereye yazılacağını söylüyor, o kadar.
//
// Numara KODA YAZILMIYOR, kartın kendi içinden geliyor — bu bir platform ve ikinci stüdyonun
// numarası başka.

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')

const ESKI = `YÖNLENDİRME CÜMLESİ (kısa tut, tek seferde, ARDINDAN KONUYU TAKİP ETME):
  "Bu konuda size resepsiyonumuz yardımcı olsun hanımefendi 🌸 0533 199 41 23 numarasına yazarsanız hemen
   ilgilenirler 🙏"
Yönlendirdikten sonra o konuda tahminde bulunma, saat verme, söz verme.`

const YENI = `YÖNLENDİRME CÜMLESİ (TEK CÜMLE, ARDINDAN HİÇBİR ŞEY):
  "Bu konu için 0533 199 41 23 numaralı hattımıza yazmanız yeterli hanımefendi 🌸"
BAŞKASI ADINA SÖZ VERME. Şunları ASLA yazma: "resepsiyonumuza iletelim" · "size dönüş yapsınlar" ·
"hemen ilgilenirler" · "kontrol edip döneriz" · "not aldım". Hepsi, tutmak zorunda kalacak kişinin
sen olmadığın bir sözdür; tutulmadığında stüdyo zor durumda kalır (owner, 11.09.2026).
Yönlendirdikten sonra o konuda tahminde bulunma, saat verme, söz verme, çözüm önerme.`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/ai`)
  const snap = await ref.get()
  const eski = String(snap.get('escalation') ?? '')

  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  if (!eski.includes(ESKI)) {
    // METİN DEĞİŞMİŞSE DOKUNMA. Kart owner'ın düzenleyebildiği bir alan; körlemesine üzerine
    // yazmak, onun elle yaptığı bir düzeltmeyi sessizce geri alabilir.
    console.log('DUR: beklenen cümle bulunamadı — kart elle değişmiş olabilir. Hiçbir şey yazılmadı.')
    console.log('Aranan:\n' + ESKI)
    return
  }
  const yeni = eski.replace(ESKI, YENI)
  console.log('ÇIKAN:\n' + ESKI + '\n\nGİREN:\n' + YENI)
  if (!APPLY) { console.log('\n--apply ile çalıştırın.'); return }
  await ref.set({ escalation: yeni }, { merge: true })
  console.log('\n✓ bilgi kartı güncellendi')
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
