import { adminDb } from './firebase-admin'

// ── TAKİP NOTU — OKUMA (owner, 2026-09-18) ──────────────────────────────────────────────────
//
// *"Tıklayınca not olsun — ödeme yapacak şu gün falan diye, ya da iptal edecek."*
//
// Bu dosya neden var: notu HEM iş listesi (`advisor-query`) HEM de tiki yazan action
// (`actions/checklist`) okuyor. İkisini birbirine bağlarsak `advisor-query → actions/checklist →
// advisor-query` döngüsü oluşuyor ve dependency-cruiser haklı olarak reddediyor. Okuma burada,
// tarafsız bir yerde durur; iki taraf da buraya bakar, birbirine bakmaz.
//
// Tik notundan farkı KALICI olmasıdır. Tik kaydı atılabilir sayılır (günlük belge, sabah temiz
// başlar); "22 Eylül'de ödeyecek" ise yarın lazım olan bilgidir, bu yüzden ÜYEYE bağlı kendi
// belgesinde yaşar ve borç kapanana kadar satırın altında görünür.

export type FollowUpKind = 'odeyecek' | 'iptal' | 'ulasilamadi'

export interface FollowUpEntry {
  readonly memberId: string
  readonly kind: FollowUpKind
  readonly note: string
  /** Sözlenen gün + 1: satır o sabah geri gelir, yani söz tutuldu mu ertesi gün sorulur. */
  readonly dueAt: number | null
  readonly byName: string
  readonly at: number
}

export const followUpDoc = (studioId: string, memberId: string) =>
  adminDb().collection('studios').doc(studioId).collection('followUps').doc(memberId)

/** Stüdyonun takip notları. Yalnızca not bırakılmış üyeler için belge var — küçük ve sınırlı bir okuma. */
export async function listFollowUps(studioId: string): Promise<readonly FollowUpEntry[]> {
  const snap = await adminDb().collection('studios').doc(studioId).collection('followUps').get()
  return snap.docs.map((d) => {
    const v = d.data() as { kind?: string; note?: string; dueAt?: number; byName?: string; at?: number }
    return {
      memberId: d.id,
      kind: (v.kind ?? 'odeyecek') as FollowUpKind,
      note: v.note ?? '',
      dueAt: typeof v.dueAt === 'number' ? v.dueAt : null,
      byName: v.byName ?? '—',
      at: Number(v.at ?? 0),
    }
  })
}
