import { FirestoreTrainingRepository, removeMeasurement, systemClock, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// NUR BAHAR YILMAZ — YANLIŞ GİRİLEN ÖLÇÜMLER SİLİNİR (owner, 2026-10-21)
//
//   pnpm tsx tools/migration/fix-nur-bahar-yilmaz-olcumler-2026-10-21.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-nur-bahar-yilmaz-olcumler-2026-10-21.ts --apply    # yaz
//
// Owner: *"Nur Bahar Yılmaz ölçümleri yanlış olmuş, silmek istedik ama silme yoktu; silme özelliği yap ve bu
// kişinin ölçümlerini sil."* Masanın yeni "Sil" düğmesiyle aynı use-case (`removeMeasurement`), sebep
// `wrong_entry`. Kayıt gider, `measurement.removed` olayı kalır (değer taşımaz).

const STUDIO = 'retro'
const RUN = 'fix-nur-bahar-yilmaz-olcumler-2026-10-21'
const APPLY = process.argv.includes('--apply')
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase()

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreTrainingRepository(db), clock: systemClock }

  const uyeler = await db.collection(`studios/${STUDIO}/members`).get()
  const bulunan = uyeler.docs.filter((d) => { const n = fold(String(d.get('fullName') ?? '')); return n.includes('nur') && n.includes('bahar') && n.includes('yilmaz') })
  console.log(`━━ eşleşme: ${bulunan.map((d) => `${d.get('fullName')} (${d.id})`).join(' · ') || 'YOK'}`)
  if (bulunan.length !== 1) { console.error('DUR: tek üye bulunmalı.'); process.exit(1) }
  const memberId = bulunan[0]!.id

  const olcumler = await deps.repo.listMeasurementsByMember(ctx, memberId)
  console.log(`   ${olcumler.length} ölçüm · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  for (const m of olcumler) console.log(`   ${m.id} · ${m.takenOn} · ${m.weightKg ?? '—'} kg${m.correctedFrom ? ' · düzeltme' : ''}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  for (const m of olcumler) {
    const r = await removeMeasurement(deps, ctx, { measurementId: m.id, memberId, reason: 'wrong_entry' }, 'migration' as never)
    if (!r.ok) { console.error(`DUR: ${m.id}: ${JSON.stringify(r.error)}`); process.exit(1) }
    console.log(`   ✓ silindi ${m.takenOn}`)
  }
  console.log(`\n✅ kalan: ${(await deps.repo.listMeasurementsByMember(ctx, memberId)).length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
