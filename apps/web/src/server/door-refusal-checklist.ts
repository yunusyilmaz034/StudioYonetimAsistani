import type { TenantContext } from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// KAPIDA KALAN ÜYE, PANODA (owner, 2026-09-08).
//
// Paketi bitmiş üye turnikede okuttu, kol dönmedi, ekran onu resepsiyona yönlendirdi — ve orada
// bitiyordu. Telefonu uyarıyordu, resepsiyon görmüyordu, owner hiç görmüyordu. Ertesi gün kimse
// aramıyordu çünkü kimsenin haberi yoktu.
//
// Halbuki kapıda kalan üye stüdyodaki EN SICAK adaydır: paketi bitmiş ama çalışmaya gelmiş, üstünü
// değişmiş, yola çıkmış. WhatsApp'tan fiyat sormuş birinden çok daha ileride.
//
// ── NEDEN AYRI BİR SORGU ───────────────────────────────────────────────────────────────────
//
// Owner panosunun okuma bütçesi sabit ve bu oraya girmiyor: ret bir olaydır, günlük okuma
// modelinden türemez. `hotLeadAdvisorItems` ile aynı desen — kendi sınırlı sorgusu, panoda aynı
// listeye karışıyor.
//
// İndeks YENİ DEĞİL: `(type ASC, recordedAt DESC)` zaten var. Yeni bir indeks, prod'da "requires an
// index" hatası riski demekti (emülatör indeks uygulamaz, hata ancak canlıda görünür).

/** Kaç gün geriye bakılır. Üç günden eski bir ret artık "bugün ilgilen" değil. */
const PENCERE_GUN = 3
const GUN_MS = 86_400_000

export async function doorRefusalAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const now = Date.now()
  const snap = await adminDb()
    .collection('studios')
    .doc(ctx.studioId)
    .collection('events')
    .where('type', '==', 'member.entry_refused')
    .where('recordedAt', '>=', Timestamp.fromMillis(now - PENCERE_GUN * GUN_MS))
    .orderBy('recordedAt', 'desc')
    .limit(40)
    .get()
  if (snap.empty) return []

  // ÜYE BAŞINA TEK SATIR, EN SONU. Aynı üye üç kez okutmuşsa bu üç iş değil, bir iştir — ve
  // kaç kez denediği satırın kendisinde daha çok işe yarıyor.
  const enSon = new Map<string, { at: number; kez: number }>()
  for (const d of snap.docs) {
    const memberId = String(d.get('subject.id') ?? '')
    if (!memberId) continue
    const at = (d.get('recordedAt') as Timestamp | null)?.toMillis() ?? now
    const v = enSon.get(memberId)
    if (v) v.kez += 1
    else enSon.set(memberId, { at, kez: 1 })
  }
  if (enSon.size === 0) return []

  // İsim olayda YOK (#6) ve olmamalı — `/members`ten okunuyor, satır sayısı kadar, en fazla 40.
  const ids = [...enSon.keys()]
  const uyeler = await adminDb().getAll(
    ...ids.map((id) => adminDb().collection('studios').doc(ctx.studioId).collection('members').doc(id)),
  )
  const ad = new Map(uyeler.map((d) => [d.id, String(d.get('fullName') ?? '')]))

  return ids
    .map((id) => {
      const { at, kez } = enSon.get(id)!
      const saat = new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      const gun = Math.floor((now - at) / GUN_MS)
      const neZaman = gun === 0 ? `bugün ${saat}` : gun === 1 ? `dün ${saat}` : `${gun} gün önce`
      return {
        item: {
          // Gün kimliğin PARÇASI: yarın tekrar gelirse bu YENİ bir iştir ve tiklenmiş sayılmaz.
          // Aynı günün ikinci okutması yeni iş değildir (OR-67 — soğuma olgunun kendisine bağlı).
          id: `door_refused__${id}_${new Date(at).toISOString().slice(0, 10)}`,
          kind: 'door_refused' as const,
          // Kapıya kadar gelmiş biri bekleyemez: bugünse acil, dünse hâlâ dikkat.
          severity: (gun === 0 ? 'urgent' : 'attention') as 'urgent' | 'attention',
          subject: { id, name: ad.get(id) || 'Bilinmeyen üye' },
          title: `${ad.get(id) || 'Bilinmeyen üye'} — kapıda kaldı (${neZaman})`,
          detail:
            kez > 1
              ? `Paketi bitmiş, turnikeden geçemedi — ${kez} kez denedi. Çalışmaya gelmişti; yenileme için arayın.`
              : 'Paketi bitmiş, turnikeden geçemedi. Çalışmaya gelmişti; yenileme için arayın.',
          href: `/members/${id}`,
          actionLabel: 'Üyeyi aç',
        },
        at,
      }
    })
    .sort((a, b) => b.at - a.at)
    .map((r) => r.item)
}
