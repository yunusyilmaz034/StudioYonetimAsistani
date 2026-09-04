import { FirestoreFinanceRepository, FirestoreMemberRepository, systemClock, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'

// ── KASA HAREKETLERİ (owner, 2026-09-04) ────────────────────────────────────────────────────
//
// *"Detaylı kasa hareketi olmalı; nakit ne kadar, KK ne kadar diye ödeme tiplerine göre filtrelesin,
// günlük/haftalık/aylık/yıllık gruplasın, tıklayınca o gün kimden ne geldi gitti görelim."*
//
// GİRİŞ ve ÇIKIŞ aynı listede, çünkü sorunun kendisi öyle. Çıkış tarafı bu milestone'da açıldı
// (`cash.withdrawn`); ondan önce kasadan para çıktığını YAZACAK YER YOKTU ve sonucu ölçülebilirdi:
// Merkez Kasa 17 Temmuz'dan 4 Eylül'e açık kaldı, beklenen bakiye 774.061 ₺'ye çıktı.
//
// İPTALLER LİSTEDE KALIR, TOPLAMA GİRMEZ. Bir ödeme düzeltilmez, iptal edilir (I-31); hatayı gizleyen
// bir liste kasayla karşılaştırılamaz.

export type MovementDirection = 'in' | 'out'
export interface CashMovement {
  readonly id: string
  readonly direction: MovementDirection
  readonly at: number
  readonly amountKurus: number
  /** Giriş için ödeme yöntemi, çıkış için kategori — ekranın tek filtre alanı. */
  readonly kind: string
  readonly label: string
  /** Giriş için üye adı, çıkış için sebep. "Kimden ne geldi, nereye ne gitti". */
  readonly who: string
  readonly voided: boolean
}

const METHOD_TR: Record<string, string> = {
  cash: 'Nakit',
  credit_card: 'Kredi kartı',
  pos: 'POS',
  bank_transfer: 'Havale/EFT',
  online: 'Online (sanal POS)',
  wallet: 'Cüzdan',
  gift_card: 'Hediye kartı',
}
const CATEGORY_TR: Record<string, string> = {
  trainer_pay: 'Eğitmen ödemesi',
  bank_deposit: 'Bankaya yatırma',
  expense: 'Gider',
  owner_draw: 'Sahip çekimi',
}

/**
 * Bir PENCEREDEKİ para hareketleri. Okuma tarihle sınırlı (`listPaymentsBetween`), stüdyonun tamamı
 * değil: bugün 183 ödeme var ve hepsini okumak ucuz görünüyor, ama üç yıl sonra aynı ekran her
 * açılışta binlerce belge okurdu — ve o günü fark eden kimse olmazdı, ekran yalnızca yavaşlardı.
 *
 * GRUPLAMA (gün/hafta/ay/yıl) pencerenin İÇİNDE, ekranda yapılıyor: owner gruplamayı anlık
 * değiştiriyor ve her değişimde sunucuya gitmek, her tıkta beklemek demek.
 */
export async function loadCashMovements(ctx: TenantContext, fromMs: number, toMs: number): Promise<readonly CashMovement[]> {
  const db = adminDb()
  const repo = new FirestoreFinanceRepository(db)
  const [payments, tumCikislar, members] = await Promise.all([
    repo.listPaymentsBetween(ctx, fromMs, toMs),
    repo.listCashOutflows(ctx),
    new FirestoreMemberRepository(db).list(ctx),
  ])
  // Çıkışlar aynı pencereye kırpılıyor: sayıları az olduğu için tarih sorgusu yerine okuyup süzmek
  // yeterli, ama EKRANDA pencereden taşan bir satır görünmemeli — toplamlar tutmazdı.
  const outflows = tumCikislar.filter((o) => Number(o.occurredAt) >= fromMs && Number(o.occurredAt) <= toMs)
  const name = new Map(members.map((m) => [m.id as string, m.fullName]))

  const gelen: CashMovement[] = payments.map((p) => ({
    id: p.id,
    direction: 'in' as const,
    at: Number(p.receivedAt),
    amountKurus: p.amount.amount,
    kind: p.method,
    label: METHOD_TR[p.method] ?? p.method,
    who: name.get(p.memberId as string) ?? '(silinmiş üye)',
    voided: p.voided === true,
  }))

  const giden: CashMovement[] = outflows.map((o) => ({
    id: o.id,
    direction: 'out' as const,
    at: Number(o.occurredAt),
    amountKurus: o.amount.amount,
    kind: o.category,
    label: CATEGORY_TR[o.category] ?? o.category,
    who: o.reason,
    voided: o.voided === true,
  }))

  void systemClock
  return [...gelen, ...giden].sort((a, b) => b.at - a.at)
}
