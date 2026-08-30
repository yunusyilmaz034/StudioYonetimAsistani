// Fitness üyeliğinin "haftada 1 gün sürpriz Fit Paket dersi hediye" ayrıcalığı bitti — AI artık
// bunu söylemesin.
//
//   pnpm tsx tools/migration/ai-fit-paket-gift-ended-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-fit-paket-gift-ended-2026-08.ts --apply
//
// WHY. The knowledge card told the assistant, twice, that Fit Paket classes are a FITNESS
// membership's privilege — surprise sessions opened on certain days of the week. The owner ended
// that on 2026-08-30. An assistant that keeps saying it is not merely out of date: it is making a
// promise the desk then has to break, in writing, to a prospect who bought partly because of it.
//
// WHAT IS *NOT* CHANGING. The classes themselves still run — the live schedule has Fit Paket
// sessions on 02.09 and 04.09, and five were held the week before. So the card must not swing to
// "Fit Paket yok" either; that is the same lie pointing the other way. Exactly one claim is
// removed: that some package includes them.
//
// The card already carries a precedent for this — the reformer "grup dersleri dahil" campaign that
// ended earlier is not deleted but explicitly marked BİTMİŞTİR, because silence lets the model
// reconstruct a plausible-sounding offer from the rest of the text. This ends the same way, in the
// same section, for the same reason.
//
// Who may join now is deliberately left UNANSWERED, because nobody has told me the new rule. The
// card's own standing instruction covers that case: if price or condition is unclear, do not invent
// — hand to a human.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

/** Kaldırılacak satırlar — kart'ta bire bir bu hâlleriyle duruyorlar. */
const KALDIR = [
  '· FITNESS üyelerine özel, haftanın belirli günlerinde SÜRPRİZ Fit Paket dersleri açılır.',
  '· Fit Paket dersleri artık FITNESS üyeliğinin bir ayrıcalığıdır: fitness üyelerine özel,',
  '  haftanın belirli günlerinde SÜRPRİZ olarak açılır.',
]

/** 68. satırın (rezervasyon) ardına gelecek yeni kural. */
const ANCHOR_REZERVASYON = '· Rezervasyon uygulamadan yapılır.'
const YENI_KURAL = [
  '· HİÇBİR PAKETE DAHİL DEĞİLDİR. Fit Paket derslerini herhangi bir üyeliğin hediyesi, ayrıcalığı',
  '  ya da "ek olarak" verileni gibi ANLATMA. Fitness üyeliğini anlatırken Fit Paket derslerini',
  '  ARTIK SAYMA.',
  '· Dersler yapılmaya devam ediyor; "Fit Paket kalktı / artık yok" DEME. Müşteri bu derslere nasıl',
  '  katılacağını sorarsa koşul ya da fiyat UYDURMA — yetkiliye devret.',
]

const ESKI_BASLIK = '▸ ÖNEMLİ — BİTEN KAMPANYA'
const YENI_BASLIK = '▸ ÖNEMLİ — BİTEN KAMPANYALAR (ikisi de bitti; ikisini de hâlâ geçerliymiş gibi anlatma)'

/** Biten kampanya listesine eklenecek ikinci madde. */
const ANCHOR_KAMPANYA = '· Bunu ASLA hâlâ geçerliymiş gibi anlatma. Aletli pilates paketini grup dersleri dahil diye SATMA.'
const IKINCI_KAMPANYA = [
  '· "Fitness üyeliğine ek, haftada 1 gün SÜRPRİZ Fit Paket dersi hediye" kampanyası da BİTMİŞTİR',
  '  (30.08.2026). Bunu da hâlâ geçerliymiş gibi anlatma, fitness paketini bu hediyeyle SATMA.',
]

function donustur(basics: string): { sonuc: string; kaldirilan: number; eklendi: boolean } {
  const satirlar = basics.split('\n')
  const once = satirlar.length
  const kalan = satirlar.filter((s) => !KALDIR.includes(s.trimEnd()))
  const kaldirilan = once - kalan.length

  // Zaten uygulanmışsa ikinci kez ekleme — model aynı kuralı iki kez okumasın.
  const zaten = kalan.some((s) => s.includes('HİÇBİR PAKETE DAHİL DEĞİLDİR'))

  const cikti: string[] = []
  for (const s of kalan) {
    const t = s.trimEnd()
    if (t === ESKI_BASLIK) {
      cikti.push(YENI_BASLIK)
      continue
    }
    cikti.push(s)
    if (zaten) continue
    if (t === ANCHOR_REZERVASYON) cikti.push(...YENI_KURAL)
    if (t === ANCHOR_KAMPANYA) cikti.push(...IKINCI_KAMPANYA)
  }
  // Kaldırılan maddelerin ardında boş bir "▸ ÖNEMLİ" bloğu ya da çift boş satır bırakma.
  const temiz = cikti.join('\n').replace(/\n{3,}/g, '\n\n')
  return { sonuc: temiz, kaldirilan, eklendi: !zaten }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as { basics?: string } | undefined
  if (!cur || typeof cur.basics !== 'string') throw new Error('settings/ai bulunamadı ya da basics yok — hiçbir şey yazılmadı')

  const { sonuc, kaldirilan, eklendi } = donustur(cur.basics)

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')
  console.log(`kaldırılan satır : ${kaldirilan} (beklenen 3)`)
  console.log(`yeni kural       : ${eklendi ? 'eklenecek' : 'ZATEN VAR, tekrar eklenmiyor'}`)

  if (kaldirilan !== KALDIR.length) {
    console.log('\n⚠ Beklenen satırların hepsi bulunamadı. Kart elle düzenlenmiş olabilir —')
    console.log('  Ayarlar → AI Ayarları ekranından bakılmadan --apply ÇALIŞTIRMA.')
  }

  if (sonuc === cur.basics) {
    console.log('\nDeğişiklik yok. Çıkılıyor.')
    return
  }

  // Değişen bölümü göster: kör bir yazma yapmıyoruz.
  const yeni = sonuc.split('\n')
  const bas = yeni.findIndex((s) => s.startsWith('▸ GRUP DERSLERİ'))
  const son = yeni.findIndex((s, i) => i > bas && s.startsWith('▸ ÖZEL DERS'))
  console.log('\n── YENİ HÂLİ ──')
  console.log(yeni.slice(Math.max(0, bas), son > 0 ? son : bas + 20).join('\n'))

  if (!apply) {
    console.log('\n(uygulamak için --apply)')
    return
  }

  await ref.set({ basics: sonuc }, { merge: true })
  console.log('\n✓ Bilgi kartı güncellendi. AI bir sonraki mesajdan itibaren bu metni okur — deploy gerekmez.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
