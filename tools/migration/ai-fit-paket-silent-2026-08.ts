// AI artık Fit Paket'ten HİÇ bahsetmesin — satmıyordu, artık anmıyor da (owner, 2026-08-31).
//
//   pnpm tsx tools/migration/ai-fit-paket-silent-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-fit-paket-silent-2026-08.ts --apply
//
// WHY. Yesterday's change stopped the assistant SELLING Fit Paket — the "free weekly surprise class"
// that came with a fitness membership had ended, and it went on being promised. It still described
// the classes when asked, and still counted them in the studio's opening line ("8 farklı grup
// dersi"). The owner has now decided it should not raise them at all.
//
// The distinction that shapes every edit below: **not mentioning is not the same as denying.** The
// classes still run — the live schedule had them on 02.09 and 04.09 — so the card never says "Fit
// Paket yok". Where a customer brings it up, the instruction is to HAND OVER, which is what the card
// already tells the assistant to do with any condition or price it does not know. An assistant that
// says "we don't have that" to a customer looking at a class that happened last week is worse than
// one that says nothing.
//
// Four places, and one of them was already contradicting itself:
//   1. `basics` opening line — "8 farklı grup dersi" counted them as a service on offer.
//   2. `basics` GRUP DERSLERİ / FİT PAKET section — replaced by a do-not-raise + hand-over rule.
//   3. `basics` MULTISPORT — listed the Fit Paket classes by name to say they were excluded. The
//      guard stays (Multisport covers reformer group classes ONLY) without naming them.
//   4. `examples` — the sample dialogue answered "fit paket sanırım adı" with the FITNESS
//      memberships, which the rules elsewhere in the card explicitly call wrong. Replaced with the
//      hand-over, so the example and the rule finally say the same thing.
//
// The BİTEN KAMPANYALAR block is left exactly as it is. It is a list of things the assistant must
// not promise, and deleting it would remove the guard rather than the subject.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

