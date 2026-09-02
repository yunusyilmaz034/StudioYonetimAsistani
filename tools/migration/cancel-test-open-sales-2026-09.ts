import { FirestoreFinanceRepository, cancelSale, systemClock, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// TEST HESAPLARININ AÇIK SATIŞLARINI KAPAT (owner, 2026-09-02).
//
//   pnpm tsx tools/migration/cancel-test-open-sales-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/cancel-test-open-sales-2026-09.ts --apply
//
// Owner: *"yunus test de borçlu gözüküyor, hiçbir kayıtta yunus test gözükmesin."*
//
// Ekranlar yalan söylemiyordu: hesabın gerçekten açık bir satışı vardı. Bir deneme sırasında
// kurulmuş, ödenmemiş ve defterde ALACAK olarak kalmıştı. Filtreyle gizlemek yanlış cevap olurdu —
// gizlenen bir alacak hâlâ bir alacaktır. Doğru cevap onu SEBEBİYLE iptal etmek: hiç tahsil
// edilmeyecek bir borç, defterde durmamalı.
//
// Yalnızca `settings/projection.excludedMemberIds` içindeki hesaplara ve yalnızca `open`
// satışlara dokunuyor. Tahsil edilmiş satışlara elini sürmüyor: onlar gerçekten olmuş hareketler.

const STUDIO = 'retro'
const RUN = 'cancel-test-open-sales-2026-09'
const REASON = 'Test hesabının denemede kalmış açık satışı; hiç tahsil edilmeyecek. Owner onayı, 02.09.2026.'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')

  const settings = await db.doc(`studios/${STUDIO}/settings/projection`).get()
  const excluded: string[] = (settings.get('excludedMemberIds') as string[] | undefined) ?? []
  if (excluded.length === 0) return console.log('hariç tutulan hesap yok.')

  let sayac = 0
  for (const id of excluded) {
    const m = await db.doc(`studios/${STUDIO}/members/${id}`).get()
    const ad = String(m.get('fullName') ?? id)
    const sales = await db.collection(`studios/${STUDIO}/sales`).where('memberId', '==', id).get()
    for (const d of sales.docs) {
      const s = d.data() as { status?: string; total?: { amount?: number }; paid?: { amount?: number } }
      if (s.status !== 'open') continue
      const borc = (s.total?.amount ?? 0) - (s.paid?.amount ?? 0)
      console.log(`${ad}: ${d.id} · açık ${(borc / 100).toLocaleString('tr-TR')} ₺ → iptal`)
      sayac++
      if (!apply) continue
      const r = await cancelSale(fin, ctx, { saleId: d.id, reason: REASON })
      if (!r.ok) console.error('  BAŞARISIZ:', r.error)
    }
  }
  console.log(`\ntoplam: ${sayac} açık satış`)
  if (!apply) console.log('(uygulamak için --apply)')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
