// Pilates 16 Ders (2 aylık) yeniden satışta — AI de satabilsin (owner, 2026-08-31).
//
//   pnpm tsx tools/migration/ai-pilates-16-sellable-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-pilates-16-sellable-2026-08.ts --apply
//
// WHY. On 2026-08-06 the 16 and 24-lesson reformer packages were withdrawn, and the knowledge card
// was told to sell the 8-lesson one alone: *"16/24 derslik paketlerimiz şu an satışta değil"*, and
// to answer "2 aylık pilates var mı" with a flat no. The owner has now put the 16 (two months) back.
// The 24 stays withdrawn.
//
// TWO THINGS ARE BEING FIXED, and the second is the one worth noticing.
//
// 1. The permission itself: 8 and 16 are sellable, 24 is not.
//
// 2. **The card asserted something about the system that was not true.** It said the withdrawn
//    packages "canlı listede görünmezler". They do: the WhatsApp assistant's live price feed filters
//    on `p.active` alone (`whatsapp-webhook.ts` → `liveFacts`), and both 16 and 24 are active. The
//    assistant has been reading their prices all along and was silent only because the instruction
//    told it to be. That mattered: an instruction resting on a false claim about the system is one
//    somebody eventually "corrects" by trusting the claim. The rule is now stated as what it is — a
//    BUSINESS decision about what we sell — so it survives being read by someone who checks.
//
// NO PRICE IS WRITTEN HERE. The card's own standing rule is that numbers come from the live
// catalogue and are never typed into text (#12, AD-41). The 16-lesson price already reaches the
// assistant; what was missing was permission to say it.
//
// ALSO NOT DONE, deliberately: the product's `onlineSellable` / `memberSellable` flags stay OFF, so
// the package is still not purchasable from the member app or an online link. The owner asked for
// the ASSISTANT to be able to sell it, and a customer who says yes is closed by reception. Flipping
// a catalogue flag is a separate decision and his to make.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

const EDITS: readonly { readonly field: 'policies' | 'examples'; readonly find: string; readonly replace: string }[] = [
  {
    field: 'policies',
    find:
      'PİLATES PAKETİ (ŞU AN GEÇERLİ): Aletli/Reformer pilateste ŞU AN yalnızca 8 DERS paketi satılıyor. Fiyat verirken SADECE 8 ders paketini söyle. 16 ve 24 ders paketleri SATIŞTAN KALDIRILDI (2026-08-06): canlı listede görünmezler; sorulursa "16/24 derslik paketlerimiz şu an satışta değil 🌸" de ve 8 ders paketine yönlendir. Fiyatlarını ASLA söyleme. "2 aylık / 3 aylık pilates var mı" diye sorulursa: "Maalesef 2/3 aylık pilates paketimiz şu an aktif değil 🌸" de ve 8 derslik pilates paketine yönlendir.',
    replace:
      'PİLATES PAKETİ (ŞU AN GEÇERLİ): Aletli/Reformer pilateste 8 DERS (1 aylık) ve 16 DERS (2 aylık) paketleri satılıyor — ikisini de anlat ve fiyatlarını CANLI VERİ\'den ver. "2 aylık pilates var mı" diye sorulursa cevap EVET: 16 derslik paket 2 aylıktır. 24 DERS paketi SATIŞTA DEĞİLDİR (owner kararı, 31.08.2026 itibarıyla hâlâ geçerli): fiyatını verme, sorulursa "24 derslik paketimiz şu an satışta değil 🌸" de ve 16 ders paketine yönlendir. "3 aylık pilates var mı" → "3 aylık pilates paketimiz şu an aktif değil 🌸" de, 16 derslik (2 aylık) paketi öner. NOT: 24 ders paketi canlı fiyat listesinde GÖRÜNÜR — orada olması satılabileceği anlamına gelmez, satılabilirliği bu kural belirler.',
  },
  {
    field: 'examples',
    find: '**Reformer Pilates:** 8 Ders … \\n\\n**Fitness:**',
    replace: '**Reformer Pilates:** 8 Ders (1 aylık) …, 16 Ders (2 aylık) … \\n\\n**Fitness:**',
  },
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const cur = (await ref.get()).data() as { policies?: string; examples?: string } | undefined
  if (!cur?.policies || !cur.examples) throw new Error('settings/ai okunamadı — hiçbir şey yazılmadı')

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  // Sanity check against the CATALOGUE, before touching the card. Telling the assistant to sell a
  // package that is not active would have it quote a price nobody can take — the exact failure the
  // "never invent a number" rule exists to prevent, arriving through the front door instead.
  const products = await db.collection(`studios/${STUDIO}/products`).get()
  const p16 = products.docs.map((d) => d.data()).find((x) => String(x.name).includes('16 Ders'))
  if (!p16 || p16.active === false) {
    console.log('⚠ 16 derslik paket katalogda AKTİF DEĞİL. Önce Paketler ekranından aktif edilmeli.')
    return
  }
  console.log(`katalog : ${String(p16.name)} · ${p16.creditCount} ders · ${p16.durationDays} gün · aktif ✓`)

  const next = { policies: cur.policies, examples: cur.examples }
  let eksik = 0
  for (const [i, e] of EDITS.entries()) {
    const src = next[e.field]
    if (!src.includes(e.find)) {
      const zaten = src.includes(e.replace.slice(0, 60))
      console.log(`${i + 1}. ${e.field}: ${zaten ? 'ZATEN UYGULANMIŞ, atlanıyor' : '⚠ BULUNAMADI'}`)
      if (!zaten) eksik++
      continue
    }
    next[e.field] = src.replace(e.find, e.replace)
    console.log(`${i + 1}. ${e.field}: değiştirilecek`)
  }
  if (eksik > 0) {
    console.log('\n⚠ Beklenen metin bulunamadı — kart elle düzenlenmiş olabilir. --apply ÇALIŞTIRMA.')
    return
  }
  if (next.policies === cur.policies && next.examples === cur.examples) {
    console.log('\nDeğişiklik yok. Çıkılıyor.')
    return
  }

  console.log('\n── YENİ KURAL ──')
  console.log(next.policies.split('\n')[0])

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
