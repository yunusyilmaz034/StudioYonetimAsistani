import { FirestoreCatalogRepository, systemClock, updateProduct, type CatalogDeps, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// GÜNDE BİR PİLATES REZERVASYONU (owner, 2026-09-17).
//
//   pnpm exec tsx tools/migration/daily-reservation-limit-2026-09-17.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/daily-reservation-limit-2026-09-17.ts --apply
//
// Owner: *"pilatese bugün hem 19 hem de 20'ye rezervasyon yapan olmuş, günde 1 randevu yapılsın."*
// Bir üye aynı gün iki reformer dersi alabiliyordu; kontenjan 8 kişilik ve ikinci koltuk başka bir
// üyenin hakkıydı.
//
// KOD DEĞİŞMİYOR — kural zaten var. `dailyReservationLimit` Package Rules 2.0'dan beri rezervasyon
// kararında uygulanıyor (`reservations/domain/decide.ts`: `daily_reservation_limit_reached`).
// Eksik olan tek şey paketlerde alanın boş olmasıydı. Katalog DATA'dır (AD-41): kuralı koda değil,
// ürüne yazıyoruz.
//
// KAPSAM: reformer paketleri + pilates içeren hibritler (owner: *"reformer da hibritin pilatesinde
// de"*). Hibritte fitness tarafı REZERVASYON değil GİRİŞ (`entryAllowance`) olduğu için bu sınır
// fitnessa dokunmaz — ajandada fitness seansı yok, rezervasyon yalnızca pilates ve PT içindir.
//
// PT'ye ELLENMİYOR: PT 8 Ders'te zaten 1 yazılı, diğer PT paketleri owner'ın cümlesinin dışında.

const STUDIO = 'retro'
const RUN = 'daily-reservation-limit-2026-09-17'
const LIMIT = 1

// İsimle eşleşiyoruz, çünkü katalog owner'ın elinde: id listesi bir sonraki paket eklendiğinde
// sessizce eksik kalır, isim listesi ise burada görünür ve "BULUNAMADI" diye bağırır.
const HEDEFLER = [
  'Reformer Pilates - 4 Ders',
  'Reformer Pilates - 8 Ders',
  'Reformer Pilates - 16 Ders',
  'Reformer Pilates - 24 Ders',
  'Hibrit Aylık — 1 Fitness + 1 Pilates',
  'Hibrit Aylık — 2 Fitness + 1 Pilates',
  'Hibrit Aylık — 2 Pilates + 1 Fitness',
  'Hibrit 2 Aylık — 2Fitness + 1Pilates',
  'Hibrit 3 Aylık — 1Fitness + 2Pilates',
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const products = await deps.repo.listProducts(ctx)

  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  let degisecek = 0
  for (const ad of HEDEFLER) {
    const p = products.find((x) => x.name === ad)
    if (!p) {
      console.log(`${ad}: BULUNAMADI`)
      continue
    }
    const simdi = p.dailyReservationLimit
    if (simdi === LIMIT) {
      console.log(`${p.name}: zaten ${LIMIT} — atlandı`)
      continue
    }
    degisecek++
    console.log(`${p.name}: günlük sınır ${simdi ?? 'yok'} → ${LIMIT}`)
    if (!apply) continue

    // Ürünün geri kalanı OLDUĞU GİBİ geri yazılıyor: `updateProduct` tam bir ürün alır, ve bir
    // alanı unutmak onu sessizce null'a çeker (16 Eylül'de `aiQuotable` tam olarak böyle kaybolmuştu).
    const r = await updateProduct(deps, ctx, {
      productId: p.id,
      active: p.active,
      name: p.name,
      category: p.category,
      serviceIds: p.serviceIds,
      type: p.type,
      durationDays: p.durationDays,
      creditCount: p.creditCount,
      priceInKurus: p.priceInKurus,
      cashPriceInKurus: p.cashPriceInKurus,
      freezeAllowanceDays: p.freezeAllowanceDays,
      dailyReservationLimit: LIMIT,
      cancellationAllowanceCount: p.cancellationAllowanceCount,
      activeReservationLimit: p.activeReservationLimit,
      entryAllowance: p.entryAllowance,
      components: p.components,
      description: p.description,
      onlineSellable: p.onlineSellable,
      memberSellable: p.memberSellable,
      // `exactOptionalPropertyTypes`: isteğe bağlı bir alanı "undefined" olarak GÖNDERMEK ile hiç
      // göndermemek farklı şeyler. Ürün bayrağı taşımıyorsa anahtarı da yazmıyoruz — updateProduct
      // mevcut değeri koruyor (16 Eylül'deki `aiQuotable` kaybının tam tersi yönde aynı ders).
      ...(p.aiQuotable === undefined ? {} : { aiQuotable: p.aiQuotable }),
    })
    console.log(r.ok ? '  ✅ yazıldı' : `  HATA: ${r.error.code}`)
  }
  if (!apply) console.log(`\nkuru çalışma — ${degisecek} pakette değişiklik olacak, hiçbir şey yazılmadı`)

  // MEVCUT REZERVASYONLAR ETKİLENMEZ: kural yeni rezervasyon alınırken çalışır, geçmişe dönük
  // iptal etmez. Bugün iki derse yazılmış üye derslerine girer; yarın ikincisini alamaz.
  console.log('\nNot: bugün alınmış çift rezervasyonlar durur — kural bundan sonrasını bağlar.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
