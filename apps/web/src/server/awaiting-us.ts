import type { TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// ── BİZDEN DÖNÜŞ BEKLEYENLER (owner, 2026-09-29) ────────────────────────────────────────────
//
// *"Mesela bizden böyle bekleyenler de dashboard'da işlere ekle."*
//
// Owner'ın gösterdiği sohbet: üye *"bana uygulama için kod yollamadınız, o yüzden randevu
// alamadım"* yazmış, AI da *"hemen kontrol edip size dönelim"* demiş. Söz verildi — ve o söz
// HİÇBİR YERE düşmedi. Panoda satırı yok, çünkü:
//
//   · `hot_lead` listesi `stage` ya da `needsAttention` ister. Bu kişi ÜYE, satış hunisinde
//     değil; AI da devretmediği için işaret konmadı.
//   · Sohbet ekranında "bekleyen" filtresi `needsAttention`a bakar — o da yok.
//
// Yani sistem müşteriye stüdyo adına bir söz verdi ve o sözü takip edecek kimseyi uyarmadı.
// En kötü sessizlik türü bu: kimse hata almıyor, kimse haberdar değil, ve müşteri bekliyor.
//
// ── NEDEN YAZMA DEĞİL, OKUMA TARAFINDA ──────────────────────────────────────────────────────
//
// İlk düşündüğüm çözüm AI'a yeni bir işaret yazdırmaktı (`[[DONUS]]` gibi). Vazgeçtim: modelin
// işbirliğine bağlı olur, prompt zaten bu cümleler konusunda kendi içinde çelişiyor (bir yerde
// "ASLA 'kontrol edip döneriz' deme", başka bir yerde "'kontrol edip size döneceğiz' de"), ve
// yalnızca BUGÜNDEN SONRAKİ sohbetleri kapsardı.
//
// Bunun yerine karar okuma anında veriliyor: sohbetin son sözü BİZDEYSE ve o söz bir dönüş vaadi
// taşıyorsa, iş odur. Şema değişmiyor, fonksiyon dağıtımı gerekmiyor, ve kural geçmişe dönük
// çalışıyor — dün verilmiş sözler de bugün listeye düşüyor.

/** Sohbet belgesinin bu karar için gereken kadarı — Firestore'a bağlı olmasın diye ayrı. */
export interface BekleyenSohbet {
  readonly status?: string
  readonly needsAttention?: boolean
  readonly messages?: readonly { readonly role?: string; readonly text?: string; readonly at?: number }[]
}

/**
 * Türkçe katlama: `toLocaleLowerCase('tr')` İ→i ve I→ı yapar, ama regex'in `i` bayrağı bunu
 * bilmez. O yüzden önce katlıyoruz, sonra bayraksız eşliyoruz ([[turkish-case-fold-search-trap]]).
 */
const katla = (s: string): string => s.toLocaleLowerCase('tr')

/**
 * Stüdyonun kendi ağzından çıkan DÖNÜŞ SÖZÜ.
 *
 * Kalıplar uydurma değil: prompt'un kendisi bu cümleleri sayıyor — bir kısmını yasaklayarak
 * ("resepsiyonumuza iletelim", "dönüş yapacaklar", "not aldım"), bir kısmını emrederek
 * ("kontrol edip size döneceğiz", "kontrol edip dönelim"). İkisi de aynı şeyi bırakıyor geride:
 * tutulması gereken bir söz.
 *
 * Müşterinin cümlesine değil, YALNIZCA bizim mesajımıza bakılır — "ne zaman dönersiniz" diye
 * soran biri söz vermiş olmaz.
 */
export function donusSozu(text: string): boolean {
  const t = katla(text)
  // "dönem", "dönüyor" gibi kelimeler kasten dışarıda: yalnızca birinci çoğul/tekil gelecek ve
  // istek kipleri bir taahhüt taşır.
  return (
    /dön(üş|eceğ|elim|eriz|ecekler)/.test(t) ||
    /haber ver(eceğ|elim|iriz)/.test(t) ||
    /(bilgi|geri bildirim) ver(eceğ|elim|iriz)/.test(t) ||
    /ilet(elim|eceğ|iyorum)/.test(t) ||
    /not ald[iı]m/.test(t)
  )
}

/**
 * Bu sohbette bekleyen bir söz var mı — varsa hangisi ve ne zaman verildi.
 *
 * Üç eleme, üçü de bilerek:
 *   · `status === 'human'` → biri zaten devralmış; ikinci bir hatırlatma gürültüdür.
 *   · `needsAttention` → satır ZATEN panoda, "operatör bekliyor" olarak en üstte. Aynı işi iki
 *     kez listelemek, listenin güvenilirliğini düşürür.
 *   · son söz müşterideyse → bu başka bir iş (cevapsız soru), ve onun kendi işareti var.
 */
export function bekleyenSoz(c: BekleyenSohbet, now: number): { readonly text: string; readonly at: number } | null {
  if (c.status === 'human') return null
  if (c.needsAttention === true) return null
  const son = c.messages?.[c.messages.length - 1]
  if (!son || son.role !== 'assistant') return null
  const text = String(son.text ?? '').trim()
  const at = Number(son.at ?? 0)
  if (!text || at <= 0 || at > now) return null
  if (!donusSozu(text)) return null
  return { text, at }
}

/**
 * Söz verildikten sonraki ilk yarım saat listelenmez.
 *
 * O aralık dock'un işi: AI cevap verdiği anda sohbet zaten resepsiyonun ekranında akıyor. Panoya
 * hemen düşürmek, masanın halihazırda baktığı şeyi ikinci kez iş diye göstermek olurdu.
 */
const BEKLEME_DK = 30
const SAAT_MS = 3_600_000

/** Bir günü geçmiş söz ACİL: aynı gün tutulmayan söz, tutulmamış sayılır. */
const ACIL_SAAT = 24

export async function awaitingUsAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const snap = await adminDb().collection(`studios/${ctx.studioId}/conversations`).orderBy('lastAt', 'desc').limit(50).get()
  const now = Date.now()
  const rows: { item: AdvisorItem; bekleyen: number }[] = []

  for (const d of snap.docs) {
    const c = d.data() as Record<string, unknown>
    const soz = bekleyenSoz(c as BekleyenSohbet, now)
    if (!soz) continue

    const dakika = (now - soz.at) / 60_000
    if (dakika < BEKLEME_DK) continue

    const phone = String(c.phone ?? d.id)
    const name = String(c.name || phone.slice(-6))
    const saat = Math.floor((now - soz.at) / SAAT_MS)
    const sure = saat < 1 ? `${Math.floor(dakika)} dakikadır` : saat < 24 ? `${saat} saattir` : `${Math.floor(saat / 24)} gündür`

    rows.push({
      item: {
        id: `awaiting_us__${phone}`,
        kind: 'awaiting_us',
        severity: saat >= ACIL_SAAT ? 'urgent' : 'attention',
        subject: { id: phone, name },
        title: `${name} — bizden dönüş bekliyor · ${sure}`,
        // Verilen sözün KENDİSİ gösteriliyor, özeti değil: masanın ne sözü tutacağını bilmesi
        // gerekiyor, "bir şey söz verilmiş" bilgisi iş görmez.
        detail: `Yazdığımız: “${soz.text.slice(0, 160)}”`,
        href: `/conversations?phone=${encodeURIComponent(phone)}`,
        actionLabel: 'Sohbeti aç',
      },
      bekleyen: now - soz.at,
    })
  }

  // EN UZUN BEKLEYEN ÖNDE — lead sıralamasının TERSİ, ve bilerek. Lead bir fırsattır, tazesi
  // değerlidir; tutulmamış bir söz ise borçtur, eskisi daha çok zarar verir.
  return rows.sort((a, b) => b.bekleyen - a.bekleyen).map((r) => r.item)
}
