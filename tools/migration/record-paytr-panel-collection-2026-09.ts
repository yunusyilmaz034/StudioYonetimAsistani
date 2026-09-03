import {
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  instant,
  money,
  receiveCollection,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// PAYTR PANELİNDEN OLUŞTURULMUŞ BİR LİNKİN TAHSİLATINI DEFTERE AL — break-glass, elle, bir kez.
//
//   pnpm tsx tools/migration/record-paytr-panel-collection-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/record-paytr-panel-collection-2026-09.ts --apply
//
// ── NE OLDU (2026-09-03) ────────────────────────────────────────────────────────────────────
//
// Owner iki ödeme linkini **PAYTR'ın kendi panelinden** oluşturup gönderdi. 20:00:44'te 9.500 ₺'lik
// biri tamamlandı. Panelde hiçbir yere düşmedi, ve düşmemesi doğruydu:
//
//   PAYTR bildirimi geldiğinde `handlePaytrCallback`, `merchant_oid`e karşılık gelen bizim
//   `PaymentIntent` kaydımızı arar. Intent yalnızca ödemeyi BİZ başlatınca oluşur. Panelden
//   oluşturulan bir linkte bizde intent yoktur, ve referans biçimi bunu tek bakışta söylüyor:
//
//     bizim ürettiğimiz : 4a33bb2aec474fee82202cf49c487860   (32 hane hex)
//     bu ödeme          : S1788454546036736112547192168      (PAYTR'ın kendi panel referansı)
//
//   Ölçüldü: o gün tek bir callback log'u yok · `paytrCollections` 3 kayıt, bugün 0 ·
//   `paymentIntents` 105 kayıt, bugün 0. Yani bildirim hiç gelmedi; yutulmuş bir hata değil.
//
// ── NEDEN ELLE KAYIT, NEDEN "İNDİRİM" DEĞİL DE TAHSİLAT ─────────────────────────────────────
//
// Para gerçekten girdi. Girmiş bir parayı deftere yazmamak, onu yok saymak olur — ve gizlenen bir
// tahsilat, gizlenen bir alacak kadar bozuk. Kayıt PAYTR'ın KENDİ referansıyla yazılıyor: stüdyonun
// kasası ile PAYTR bakiyesi bir gün karşılaştırıldığında iki satırın aynı işlem olduğu görülebilsin.
//
// `status: 'unreconciled'` — yani "para geldi, kime ait olduğu HENÜZ bağlanmadı". Üyeyle eşleştirmek
// ve paketi eklemek panelden yapılır (`/finance/collections`), ve o adımı bir İNSAN yapar: bu
// script'in bildiği şey paranın girdiği, kime ait olduğu değil.
//
// ── AKTÖR ───────────────────────────────────────────────────────────────────────────────────
//
// `system` / `paytr_panel_backfill`. Bu kaydı bir insan yapmadı; onun kimliğini ödünç almak
// (#5) defterin en çok işe yaradığı yeri — "bunu kim yazdı" — bozardı.

const PROJECT = 'studio-yonetim-prod'
const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')

// ── PAYTR'IN KENDİ KAYDINDAN OKUNAN DEĞERLER. TAHMİN YOK. ───────────────────────────────────
//
// İkisi de İşlem Detayı ekranından okundu (2026-09-03 20:07).
//
// KART SAHİBİ ≠ ÜYE, ve bu bir hata değil — kartı bir yakını çekmiş. `buyerName` PAYTR'ın GÖRDÜĞÜ
// addır ve öyle kalır: gözlemi yorumla değiştirmek, defteri bozar. Kimin üyeliği olduğu owner'ın
// bilgisi ve o bilgi EŞLEŞTİRME adımında, bir insanın eliyle kaydedilir:
//
//     Ayşe Özdefe   (kart)  →  İDİL ÖZDEDE  (üye)   · owner, 2026-09-03
//     Makbule Yilmaz (kart) →  İREM YILMAZ  (üye)   · owner, 2026-09-03
//
// Ödeme şekli ikisinde de "P.F. 2 Taksit (%7.06)" — peşin fiyatına taksit. Müşteri tam 9.500 ₺
// ödedi; %7,06'lık taksit komisyonunu stüdyo üstlendi. Deftere giren tutar MÜŞTERİNİN ÖDEDİĞİdir
// (9.500); komisyon bir maliyettir, tahsilatın kendisi değil.
const TX = [
  {
    providerRef: 'S1788454546036736112547192168',
    amountKurus: 950_000,
    paidAtIso: '2026-09-03T20:00:44+03:00',
    installments: 2,
    buyerName: 'Ayşe Özdefe',
    buyerPhone: '05336314564',
    uye: 'İDİL ÖZDEDE',
  },
  {
    providerRef: 'S1788454755735547869188579974',
    amountKurus: 950_000,
    paidAtIso: '2026-09-03T20:03:45+03:00',
    installments: 2,
    buyerName: 'Makbule Yilmaz',
    buyerPhone: '05373197462',
    uye: 'İREM YILMAZ',
  },
] as const

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db = getFirestore()
  const ctx: TenantContext = {
    studioId: STUDIO as never,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'paytr_panel_backfill' } as TenantContext['actor'],
  }

  // AYNI TAHSİLATI İKİ KEZ YAZMA. Script bir kez çalışır, ama "acaba çalıştı mı" diye ikinci kez
  // çalıştırılması en olası hatadır — ve para kaydında o hata iki katı gelir gösterir.
  const existing = await db.collection(`studios/${STUDIO}/paytrCollections`).get()
  const kayitli = new Set(existing.docs.map((d) => d.get('providerRef') as string))

  console.log(`\n${APPLY ? 'YAZILIYOR' : 'KURU ÇALIŞMA'} — ${TX.length} tahsilat\n`)
  for (const t of TX) {
    if (kayitli.has(t.providerRef)) {
      console.log(`  ATLANDI (zaten kayıtlı) · ${t.buyerName} · ${t.providerRef}`)
      continue
    }
    console.log(`  ${t.amountKurus / 100} ₺ · ${t.installments} taksit · ${t.buyerName} (${t.buyerPhone}) → ${t.uye}`)
    console.log(`     referans ${t.providerRef} · ${t.paidAtIso}`)
    if (!APPLY) continue

    const paidAt = instant(Date.parse(t.paidAtIso))
    const { collectionId } = await receiveCollection(
      {
        linkRepo: new FirestorePaymentLinkRepository(db),
        collectionRepo: new FirestorePaytrCollectionRepository(db),
        // Saat SABİT: para 20:00'de girdi, script'in çalıştığı anda değil. `occurredAt` alan zamanıdır.
        clock: { now: () => paidAt },
      },
      ctx,
      {
        // Bizim ürettiğimiz bir link YOK — ödeme PAYTR panelinden çıktı. Boş bırakmak, olmayan bir
        // linke ait göstermekten dürüsttür.
        linkId: '',
        amount: money(t.amountKurus),
        installments: t.installments,
        buyerName: t.buyerName,
        buyerPhone: t.buyerPhone,
        providerRef: t.providerRef,
      },
    )
    console.log(`     ✓ ${collectionId}`)
  }

  if (!APPLY) {
    console.log('\nYazmak için --apply ekleyin.')
    return
  }
  console.log('\nPanel → Finans → Tahsilatlar: ikisi de "eşleşmemiş" olarak görünür.')
  console.log('Üyeyle eşleştirmeyi ve paketi eklemeyi ORADAN, bir insan yapar.')
  console.log('Kart sahibi adları üyelerden FARKLI: Ayşe Özdefe → İdil Özdede · Makbule Yilmaz → İrem Yılmaz')
}

void main()
