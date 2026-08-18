import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// AĞUSTOS 2026 FITNESS KAMPANYASI — a break-glass price update, run by hand.
//
//   pnpm tsx tools/migration/campaign-2026-08-prices.ts            (dry run)
//   pnpm tsx tools/migration/campaign-2026-08-prices.ts --apply
//
// The poster the studio is about to advertise:
//
//   3 Aylık   nakit  8.500 ₺   kart  9.500 ₺   (6 taksite kadar, vade farkı üyede)
//   6 Aylık   nakit 12.750 ₺   kart 14.000 ₺   (6 taksite kadar, vade farkı üyede)
//  12 Aylık   nakit 19.500 ₺   kart 22.000 ₺   (peşin fiyatına 3 taksit, vade farkı stüdyoda)
//
// `priceInKurus` is the CARD price, because that is what the app actually charges — buying in the
// app is buying by card. The cash prices need a per-product field that does not exist yet: the
// current model derives card from cash with ONE rule per category, and this campaign's differences
// are neither a constant amount (1.000 / 1.250 / 2.500) nor a constant percentage (11.8 / 9.8 /
// 12.8 %). That field is a separate change; this script only fixes what is wrong today.
//
// `maxInstallments` moves 3 → 6: the poster promises six on the 3- and 6-month packages and the
// checkout was capped at three, so the offer could not have been honoured.

const STUDIO = 'retro'

const PRICES: readonly { id: string; name: string; cardKurus: number }[] = [
  { id: 'prd_01KXJD2CW08CNP08KJRSW34DRR', name: 'Fitness - 3 Aylık', cardKurus: 950_000 },
  { id: 'prd_01KXJD2D1EMQRC6C0RD777VG2Y', name: 'Fitness - 6 Aylık', cardKurus: 1_400_000 },
  { id: 'prd_01KZBDCZYNYPBDZXSNRVGGPXJE', name: 'Fitness - 12 Aylık', cardKurus: 2_200_000 },
]

const MAX_INSTALMENTS = 6
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const p of PRICES) {
    const ref = db.doc(`studios/${STUDIO}/products/${p.id}`)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`✗ ${p.name}: ürün bulunamadı`)
      continue
    }
    const current = Number(snap.get('priceInKurus'))
    const same = current === p.cardKurus
    console.log(`${p.name.padEnd(20)} ${tl(current).padStart(11)} → ${tl(p.cardKurus).padStart(11)}${same ? '   (değişmiyor)' : ''}`)
    if (apply && !same) await ref.update({ priceInKurus: p.cardKurus, updatedAt: Date.now() })
  }

  const sref = db.doc(`studios/${STUDIO}/settings/studio`)
  const settings = (await sref.get()).data() ?? {}
  const surcharge = (settings.paymentSurcharge ?? {}) as Record<string, unknown>
  console.log(`\ntaksit üst sınırı    ${String(surcharge.maxInstallments ?? '—').padStart(11)} → ${String(MAX_INSTALMENTS).padStart(11)}`)
  if (apply) {
    // Merged, not replaced: `byCategory` and the transfer surcharge live in the same object and are
    // not this campaign's business.
    await sref.set({ paymentSurcharge: { ...surcharge, maxInstallments: MAX_INSTALMENTS } }, { merge: true })
  }

  console.log(apply ? '\nBitti.' : '\nUygulamak için --apply')
  process.exit(0)
}

void main()