/** Bire bir değiştirilecek satırlar. Bulunamayan varsa --apply çalıştırılmaz. */
const EDITS: readonly { readonly find: string; readonly replace: string; readonly field: 'basics' | 'examples' | 'policies' }[] = [
  {
    // The disambiguation rule contradicted the new one outright: it named the five classes and told
    // the assistant to EXPLAIN them. Found by re-scanning the whole card for the words rather than
    // trusting the four places I had already decided to change.
    field: 'policies',
    find: '"FİT PAKET" = GRUP DERSLERİ (Mat Pilates, CrossFit, HIIT, Step, Crunch) — fitness üyeliği DEĞİL; müşteri "fit paket" derse hangisini kastettiğini anla: grup derslerini soruyorsa içeriğini anlat, spor salonunu soruyorsa fitness üyeliğini;',
    replace:
      '"FİT PAKET" iki şeye gelebilir: müşteri SPOR SALONUNU kastediyorsa fitness üyeliğini anlat. Grup derslerini kastediyorsa İÇERİĞİNİ ANLATMA, ders SAYMA — "yetkilimiz netleştirsin" deyip DEVRET (31.08.2026);',
  },
  {
    field: 'basics',
    find: 'Genel olarak Aletli Pilates, Fitness ve 8 farklı grup dersi hizmeti veriyoruz. Rahat, özgür ve',
    replace: 'Genel olarak Aletli Pilates ve Fitness hizmeti veriyoruz. Rahat, özgür ve',
  },
  {
    field: 'basics',
    find: 'Aletli/Reformer Pilates ve grup dersleri mobil uygulamadan RANDEVU ile; Fitness SINIRSIZ',
    replace: 'Aletli/Reformer Pilates mobil uygulamadan RANDEVU ile; Fitness SINIRSIZ',
  },
  {
    field: 'basics',
    find: `▸ GRUP DERSLERİ / FİT PAKET ("Fit Paket" BUNUN adıdır, fitness üyeliği DEĞİLDİR)
· İçindekiler: Mat Pilates · CrossFit / Cross & Total Body · HIIT · Step · Crunch.
· Rezervasyon uygulamadan yapılır.
· HİÇBİR PAKETE DAHİL DEĞİLDİR. Fit Paket derslerini herhangi bir üyeliğin hediyesi, ayrıcalığı
  ya da "ek olarak" verileni gibi ANLATMA. Fitness üyeliğini anlatırken Fit Paket derslerini
  ARTIK SAYMA.
· Dersler yapılmaya devam ediyor; "Fit Paket kalktı / artık yok" DEME. Müşteri bu derslere nasıl
  katılacağını sorarsa koşul ya da fiyat UYDURMA — yetkiliye devret.`,
    replace: `▸ GRUP DERSLERİ / FİT PAKET — HİÇ BAHSETME (owner, 31.08.2026)
· Bu dersleri KENDİLİĞİNDEN ANLATMA, sayma, hizmet listesine katma, hiçbir paketin içinde ya da
  hediyesi gibi GÖSTERME. Stüdyoyu tanıtırken Aletli Pilates ve Fitness'tan bahset, buradan değil.
· Ama "yok" da DEME. Dersler yapılmaya devam ediyor; "Fit Paket kalktı / öyle bir şey yok" demek
  yanlış olur ve müşteri geçen haftaki dersi görmüş olabilir.
· Müşteri kendisi sorarsa: içerik, koşul ya da fiyat UYDURMA, listeleme, tarih verme —
  "Bu konuyu yetkilimiz netleştirsin, hemen bağlıyorum" deyip DEVRET.`,
  },
  {
    field: 'basics',
    find: '· KAPSAMAZ: Fitness alanı, Fit Paket dersleri (Mat Pilates · CrossFit · HIIT · Step · Crunch) ve özel ders/PT. "Mat pilates de pilates" diye düşünme — Fit Paket dersleri Multisport\'a KAPALIDIR.',
    replace:
      '· KAPSAMAZ: Fitness alanı, özel ders/PT ve Reformer DIŞINDAKİ her ders. "Mat pilates de pilates" diye düşünme — Multisport YALNIZCA aletli/reformer grup dersinde geçerlidir, başka hiçbir derste değil.',
  },
  {
    field: 'examples',
    find: 'Müşteri: "Fit paket sanırım adı" → "Tabii hanım 🌸 Fitness üyeliklerimiz şöyle: 3 Aylık …, 6 Aylık …, 12 Aylık … — RAKAMLARI CANLI VERİ\'den al, her paket için TEK rakam. Hangisini detaylandırayım?" (paket adını sorgulama, listeyi ver).',
    replace:
      'Müşteri: "Fit paket sanırım adı" → "Tabii hanım 🌸 Bu konuyu yetkilimiz netleştirsin, hemen bağlıyorum 🙏" (Fit Paket / grup dersi konusu DEVREDİLİR: içerik, koşul, fiyat verme. Müşteri spor salonunu kastediyorsa fitness üyeliklerini anlat.).',
  },
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as { basics?: string; examples?: string; policies?: string } | undefined
  if (!cur?.basics || !cur.examples || !cur.policies) throw new Error('settings/ai okunamadı — hiçbir şey yazılmadı')

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const next = { basics: cur.basics, examples: cur.examples, policies: cur.policies }
  let eksik = 0
  for (const [i, e] of EDITS.entries()) {
    const src = next[e.field]
    if (!src.includes(e.find)) {
      // Zaten uygulanmışsa da burada görünür — ve o durumda tekrar yazmamak DOĞRU davranıştır.
      const zaten = src.includes(e.replace.split('\n')[0]!)
      console.log(`${i + 1}. ${e.field}: ${zaten ? 'ZATEN UYGULANMIŞ, atlanıyor' : '⚠ BULUNAMADI'}`)
      if (!zaten) eksik++
      continue
    }
    next[e.field] = src.replace(e.find, e.replace)
    console.log(`${i + 1}. ${e.field}: değiştirilecek`)
  }

  if (eksik > 0) {
    console.log('\n⚠ Beklenen metinlerin hepsi bulunamadı — kart elle düzenlenmiş olabilir.')
    console.log('  Ayarlar → AI Ayarları ekranından bakmadan --apply ÇALIŞTIRMA.')
    return
  }
  if (next.basics === cur.basics && next.examples === cur.examples && next.policies === cur.policies) {
    console.log('\nDeğişiklik yok. Çıkılıyor.')
    return
  }

  // Kör yazma yok: değişen bölümü göster.
  const b = next.basics.split('\n')
  const bas = b.findIndex((l) => l.startsWith('▸ GRUP DERSLERİ'))
  console.log('\n── YENİ HÂLİ (grup dersleri bölümü) ──')
  console.log(b.slice(bas, bas + 8).join('\n'))

  if (!apply) {
    console.log('\n(uygulamak için --apply)')
    return
  }
  await ref.set(next, { merge: true })
  console.log('\n✓ Bilgi kartı güncellendi. AI bir sonraki mesajdan itibaren bunu okur — deploy gerekmez.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
