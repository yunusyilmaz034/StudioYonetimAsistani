// I-27 — the "already burned" report (v1.22, Step 0).
//
// Before the guard existed, the nightly sweep resolved reservations on CANCELLED sessions as
// `attended` (the policy default) and CONSUMED the member's credit for a class that never
// happened. This script FINDS those. It does not fix them.
//
// The owner's rule (OQ-6): no backfill, no history rewrite, no silent correction. A lost credit
// is given back by a human, through the existing correction flow, with a reason — and the same
// inconsistency BLOCKS a closure operation (D21) until she does.
//
// Read-only. Manual dev/ops tool. Never deployed, never in CI.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: process.env.STUDIO_PROJECT ?? 'demo-sos' })
const db = getFirestore()

const SID = process.env.STUDIO_ID ?? 'std_demo'
const RESOLVED = ['attended', 'no_show']

async function main(): Promise<void> {
  const cancelled = await db
    .collection(`studios/${SID}/classSessions`)
    .where('status', '==', 'cancelled')
    .get()

  if (cancelled.empty) {
    console.log('İptal edilmiş seans yok — tutarsızlık taraması boş.')
    return
  }

  let burned = 0
  let stranded = 0
  const rows: string[] = []

  for (const s of cancelled.docs) {
    const res = await db
      .collection(`studios/${SID}/reservations`)
      .where('classSessionId', '==', s.id)
      .get()

    for (const r of res.docs) {
      const d = r.data()
      const status = d.status as string
      const effect = d.creditEffect as string
      const source = (d.attendanceSource as string | null) ?? '—'

      // The damage: resolved as attendance against a class that was cancelled, credit consumed.
      if (RESOLVED.includes(status)) {
        const lost = effect === 'consumed'
        if (lost) burned++
        rows.push(
          `  ${lost ? '🔴 KREDİ YANMIŞ' : '🟡 tutarsız'}  seans=${s.id.slice(-6)} ` +
            `üye=${(d.memberId as string).slice(-6)} durum=${status} kredi=${effect} kaynak=${source}`,
        )
      }
      // Still booked against a cancelled class: not damaged yet, but the sweep would have
      // burned it. With I-27 in place it will now be RELEASED instead.
      if (status === 'booked') {
        stranded++
        rows.push(
          `  🟢 açıkta (I-27 ile serbest bırakılacak)  seans=${s.id.slice(-6)} ` +
            `üye=${(d.memberId as string).slice(-6)}`,
        )
      }
    }
  }

  console.log(`İptal edilmiş seans: ${cancelled.size}`)
  console.log(rows.length ? rows.join('\n') : '  (etkilenen rezervasyon yok)')
  console.log(`\nÖZET`)
  console.log(`  Gerçekten yanmış kredi (insan düzeltmesi gerekir): ${burned}`)
  console.log(`  Hâlâ 'booked' (I-27 artık serbest bırakacak):      ${stranded}`)
  if (burned > 0) {
    console.log(
      `\n⚠ ${burned} rezervasyon iptal edilmiş bir derse karşı "katıldı" sayılmış ve kredisi tüketilmiş.` +
        `\n  Bunlar OTOMATİK düzeltilmez: Yoklama ekranındaki "Düzelt" akışıyla, sebep yazılarak` +
        `\n  geri verilir (reservation.corrected). Düzeltilene kadar ilgili seans, Tatil/Kapanış` +
        `\n  operasyonundan BLOKLANIR (D21).`,
    )
  }
}

void main()
