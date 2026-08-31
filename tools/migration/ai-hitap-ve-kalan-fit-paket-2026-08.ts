// İki düzeltme: (1) müşteriye "hocam" DEME, (2) kartta kalan Fit Paket satışını kaldır.
// (owner, 2026-08-31 — canlı bir sohbette yakalandı)
//
//   pnpm tsx tools/migration/ai-hitap-ve-kalan-fit-paket-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-hitap-ve-kalan-fit-paket-2026-08.ts --apply
//
// ── 1. HİTAP ────────────────────────────────────────────────────────────────────────────────
// A member wrote *"Hocam işe ve okulum başladığından…"* and the assistant answered *"Anlıyorum
// hocam 🌸"*. It was following the card: the tone line listed `"hanımefendi / hocam"` as the studio's
// forms of address. But those two are not interchangeable — **"hocam" is what the customer calls US.**
// Handing it back turns the member into the instructor, and in a women-only studio where the actual
// hoca is the owner, it reads as either a mistake or a shrug.
//
// The rule is written as an ANTI-MIRRORING rule rather than a banned word, because the failure is
// mirroring: the assistant already had a rule not to return a kiss emoji, for exactly the same
// reason — matching a customer's register is not the same as returning it.
//
// ── 2. THE FIT PAKET LINES I MISSED THIS MORNING ────────────────────────────────────────────
// The owner asked twice for the assistant to stop offering the "free surprise Fit Paket class with a
// fitness membership". Three lines survived both passes, and one of them told the assistant it was
// *"en güçlü satış argümanlarımızdan"*.
//
// They survived because my search could not see them. `/fit ?paket/i` does not match "FİT PAKET":
// Turkish dotted İ (U+0130) does not case-fold to ASCII `i`, so a case-insensitive ASCII pattern
// misses every word typed in Turkish capitals — which is exactly how sales copy gets written. Every
// scan of this card now folds İ/I/ı/i to one letter first.
//
// The lesson is bigger than this card: **a search that silently finds nothing looks identical to a
// search that finds nothing because there is nothing.** I reported the card clean on the strength of
// the second reading while the first was true.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

type Field = 'tone' | 'basics' | 'policies'

const EDITS: readonly { readonly field: Field; readonly find: string; readonly replace: string; readonly why: string }[] = [
  {
    field: 'tone',
    why: 'hitap: "hocam" kaldırıldı + ayna kuralı',
    find:
      'Samimi ve sıcak; "hanımefendi / hocam" hitabı, siz dili, çözüm-odaklı.',
    replace:
      'Samimi ve sıcak; "hanımefendi" hitabı (ismini biliyorsan "Ayşe Hanım"), siz dili, çözüm-odaklı. MÜŞTERİYE ASLA "hocam" DEME: "hocam" müşterinin BİZE söylediği hitaptır, bizim ona söylediğimiz değil. Müşteri sana "hocam" derse aynısını GERİ VERME — "hanımefendi" ya da "efendim" ile karşıla. Aynı kural "canım", "hanımcım", "kardeşim" için de geçerlidir.',
  },
  {
    field: 'tone',
    why: 'Fit Paket satış argümanı (tone) kaldırıldı',
    find:
      '"Fitness üyelerimize özel, haftanın belirli günlerinde SÜRPRİZ FİT PAKET dersleri (Mat Pilates, HIIT, Step, Crunch ve farklı antrenman içerikleri)" cümlesi en güçlü satış argümanlarımızdandır — FITNESS soran kişiye söyle.',
    replace:
      'FITNESS anlatırken en güçlü argümanlar şunlardır: sınırsız kullanım (rezervasyon derdi yok), kişiye özel antrenman programı, aylık program güncellemesi ve birebir takip, düzenli yağ-kas ölçümü. Fitness üyeliğine ek ders/hediye VAAT ETME.',
  },
  {
    field: 'basics',
    why: 'Fit Paket maddesi (fitness içerikleri listesi) kaldırıldı',
    find: `📍 Fitness üyelerimize özel, rutininizi renklendiren, haftanın belirli günlerinde SÜRPRİZ FİT PAKET
   DERSLERİ (Mat Pilates, HIIT, Step, Crunch ve farklı antrenman içerikleri)`,
    replace: '📍 Sınırsız kullanım — rezervasyon yok, uyan saatte gelirsiniz',
  },
  {
    field: 'policies',
    why: 'Fit Paket vaadi (fitness paket tanımı) kaldırıldı',
    find:
      'FITNESS: Sınırsız kullanım (rezervasyon yok) + kişiye özel program + düzenli ölçüm/güncelleme; fitness üyelerine ÖZEL olarak haftanın belirli günlerinde SÜRPRİZ FİT PAKET dersleri (Mat Pilates, HIIT, Step, Crunch ve farklı antrenman içerikleri) açılır.',
    replace:
      'FITNESS: Sınırsız kullanım (rezervasyon yok) + kişiye özel program + düzenli ölçüm/güncelleme. Fitness üyeliğinin içinde ek ders / hediye ders YOKTUR — böyle bir şey VAAT ETME.',
  },
]

/** Türkçe-güvenli küçültme. `/fit/i` "FİT" ile eşleşmez; İ/I/ı/i tek harfe indirilir. */
const norm = (s: string): string =>
  s.replace(/[İIıi]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g').replace(/[Çç]/g, 'c').toLowerCase()

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as Record<Field, string | undefined> | undefined
  if (!cur?.tone || !cur.basics || !cur.policies) throw new Error('settings/ai okunamadı — hiçbir şey yazılmadı')

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const next: Record<Field, string> = { tone: cur.tone, basics: cur.basics, policies: cur.policies }
  let eksik = 0
  for (const [i, e] of EDITS.entries()) {
    const src = next[e.field]
    if (!src.includes(e.find)) {
      const zaten = src.includes(e.replace.slice(0, 50))
      console.log(`${i + 1}. ${e.field.padEnd(9)} ${zaten ? 'ZATEN UYGULANMIŞ' : '⚠ BULUNAMADI'}  (${e.why})`)
      if (!zaten) eksik++
      continue
    }
    next[e.field] = src.replace(e.find, e.replace)
    console.log(`${i + 1}. ${e.field.padEnd(9)} değiştirilecek     (${e.why})`)
  }
  if (eksik > 0) {
    console.log('\n⚠ Beklenen metin bulunamadı — kart elle düzenlenmiş olabilir. --apply ÇALIŞTIRMA.')
    return
  }

  // Yazmadan ÖNCE ve sonra, Türkçe-güvenli doğrulama: satış vaadi bırakan bir satır kaldı mı?
  const kalan = (['tone', 'basics', 'policies'] as Field[]).flatMap((f) =>
    next[f]
      .split('\n')
      .map((l, i) => ({ f, i: i + 1, l }))
      // Sadece VAAT eden satırlar: "bahsetme/deme/bitmiştir" diyen koruma satırları kalmalı.
      .filter(({ l }) => {
        const n = norm(l)
        if (!n.includes(norm('FİT PAKET')) && !n.includes('surpriz')) return false
        return !/deme|anlatma|bahsetme|bitmi|satma|vaat etme|devret|yok/i.test(norm(l))
      }),
  )
  if (kalan.length) {
    console.log('\n⚠ Hâlâ VAAT eden satır var:')
    for (const k of kalan) console.log(`   ${k.f}:${k.i}| ${k.l.slice(0, 140)}`)
  } else {
    console.log('\n✓ Kartta Fit Paket VAAT eden satır kalmadı (yalnızca "bahsetme" koruma satırları).')
  }

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
