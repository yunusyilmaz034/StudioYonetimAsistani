import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// SESSİZCE KAPATILMIŞ SORULARI GERİ AÇ (owner, 2026-09-01).
//
//   pnpm tsx tools/migration/flag-unanswered-conversations-2026-09.ts
//   pnpm tsx tools/migration/flag-unanswered-conversations-2026-09.ts --apply
//
// ── NEDEN ───────────────────────────────────────────────────────────────────────────────────
//
// "Gördüm" ve "AI'ya ver" bugüne kadar `needsAttention`'ı, müşterinin sorusu cevapsızken bile
// temizliyordu. Kural bugün düzeltildi — ama düzeltme yalnızca BUNDAN SONRA basılacak düğmeleri
// kapsıyor. Geçmişte işareti silinmiş bir soru, hiçbir zaman kendiliğinden geri gelmez: AI ancak
// yeni mesaj gelince konuşur, ve o mesaj hiç gelmedi.
//
// Bilinen bir kurban var (21 saat), ve sayısını tahmin etmek yerine ölçüyoruz.
//
// ── NE YAPMIYOR ────────────────────────────────────────────────────────────────────────────
//
// Kimseye mesaj GÖNDERMİYOR. Yalnızca "burada cevap bekleyen biri var" işaretini geri koyuyor;
// ne yazılacağına insan karar verecek. Bir müşteriye bir gün sonra otomatik cevap yazmak,
// cevapsız bırakmaktan daha kötü bir izlenim verebilir.

const STUDIO = 'retro'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const snap = await db.collection(`studios/${STUDIO}/conversations`).get()
  const now = Date.now()
  let hedef = 0

  for (const d of snap.docs) {
    const c = d.data() as { messages?: { role?: string; at?: number; text?: string }[]; needsAttention?: boolean; name?: string }
    const son = c.messages?.[c.messages.length - 1]
    // Son söz müşteride mi, ve işaret kapalı mı? İkisi birden doğruysa bu soru kayboldu demektir.
    if (son?.role !== 'user' || c.needsAttention === true) continue
    // On dakika: sağlık kontrolüyle aynı eşik. Az önce yazmış birine "cevapsız" demek erken.
    const dk = Math.round((now - Number(son.at ?? now)) / 60_000)
    if (dk < 10) continue

    hedef++
    console.log(`${String(dk).padStart(6)} dk | ${String(c.name ?? d.id).padEnd(24)} | ${String(son.text ?? '').slice(0, 50)}`)
    if (apply) await d.ref.update({ needsAttention: true, attentionReason: 'unanswered' })
  }

  console.log(`\ntoplam sohbet        : ${snap.size}`)
  console.log(`işareti geri konacak : ${hedef}`)
  if (!apply) console.log('\n(uygulamak için --apply)')
  else console.log('\n✓ Panelde görünür oldular. Cevabı insan yazacak.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
