import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  cancelEntitlement,
  cancelSale,
  systemClock,
  voidPayment,
  type EntitlementId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ELİF ATALAY ÖZTÜRK — ELLE GİRİLMİŞ HAYALET "FİZİKSEL POS" KAYDI (owner teyidi, 2026-09-04).
//
//   pnpm tsx tools/migration/fix-elif-hayalet-pos-2026-09.ts
//   pnpm tsx tools/migration/fix-elif-hayalet-pos-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
//   18:43:57  resepsiyon elle kaydetti → satış 12.750 · ödeme 14.000 `credit_card` · provider ref YOK
//   18:49:33  PAYTR online ödemesi     → 14.000 · `paid` · ref b8d427… · DOĞRULANMIŞ
//
// Aynı telefon (+905380895488), aynı ürün, aynı tutar, altı dakika arayla. Owner POS cihazını
// kontrol etti: **fiziksel çekim YOK, para online geldi.** Yani 18:43'teki kayıt bir insanın
// beyanıydı ve karşılığında hiçbir para hareketi yok.
//
// Üç şey de aynı yöne işaret ediyordu ve teyit onları doğruladı: online alım self-servis sayfadan
// gelmiş (kaydında KVKK ve mesafeli satış onayları, üyenin kendi telefonundan), ve kasada ödemiş
// biri altı dakika sonra aynı paketi internetten satın almaz.
//
// ── NE YAPILIYOR, VE NEDEN BU SIRA ──────────────────────────────────────────────────────────
//
//  1. Hayalet ödeme SEBEBİYLE İPTAL (silinmez — #9). Kasa etkilenmiyor: zaten kasasız kayıtlıydı,
//     çünkü bu stüdyoda POS kasası hiç tanımlı değil (12 kart ödemesinin 12'si kasasız).
//  2. Elle kurulan satış sebebiyle iptal.
//  3. Elle verilen abonelik iptal — çünkü doğrusunu ONLINE AKIŞ kuracak.
//
// Sonra owner panodan **"Elif Atalay Öztürk üyesine ata"** düğmesine basar: online ödeme mevcut
// üyeye bağlanır, paket doğru tarih ve doğru tutarla (14.000, kart fiyatı) kurulur, ve tahsilat
// PAYTR referansıyla deftere girer.
//
// SON ADIMI SCRIPT YAPMIYOR, BİLEREK. Ürünün kendi yolu var; oradan yapılınca kayıt bir insanın
// adına düşer ve "bu paketi kim tanımladı" sorusu cevaplı kalır (#5). Script'in işi, o yolun önünü
// açmak — hayaleti kaldırmak.
//
// NOT: o düğmenin ÇIKMASI bugün düzeltilen telefon eşleştirme hatasına bağlı (`+905…` ile aranıyordu,
// anahtar `905…`). Düzeltme dağıtılmadan düğme görünmez.

const STUDIO = 'retro'
const RUN = 'fix-elif-hayalet-pos-2026-09'
const APPLY = process.argv.includes('--apply')

const MEMBER = 'mem_01M1PHDNF7PV61M3F0CE9QE692'
const PAYMENT = 'pay_01M1PHEJGKHHRN2T73CC0V5H5K'
const SALE = 'sal_01M1PHEJGKHHRN2T73CC0V5H5K'
const REASON =
  'Fiziksel POS çekimi yapılmamış; para 18:49’da online (PAYTR) geldi. Elle girilen kayıt hayaletti (owner teyidi, 2026-09-04).'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
  const ent = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  const p = await db.doc(`studios/${STUDIO}/payments/${PAYMENT}`).get()
  const s = await db.doc(`studios/${STUDIO}/sales/${SALE}`).get()
  const ents = await db.collection(`studios/${STUDIO}/entitlements`).where('memberId', '==', MEMBER).get()
  const canli = ents.docs.filter((d) => d.get('status') !== 'cancelled')

  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  console.log(`  ödeme  : ${p.exists ? `${tl(p.get('amount.amount') ?? 0)} · ${p.get('method')} · iptal ${p.get('voided')}` : 'YOK'}`)
  console.log(`  satış  : ${s.exists ? `${tl(s.get('total.amount') ?? 0)} · ${s.get('status')}` : 'YOK'}`)
  console.log(`  abonelik: ${canli.map((d) => `${d.get('productSnapshot.name')} (${d.get('status')})`).join(', ') || 'YOK'}`)

  // DUR KOŞULLARI: gördüğüm tablo değişmişse hiçbir şey yapma. Para kaydında "herhalde aynıdır"
  // diye devam etmek, ikinci bir hatanın en kısa yolu.
  if (!p.exists || p.get('voided') === true) { console.log('\nDUR: ödeme yok ya da zaten iptal.'); return }
  if (!s.exists || s.get('status') === 'cancelled') { console.log('\nDUR: satış yok ya da zaten iptal.'); return }
  if (canli.length !== 1) { console.log(`\nDUR: beklenen 1 canlı abonelik, bulunan ${canli.length}.`); return }
  if (!APPLY) { console.log('\n(uygulamak için --apply)'); return }

  const v = await voidPayment(fin, ctx, { paymentId: PAYMENT, reason: REASON })
  if (!v.ok) { console.error('ÖDEME İPTALİ BAŞARISIZ:', v.error); return }
  console.log('  ✓ hayalet ödeme iptal edildi')

  const c = await cancelSale(fin, ctx, { saleId: SALE, reason: REASON })
  if (!c.ok) { console.error('SATIŞ İPTALİ BAŞARISIZ:', c.error); return }
  console.log('  ✓ elle kurulan satış iptal edildi')

  const e = await cancelEntitlement(ent, ctx, {
    entitlementId: canli[0]!.id as EntitlementId,
    reason: REASON,
    refundPaymentId: null,
  })
  if (!e.ok) { console.error('ABONELİK İPTALİ BAŞARISIZ:', e.error); return }
  console.log('  ✓ elle verilen abonelik iptal edildi')

  console.log('\nSIRADAKİ ADIM SENDE: Genel Görünüm → "Online satış — üyelik bekliyor" →')
  console.log('  **Elif Atalay Öztürk üyesine ata**. Paket ve tahsilat oradan, PAYTR referansıyla kurulur.')
}

void main()
