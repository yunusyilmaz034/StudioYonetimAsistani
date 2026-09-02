import {
  FirestoreFinanceRepository,
  cancelSale,
  collect,
  instant,
  money,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ESKİ FİYATLA SATILMIŞ İKİ HİBRİT PAKET — break-glass, elle, bir kez (owner onayı, 2026-09-02).
//
//   pnpm tsx tools/migration/fix-hibrit-eski-fiyat-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-hibrit-eski-fiyat-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// "Hibrit Aylık — 2 Fitness + 1 Pilates" ürününün güncel fiyatı **nakit 5.000 / kart 5.500**.
// İki üyeye eski fiyat (6.000 ₺) yazılmış; owner ikisinin de yeni fiyattan satıldığını ve borcu
// olmadığını doğruladı.
//
//   SELMA BOZKURT YILDIRIM · satış 6.000, nakit 5.000 ödenmiş → kayıtta 1.000 ₺ BORÇ görünüyor
//   EBRU KILIÇ             · satış satırı 6.000 + **1.000 ₺ "hediye" indirimi** → toplam 5.000
//
// ── EBRU'DAKİ ASIL SORUN, BORÇ DEĞİL ───────────────────────────────────────────────────────
//
// Ebru'nun bakiyesi zaten sıfır. Bozuk olan şey kaydın ŞEKLİ: eski fiyatı 5.000'e indirmek için
// 1.000 ₺'lik bir "hediye" indirimi yazılmış. Böyle bir hediye verilmedi — verilen tek şey güncel
// fiyattı. O satır raporlarda duruyor ve indirim raporunun tek varlık sebebi şu soruya cevap
// vermek: *"bu tavizi vermeye devam edelim mi?"* ([[OR-32]]). Hiç verilmemiş bir tavizi oraya
// yazmak, o sorunun cevabını bozar.
//
// ── NEDEN İPTAL + YENİDEN SATIŞ ────────────────────────────────────────────────────────────
//
// Satış SATIRININ fiyatı yerinde düzeltilemiyor; `sell` bir satışı yeniden yazmıyor, yenisini
// kuruyor. O yüzden Esra (31.08) ve Sakine (02.09) desenin aynısı: ödemeler sebebiyle iptal,
// satış sebebiyle iptal, doğrusu kurulur, ödemeler AYNI tarih ve yöntemle geri yazılır. Silme yok,
// düzeltme var (#9).
//
// Kasa nettir: iptal edilen ödemeler kasadan düşer, yeniden yazılanlar geri ekler.
//
// ── ABONELİKLERE DOKUNULMUYOR ──────────────────────────────────────────────────────────────
//
// Paketler doğru: ürün, tarih, kredi. Yanlış olan tek şey para. Yeni satışların satırları AYNI
// abonelik kimliklerini gösteriyor.

const STUDIO = 'retro'
const BRANCH = 'mutlukent' as BranchId
const RUN = 'fix-hibrit-eski-fiyat-2026-09'
const PRODUCT = 'prd_01KY7ZK0QKZVZYWZVNSVCPV5CZ' as ProductId
const URUN_ADI = 'Hibrit Aylık — 2 Fitness + 1 Pilates'
const DRAWER = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const DOGRU_KURUS = 500_000 // güncel NAKİT fiyat
const YANLIS_KURUS = 600_000

const REASON =
  'Eski fiyatla kaydedilmişti (6.000 ₺); güncel nakit fiyat 5.000 ₺ ve nakit tahsil edilmişti. Owner onayı, 02.09.2026.'

interface Vaka {
  readonly ad: string
  readonly memberId: MemberId
  readonly saleId: string
  readonly entitlementId: EntitlementId
  /** Sırayla: ilk ödeme satışla birlikte, kalanlar `collect` ile — hepsi ÖZGÜN tarihiyle. */
  readonly odemeler: readonly { readonly id: string; readonly kurus: number; readonly at: string }[]
}

const VAKALAR: readonly Vaka[] = [
  {
    ad: 'SELMA BOZKURT YILDIRIM',
    memberId: 'mem_01M1ERBWAK8ARVV2W4RE93SAFC' as MemberId,
    saleId: 'sal_01M1ERT6JAG17JV317WANEMD5A',
    entitlementId: 'ent_01M1ERT6K2EH7810TAKVQ2HW8F' as EntitlementId,
    odemeler: [{ id: 'pay_01M1ERT6JAG17JV317WANEMD5A', kurus: 500_000, at: '2026-09-01T15:18:43.530Z' }],
  },
  {
    ad: 'EBRU KILIÇ',
    memberId: 'mem_01M1ERTSA9N0140TY6K30MTQF0' as MemberId,
    saleId: 'sal_01M1ERX2BMR10DFNH8Q8HDZJ2F',
    entitlementId: 'ent_01M1ERX2CCPZVF468BRZY55ZFF' as EntitlementId,
    odemeler: [
      { id: 'pay_01M1ERX2BMR10DFNH8Q8HDZJ2F', kurus: 100_000, at: '2026-09-01T15:20:17.524Z' },
      { id: 'pay_01M1HHRSBSYZAQVV5T8XNCQ0Y9', kurus: 400_000, at: '2026-09-02T17:13:20.505Z' },
    ],
  },
]

const tl = (k: number) => (k / 100).toLocaleString('tr-TR') + ' ₺'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const v of VAKALAR) {
    console.log(`━━ ${v.ad}`)
    const saleDoc = await db.doc(`studios/${STUDIO}/sales/${v.saleId}`).get()
    const sale = saleDoc.data() as
      | { total?: { amount?: number }; status?: string; lines?: { unitPrice?: { amount?: number } }[]; discounts?: unknown[] }
      | undefined
    const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}_${v.memberId}`).get()

    const satirFiyat = sale?.lines?.[0]?.unitPrice?.amount ?? 0
    console.log(`   satış      : ${v.saleId} · durum ${sale?.status ?? 'YOK'}`)
    console.log(`   satır fiyat: ${tl(satirFiyat)}  → olacak ${tl(DOGRU_KURUS)}`)
    console.log(`   indirim    : ${(sale?.discounts ?? []).length} adet → olacak 0`)
    console.log(`   ödemeler   : ${v.odemeler.map((o) => tl(o.kurus)).join(' + ')} (nakit, tarihleri korunuyor)`)
    console.log(`   yeni satış : ${yeni.exists ? 'ZATEN VAR — atlanacak' : 'kurulacak'}`)

    if (!saleDoc.exists) {
      console.log('   DUR: satış bulunamadı.\n')
      continue
    }
    if (satirFiyat !== YANLIS_KURUS) {
      console.log('   DUR: satır fiyatı beklenenden farklı — zaten düzeltilmiş olabilir.\n')
      continue
    }
    if (!apply) {
      console.log('')
      continue
    }

    for (const o of v.odemeler) {
      const r = await voidPayment(fin, ctx, { paymentId: o.id, reason: REASON })
      if (!r.ok) {
        console.error('   ÖDEME İPTALİ BAŞARISIZ:', o.id, r.error)
        return
      }
    }
    console.log('   ✓ ödemeler iptal edildi')

    const cancelled = await cancelSale(fin, ctx, { saleId: v.saleId, reason: REASON })
    if (!cancelled.ok) {
      console.error('   SATIŞ İPTALİ BAŞARISIZ:', cancelled.error)
      return
    }
    console.log('   ✓ yanlış satış iptal edildi')

    const ilk = v.odemeler[0]!
    const sold = await sell(fin, ctx, {
      saleId: `sal_${RUN}_${v.memberId}`,
      memberId: v.memberId,
      branchId: BRANCH,
      lines: [
        {
          productId: PRODUCT,
          description: URUN_ADI,
          quantity: 1,
          unitPrice: money(DOGRU_KURUS),
          entitlementId: v.entitlementId,
          giftCardId: null,
        },
      ],
      discounts: [], // hiç verilmemiş bir hediye artık yazılmıyor
      discountCeilingPercent: null,
      payment: {
        paymentId: `pay_${RUN}_1_${v.memberId}`,
        allocationId: `alc_${RUN}_1_${v.memberId}`,
        amount: money(ilk.kurus),
        method: 'cash',
        receivedAt: instant(Date.parse(ilk.at)),
        drawerId: DRAWER,
        giftCardCode: null,
        note: REASON,
      },
    })
    if (!sold.ok) {
      console.error('   SATIŞ BAŞARISIZ:', sold.error)
      return
    }
    console.log(`   ✓ doğru satış kuruldu + ${tl(ilk.kurus)} tahsilat`)

    for (const [i, o] of v.odemeler.slice(1).entries()) {
      const c = await collect(fin, ctx, {
        paymentId: `pay_${RUN}_${i + 2}_${v.memberId}`,
        memberId: v.memberId,
        branchId: BRANCH,
        amount: money(o.kurus),
        method: 'cash',
        receivedAt: instant(Date.parse(o.at)),
        drawerId: DRAWER,
        giftCardCode: null,
        note: REASON,
      })
      if (!c.ok) {
        console.error('   TAHSİLAT BAŞARISIZ:', c.error)
        return
      }
      console.log(`   ✓ ${tl(o.kurus)} tahsilat geri yazıldı (${new Date(o.at).toLocaleDateString('tr-TR')})`)
    }
    console.log('')
  }

  if (!apply) console.log('(uygulamak için --apply)')
  else console.log('✓ Bitti. İki üyenin de borcu yok, uydurma indirim kalmadı, kasa net değişmedi.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
