import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// FT-2 — ONLINE ÖDEMEDE KARTTAN ÇEKİLEN TUTAR (owner, 2026-11-05: "online paytr de satış bedeli üzerinden fatura
// kesilmiyor komisyon oranıyla biz kesiyoruz"). Bugünden sonra ödenen her PAYTR ödemesi `paymentIntents.paidAmount`
// taşıyor. Eskiler için aynı gerçek zaten `payment_intent.succeeded` olayında (`payload.paidAmount`) duruyor; bu
// betik yalnız onu durum belgesine kopyalar. Olay yazmaz, olaya dokunmaz, gelir/kasa değişmez (gelir `amount`).
//   pnpm tsx tools/migration/ft2-paytr-odenen-tutar-2026-11-05.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ft2-paytr-odenen-tutar-2026-11-05.ts --apply
const STUDIO = 'retro'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const events = await db.collection(`studios/${STUDIO}/events`).where('type', '==', 'payment_intent.succeeded').get()
  const paid = new Map<string, { amount: number; currency: string }>()
  for (const e of events.docs) {
    const p = e.get('payload') as { providerRef?: string; paidAmount?: { amount: number; currency: string } } | undefined
    if (p?.providerRef && typeof p.paidAmount?.amount === 'number') paid.set(p.providerRef, p.paidAmount)
  }
  const intents = await db.collection(`studios/${STUDIO}/paymentIntents`).get()
  let todo = 0
  let differ = 0
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const d of intents.docs) {
    if (d.get('paidAmount')) continue
    const ref = String(d.get('providerRef') ?? '')
    const p = paid.get(ref)
    if (!p) continue
    todo++
    const amount = (d.get('amount') as { amount: number }).amount
    if (p.amount !== amount) {
      differ++
      console.log(`  ${d.id} · ${ref} · tutar ${amount / 100} ₺ → kartta ${p.amount / 100} ₺`)
    }
    if (apply) await d.ref.set({ paidAmount: p }, { merge: true })
  }
  console.log(`olay: ${events.size} · yazılacak niyet: ${todo} · komisyonlu (farklı): ${differ}`)
  if (apply) console.log('✓ yazıldı')
  process.exit(0)
}
void main()
