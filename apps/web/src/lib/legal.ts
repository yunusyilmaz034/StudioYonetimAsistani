// SATICI KİMLİĞİ VE HUKUKİ METİN SÜRÜMLERİ — one source for every legal page and every consent record.
//
// WHY THIS FILE EXISTS AT ALL, given AD-41 (the catalogue is data). A price is data because it changes
// weekly and the owner must change it without a deploy. A company's registered identity is the
// opposite: it changes almost never, and when it does, every contract text changes with it — which is
// a deploy either way. Typing it into six pages is how a MERSİS number ends up correct on five of them.
//
// The VERSION strings are the load-bearing part. A consent record proves nothing unless it names the
// text that was consented to, and "the current text" is not a name — the text changes and the proof
// evaporates. So each document carries a version that MUST be bumped whenever its wording changes in
// a way that affects what the customer agreed to. A member who bought under v1 keeps v1 forever.
//
// ⚠️ Bumping a version is a legal act, not a refactor. Change the text and the version together, in
// one commit, and never edit a version's text after somebody has accepted it.

export const SELLER = {
  legalName: 'Retro Spor Hizmetleri Tic. Ltd. Şti.',
  brand: 'Pilates Fitness by Işıl',
  address: 'Akse Mahallesi, Karasu Caddesi No: 28/T, Çayırova / Kocaeli',
  phone: '0533 199 41 23',
  phoneE164: '+905331994123',
  email: 'info@pilatesfitnessbyisil.com',
  taxOffice: 'İlyasbey Vergi Dairesi',
  taxNumber: '7342634727',
  mersis: '0734263472700001',
  tradeRegistryNo: '39312',
  website: 'https://pilatesfitnessbyisil.com',
} as const

/** Documents a customer can accept. The key is what a consent record stores. */
export type LegalDocKey = 'kvkk' | 'privacy' | 'refund' | 'distance_sales' | 'preinfo' | 'health_consent' | 'marketing' | 'early_start'

export interface LegalDoc {
  readonly key: LegalDocKey
  readonly title: string
  /** Bump on every wording change that affects what the customer agreed to. */
  readonly version: string
  /** Public path, or null for a consent text that has no page of its own. */
  readonly path: string | null
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  kvkk: { key: 'kvkk', title: 'KVKK Aydınlatma Metni', version: '2026-08-18.1', path: '/kvkk' },
  privacy: { key: 'privacy', title: 'Gizlilik ve Güvenlik Politikası', version: '2026-08-18.1', path: '/gizlilik' },
  refund: { key: 'refund', title: 'İptal ve İade Koşulları', version: '2026-08-18.1', path: '/iptal-iade' },
  distance_sales: { key: 'distance_sales', title: 'Mesafeli Satış Sözleşmesi', version: '2026-08-18.1', path: '/mesafeli-satis' },
  preinfo: { key: 'preinfo', title: 'Ön Bilgilendirme Formu', version: '2026-08-18.1', path: '/on-bilgilendirme' },
  health_consent: { key: 'health_consent', title: 'Sağlık Verilerine İlişkin Açık Rıza Metni', version: '2026-08-18.1', path: '/acik-riza-saglik' },
  marketing: { key: 'marketing', title: 'Ticari Elektronik İleti Onayı', version: '2026-08-18.1', path: null },
  early_start: { key: 'early_start', title: 'Cayma Süresi Dolmadan Hizmete Başlama Onayı', version: '2026-08-18.1', path: null },
}

/** Human date shown at the top of every legal page. */
export const LEGAL_UPDATED = '18 Ağustos 2026'

// ── KURALLAR, TEK YERDE ──────────────────────────────────────────────────────────────────────
//
// These are the studio's operating rules AS THE CONTRACT STATES THEM, and the contract must state
// what the software actually does. Where the two ever disagree, the software is what the member
// experiences and the contract is what she can hold us to — so a change to either is a change to
// both. Each entry below names the code that enforces it, so the next person can check.
export const RULES = {
  // reservations/domain/decide.ts — the window is stamped onto the session at creation and read from
  // the snapshot, never re-resolved. The studio's configured value is 6 hours.
  cancellationWindowHours: 6,
  // Özel ders (PT): reception's standing practice. NOT enforced separately in code today — PT sessions
  // carry the same stamped window as any other session.
  privateCancellationWindowHours: 24,
  // entitlements/domain/decide.ts — a late cancel or a no-show consumes one credit.
  lateCancelConsumesCredit: true,
  // Cayma hakkı: 14 gün (Mesafeli Sözleşmeler Yönetmeliği m.9).
  withdrawalDays: 14,
  // Güvenlik kamerası — yalnızca giriş bölümünde, kayıtlar 15 gün saklanır (işletme beyanı).
  cameraRetentionDays: 15,
} as const
