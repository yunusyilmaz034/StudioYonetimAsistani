import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ASİSTANIN "TEK FİYAT" KURALINI GERÇEĞE UYDUR (owner, 2026-08-22).
//
//   pnpm tsx tools/migration/ai-two-prices-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ai-two-prices-2026-08.ts --apply
//
// WHY. `policies` içinde "TEK FİYAT (EN ÖNEMLİ KURAL): Fiyatlarımız TEKTİR… nakde özel indirimli
// bir liste YOKTUR" yazıyordu. Bu, o kural yazıldığında doğruydu. Bugün DEĞİL: fitness kampanyası
// (Temmuz) ve pilates kampanyası (bugün) beş pakete ayrı nakit fiyatı verdi.
//
// Asistan şu an doğru rakamları söylüyor — çünkü CANLI VERİ bloğu iki fiyatı da yazıyor ve model
// veriyi kuralın üstüne koyuyor. Ama bu şans eseri. "Nakit daha ucuz mu?" diye SORAN birine kural
// devreye girer ve asistan "fiyatımız tek hanımefendi" der; müşteri de az önce iki fiyat almıştır.
// İki doğru kaynak, biri eski — düzeltilmesi gereken şey bu.
//
// Üç yerde geçiyor ve üçü de değişiyor; biri kalırsa çelişki kalır.
//
// Yerine konan kural rakam TAŞIMIYOR: "listede kaç rakam varsa o kadarını söyle". Katalog değişince
// asistan kendiliğinden doğru kalır — buraya fiyat yazmak, düzelttiğimiz hatanın aynısını yapmaktır.

const STUDIO = 'retro'

const EDITS: readonly { field: string; from: string; to: string }[] = [
  {
    field: 'policies',
    from:
      'ÖDEME/FİYAT — TEK FİYAT (EN ÖNEMLİ KURAL): Fiyatlarımız TEKTİR. Nakit, havale/EFT ve kredi kartında AYNI tutar geçerlidir. Nakde özel indirimli bir liste YOKTUR, karta fark EKLENMEZ. "Nakit daha ucuz mu / nakit fiyatınız nedir" diye sorulursa net söyle: "Fiyatımız tek hanımefendi 🌸 nakit, havale ve kredi kartında aynı tutarı ödüyorsunuz." Fiyatı verirken "nakit şu, kartla bu" ŞEKLİNDE İKİ RAKAM SÖYLEME — CANLI VERİ listesindeki tek rakamı söyle.',
    to:
      'ÖDEME/FİYAT (EN ÖNEMLİ KURAL): Fiyat DAİMA CANLI VERİ listesinden okunur; asla hesaplanmaz, yuvarlanmaz, uydurulmaz. Listede o paket için KAÇ RAKAM yazıyorsa o kadarını söyle: tek rakam yazıyorsa o tutar nakit, havale/EFT ve kredi kartında aynıdır; "Nakit … / Kredi Kartı …" diye iki rakam yazıyorsa İKİSİNİ DE olduğu gibi söyle ve nakit fiyatını kartla ödeyecek birine verme. "Nakit daha ucuz mu / nakit fiyatınız nedir" diye sorulursa listeye bak: iki rakam varsa farkı açıkça söyle, tek rakam varsa "Fiyatımız tek hanımefendi 🌸 nakit, havale ve kredi kartında aynı tutarı ödüyorsunuz" de. Listede olmayan bir indirim ya da nakit farkı ASLA uydurma.',
  },
  {
    field: 'examples',
    from: "(güncel paketleri ve TEK fiyatlarını CANLI VERİ'den al — nakit/kart diye iki rakam verme).",
    to: "(paketleri ve fiyatları CANLI VERİ'den al; listede tek rakam varsa tek, \"Nakit … / Kredi Kartı …\" yazıyorsa iki rakamı da söyle).",
  },
  {
    field: 'basics',
    from: 'FİYAT: 3 Aylık ve 6 Aylık paketlerin nakit/kredi kartı fiyatlarını CANLI VERİ listesinden ver —',
    to: 'FİYAT: Nakit/kredi kartı fiyatı ayrı olan paketlerde İKİ rakamı da CANLI VERİ listesinden ver —',
  },
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const ref = db.doc(`studios/${STUDIO}/settings/ai`)
  const data = (await ref.get()).data() ?? {}
  const patch: Record<string, string> = {}

  for (const e of EDITS) {
    const cur = String((data as Record<string, unknown>)[e.field] ?? '')
    if (!cur.includes(e.from)) {
      console.log(`⚠ ${e.field}: aranan metin BULUNAMADI — elle bak, atlanıyor\n`)
      continue
    }
    // Bir metnin iki kez geçmesi, düzeltmenin yarısının kalması demektir.
    const count = cur.split(e.from).length - 1
    console.log(`${e.field}: ${count} eşleşme`)
    console.log(`  ESKİ: ${e.from.slice(0, 150)}…`)
    console.log(`  YENİ: ${e.to.slice(0, 150)}…\n`)
    patch[e.field] = cur.split(e.from).join(e.to)
  }

  if (Object.keys(patch).length === 0) {
    console.log('Değişecek bir şey yok.')
    process.exit(0)
  }
  if (!apply) {
    console.log('Uygulamak için --apply')
    process.exit(0)
  }

  await ref.set(patch, { merge: true })
  console.log(`✓ ${Object.keys(patch).length} alan güncellendi: ${Object.keys(patch).join(', ')}`)
  process.exit(0)
}

void main()
