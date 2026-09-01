import type { TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// WHATSAPP LEAD'LERİ, PANODA (owner, 2026-09-01'de yeniden yazıldı).
//
// ── NE BOZUKTU ──────────────────────────────────────────────────────────────────────────────
//
// Liste sıcaklığa bakıyordu ve 184 sohbetin 82'si "sıcak"tı. Panoda 24 satır vardı ve 24'ü de
// "Sıcak lead" diyordu. Nüfusun yarısına uyan bir etiket hiçbir şeyi sıralamaz — Işıl 24 satıra bakıp
// hangisini önce arayacağını yine kendisi çıkarmak zorundaydı.
//
// ── NE DEĞİŞTİ ──────────────────────────────────────────────────────────────────────────────
//
// Artık AI'ın gördüğü AŞAMA kullanılıyor (randevu → fiyat → bilgi) ve sıralama ondan çıkıyor:
// bugün kapıya gelecek biri, fiyat sormuş birinden önce gelir. Etiket de ne yapılacağını söylüyor.
//
// ── SESSİZLİK, AYRI BİR ÖLÇÜ ───────────────────────────────────────────────────────────────
//
// Owner sordu: lead'lere belirli aralıklarla "hâlâ ilgileniyor musunuz" diye otomatik yazılsın mı?
// Ölçüldü: "sıcak" 82 sohbetin 61'i 7+ gündür, 55'i 14+ gündür sessiz.
//
// Otomatik GÖNDERİM yapılmadı, bilerek. Üç sebep: 24 saat penceresi dışında her mesaj Meta'ya
// konuşma başına ücret; istenmeyen takip mesajı engelleme/şikâyet getirir ve numaranın kalite puanını
// düşürür — ki o numara artık stüdyonun satış hattı; ve bunlar üye değil, kampanya izinleri yok.
//
// Onun yerine HATIRLATMA otomatikleştirildi (owner onayı): fiyat almış ve susmuş kişi panoda
// "X gündür sessiz" diye çıkar, tek tıkla sohbeti açılır, yazıp yazmamaya Işıl karar verir. Bedeli
// sıfır, riski sıfır, ve kararı veren yine insan.

/** Sessiz sayılmak için geçmesi gereken gün. Fiyat almış birinin cevabı bir günde gelmeyebilir. */
const SESSIZ_GUN = 3
const GUN_MS = 86_400_000

type Asama = 'randevu' | 'fiyat' | 'bilgi'

/** Eski sıcaklık kayıtları hâlâ okunuyor: aşama yazılmamış sohbetler bir gecede yok olmasın. */
const ESKI: Record<string, Asama> = { sıcak: 'fiyat', ılık: 'bilgi', soğuk: 'bilgi' }

const BASLIK: Record<Asama, string> = {
  randevu: 'Randevulu',
  fiyat: 'Fiyat verildi',
  bilgi: 'Bilgi alıyor',
}

/** Sıra: kapıya gelecek olan, fiyat sormuş olandan önce gelir. */
const ONCELIK: Record<Asama, number> = { randevu: 0, fiyat: 1, bilgi: 2 }

export async function hotLeadAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const snap = await adminDb().collection(`studios/${ctx.studioId}/conversations`).orderBy('lastAt', 'desc').limit(50).get()
  const now = Date.now()
  const rows: { item: AdvisorItem; sira: number }[] = []

  for (const d of snap.docs) {
    const c = d.data() as Record<string, unknown>
    const asama = ((c.stage as Asama | undefined) ?? ESKI[String(c.temp ?? '')] ?? null) as Asama | null
    const waiting = Boolean(c.needsAttention)
    if (!asama && !waiting) continue

    const phone = String(c.phone ?? d.id)
    const name = String(c.name || phone.slice(-6))
    const gun = Math.floor((now - Number(c.lastAt ?? now)) / GUN_MS)
    const sessiz = gun >= SESSIZ_GUN

    // "Bilgi alıyor" olan ve daha yeni yazmış biri panoya çıkmaz. Panonun işi her sohbeti listelemek
    // değil, BUGÜN dokunulması gerekenleri söylemek — her şeyi gösteren liste hiçbir şey söylemez.
    if (!waiting && asama === 'bilgi' && !sessiz) continue

    const baslik = waiting
      ? `${name} — operatör bekliyor (WhatsApp)`
      : `${BASLIK[asama!]}: ${name}${sessiz ? ` · ${gun} gündür sessiz` : ''}`

    // Sessizlik, aşamanın YERİNE değil YANINA yazılır: fiyat alıp susan biriyle hiç konuşmadan susan
    // biri aynı şey değildir, ve ilki çok daha değerlidir.
    const detay = waiting
      ? String(c.reason || 'Operatör bekliyor.')
      : sessiz
        ? `${String(c.reason || 'İlgileniyordu')} — ${gun} gündür yazmadı, bir dönüş yapın.`
        : String(c.reason || 'İlgili görünüyor — bir an önce dönün.')

    rows.push({
      item: {
        id: `wa:${phone}`,
        kind: 'hot_lead',
        // Kapıya gelecek olan ve operatör bekleyen ACİL. Gerisi normal — her şeyi acil yapan liste,
        // hiçbir şeyi acil yapmaz.
        severity: waiting || asama === 'randevu' ? 'urgent' : 'attention',
        subject: { id: phone, name },
        title: baslik,
        detail: detay,
        href: `/conversations?phone=${encodeURIComponent(phone)}`,
        actionLabel: 'Sohbeti aç',
      },
      // Operatör bekleyen en üstte; sonra aşama sırası; eşitlikte en uzun süredir susan önde,
      // çünkü kaybetmeye en yakın olan odur.
      sira: (waiting ? -1 : ONCELIK[asama!]) * 1000 - Math.min(gun, 999),
    })
  }

  return rows.sort((a, b) => a.sira - b.sira).map((r) => r.item)
}
