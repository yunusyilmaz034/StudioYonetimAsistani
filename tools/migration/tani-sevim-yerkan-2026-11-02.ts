// SEVİM YERKAN — TANI (salt okuma, owner 2026-11-02). Paketler, satışlar, ödemeler, rezervasyonlar.
//   pnpm tsx tools/migration/tani-sevim-yerkan-2026-11-02.ts
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
initializeApp({ projectId: 'studio-yonetim-prod' })
const db = getFirestore()
const s = 'studios/retro', M = 'mem_01M59PS977PWRA3A15D4T4BX7P'
const t = (v: any) => (v?.toDate ? v.toDate().toISOString() : v)
async function main() {
  for (const c of ['entitlements', 'sales', 'payments', 'reservations']) {
    const q = await db.collection(`${s}/${c}`).where('memberId', '==', M).get()
    console.log(`── ${c} ${q.size}`)
    for (const d of q.docs) {
      const x = d.data()
      const o: any = {}
      for (const [k, v] of Object.entries(x)) o[k] = t(v)
      if (c === 'reservations') {
        const ss = await db.doc(`${s}/classSessions/${x.sessionId}`).get()
        console.log(d.id, x.status, x.entitlementId, x.creditEffect, t(ss.get('startsAt')), ss.get('category'), ss.get('title') ?? ss.get('name'))
      } else console.log(d.id, JSON.stringify(o, null, 0).slice(0, 1500))
    }
  }
  const m = await db.doc(`${s}/members/${M}`).get()
  console.log('member', m.get('fullName'), m.get('status'))
}
main()
