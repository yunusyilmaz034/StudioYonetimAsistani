import { adminDb } from './firebase-admin'

// ── BİR KERE ARANAN YARIN YENİDEN ARANMAZ (owner, 2026-09-03 · 2026-09-04) ──────────────────
//
// Tik, satırına göre iki ayrı şey demek. "9 boş seans" BUGÜNE aittir — yarınki boş seans başka bir
// seanstır, başka bir kimliktir, tikin sabah silinmesi doğrudur. "ESRA — 34 gündür gelmiyor · bir
// arayın" ise bugüne ait değil, YAPILMIŞ BİR TELEFON GÖRÜŞMESİNE aittir ve güneşin doğması onu geri
// almaz. Ertesi gün yeniden listelemek resepsiyona iş hatırlatmaz; LİSTENİN YALAN SÖYLEDİĞİNİ
// öğretir, ve yalan söyleyen liste okunmadan tiklenir.
//
// ── NEDEN AYRI BİR "SNOOZE" BELGESİ YOK (2026-09-04, ikinci şikayetten sonra) ────────────────
//
// İlk sürüm soğumayı TİK ANINDA ayrı bir belgeye yazıyordu. Çalışıyordu — ama yalnızca o an soğuması
// tanımlı olan türler için. `hot_lead` soğuması 4 Eylül 16:23'te dağıtıldı, o günün lead tikleri ise
// 16:09'da atılmıştı: 25 lead ertesi sabah listeye geri geldi ve owner ikinci kez aynı şeyi bildirdi.
//
// Sebep derindi: soğuma, "tik atıldığında ne biliyorduk"a bağlıydı. Oysa gerçek olan şey TİKİN
// KENDİSİ — o zaten kayıtlı. Artık soğuma tik geçmişinden TÜRETİLİYOR:
//
//   · Yeni bir tür soğuma listesine eklendiğinde GEÇMİŞE DÖNÜK çalışır; dağıtım anı önemsizdir.
//   · Sürüklenebilecek ikinci bir belge yok — tek doğruluk noktası günlük tik kaydı.
//   · Tiki kaldırmak soğumayı da kaldırır, çünkü kayıt siliniyor. Ayrıca bir iptal yolu gerekmiyor.
//
// Bedeli: en fazla `MAX_GUN` küçük belge okuması. Sabit ve sınırlı — stüdyo büyüdükçe artmıyor.

/**
 * Kind → tikin kaç gün listeden düşürdüğü. Listede OLMAYAN bir tür eski davranışı sürdürür: tik
 * stüdyonun günü boyunca durur, sabah temiz başlar.
 *
 * Ölçü: **tik, yapılmış bir İNSAN TEMASINI mı kaydediyor?** Telefon görüşmesi öyle. Boş seans
 * doldurmak değil — o ders üç saat sonra başlıyor ve geçiyor.
 */
export interface TickedItem {
  readonly id: string
  readonly kind: string
}

export const CHECKLIST_COOLDOWN_DAYS: Readonly<Record<string, number>> = {
  // Sebep bir tarih değil, bir DAVRANIŞ: yarın da 35 gündür gelmiyor olacak, ve bu yeni bir haber değil.
  dormant_member: 7,
  // Ödendiği an zaten listeden düşüyor; her sabah aynı kişiyi aramak tahsilat değil taciz.
  outstanding_balance: 7,
  // Yenileme bir satış konuşmasıdır; üst üste günlerde tekrarı satışı değil rahatsızlığı artırır.
  low_credit: 7,
  // owner, 2026-09-04: *"tiklendiyse bir daha çıkmasın."* Aranmış bir lead ertesi gün yeniden aranmaz.
  hot_lead: 7,
  // ÜÇ gün, yedi değil — arkada bir SON TARİH var. Paket dolmadan önceki son hatırlatma meşrudur;
  // bir haftalık soğuma onu yutardı, ve yanan hak geri gelmiyor.
  expiring_with_credits: 3,
  expiring_soon: 3,
}

const MAX_GUN = Math.max(...Object.values(CHECKLIST_COOLDOWN_DAYS))
const GUN_MS = 86_400_000
const studioDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })

/**
 * Tik kimliğinden türü oku. Kimlikler iki biçimde kuruluyor ve ikisi de kararlı:
 * `wa:{telefon}` (lead) · `{kind}__{...}` (içgörüler). Tanınmayan bir biçim soğumaz — bilinmeyen bir
 * türe soğuma uydurmak, listeden bir işi sebepsiz silmek olurdu.
 */
export function kindOfItemId(itemId: string): string | null {
  if (itemId.startsWith('wa:')) return 'hot_lead'
  const i = itemId.indexOf('__')
  return i > 0 ? itemId.slice(0, i) : null
}

/** SAF: bu tik, şu an listeyi susturuyor mu? Sınır burada, testi de burada. */
export function isSnoozedNow(itemId: string, tickedAt: number, now: number): boolean {
  const kind = kindOfItemId(itemId)
  const gun = kind ? CHECKLIST_COOLDOWN_DAYS[kind] : undefined
  if (gun === undefined) return false
  // TİKLENDİĞİ GÜN SATIR YERİNDE KALIR — üstü çizili. 5 Ağustos'ta konmuş kuralın aynısı
  // (*"gün sonunda görsün ne kadar iş kapatmış"*), ve tek geri dönüş yolu bu: satır aynı gün gözden
  // kaybolsaydı, yanlışlıkla atılan bir tik işi bir haftalığına kimsenin göremediği bir yere koyardı.
  if (studioDay(tickedAt) === studioDay(now)) return false
  return now - tickedAt < gun * GUN_MS
}

/**
 * Şu an listeden çıkarılacak iş kimlikleri — son `MAX_GUN` günün tik kayıtlarından TÜRETİLİR.
 * Bugünün kaydı bilerek okunmuyor: bugün tiklenen satır listede kalır.
 */
export async function loadSnoozedItemIds(studioId: string, now: number): Promise<ReadonlySet<string>> {
  try {
    const db = adminDb()
    const gunler: string[] = []
    for (let i = 1; i <= MAX_GUN; i++) gunler.push(studioDay(now - i * GUN_MS))
    const refs = gunler.map((g) => db.collection('studios').doc(studioId).collection('checklistDone').doc(g))
    const snaps = await db.getAll(...refs)

    const out = new Set<string>()
    for (const snap of snaps) {
      const items = (snap.data()?.items ?? {}) as Record<string, { at?: number } | undefined>
      for (const [itemId, v] of Object.entries(items)) {
        const at = Number(v?.at ?? 0)
        if (at > 0 && isSnoozedNow(itemId, at, now)) out.add(itemId)
      }
    }
    return out
  } catch {
    // Bir satır fazla göstermek sıkıcıdır; panonun hiç açılmaması arıza. Okuma başarısızsa masa
    // işi yeniden görür.
    return new Set()
  }
}
