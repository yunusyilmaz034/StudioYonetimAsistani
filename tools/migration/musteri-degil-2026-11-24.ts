import { FirestoreCrmRepository, decideLoseLead, newOperationId, systemClock, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

// İŞ İÇİN YAZANLAR INSTAGRAM HATTINDAN ÇIKAR (owner, 2026-11-24: "müşteri dışındakileri getirme, örneğin
// meriç ve sunay"). Panelin yeni "Müşteri değil" düğmesiyle aynı yazım: `settings/ai.ignoredContacts`a eklenir.
// Sohbet belgeleri yerinde kalır (Sohbetler → "Müşteri değil" filtresi); yeni mesajları saklanmaz.
//   pnpm tsx tools/migration/musteri-degil-2026-11-24.ts            (kuru çalışma)
//   pnpm tsx tools/migration/musteri-degil-2026-11-24.ts --apply
const STUDIO = 'retro'
const RUN = 'musteri-degil-2026-11-24'
const KEYS = [
  'ig_1140057942055592', // @pt.meric — iş için yazdı
  'ig_1903572474415507', // @sunaydrna — işbirliği için yazdı
  'ig_1486952046697455', // @karavandakievimiz — Karavan Time, iş (owner: "evet onu da çıkar")
]
// İkisi telefon yazdığı için hunide `new` adayı açılmıştı; owner onayıyla kapanır (lost · other · not).
const LEADS = ['led_01M8459RXH39EP5FKSPWAM4AKP', 'led_01M864QZEV8KEAP6QMKN8AZW1E']
const NOTE = 'Müşteri değil — iş/işbirliği için yazdı (owner, 2026-11-24)'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ai = db.doc(`studios/${STUDIO}/settings/ai`)
  const before = ((await ai.get()).get('ignoredContacts') as string[] | undefined) ?? []
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const id of KEYS) {
    const s = await db.doc(`studios/${STUDIO}/conversations/${id}`).get()
    if (!s.exists) throw new Error(`${id}: sohbet yok — durdum`)
    console.log(`  ${id}: @${String(s.get('handle'))} ${before.includes(id) ? '(zaten listede)' : '→ eklenecek'}`)
  }
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const crm = new FirestoreCrmRepository(db)
  const closes = []
  for (const id of LEADS) {
    const lead = await crm.getLead(ctx, id)
    if (!lead) throw new Error(`${id}: aday yok — durdum`)
    if (lead.stage === 'lost') {
      console.log(`  ${id}: zaten kapalı`)
      continue
    }
    const d = decideLoseLead({ studioId: ctx.studioId, actor: ctx.actor, now: systemClock.now(), correlationId: newOperationId(), source: 'migration' } as Parameters<typeof decideLoseLead>[0], lead, 'other', NOTE)
    if (!d.ok) throw new Error(`${id}: ${JSON.stringify(d.error)}`)
    console.log(`  ${id}: ${lead.stage} → lost (other)`)
    closes.push(d.value)
  }
  if (!apply) return void console.log('\nkuru çalışma — hiçbir şey yazılmadı')
  for (const c of closes) await crm.saveLead(ctx, c.next, c.events)
  await ai.set(
    { ignoredContacts: FieldValue.arrayUnion(...KEYS), updatedAt: Timestamp.now(), updatedBy: { type: 'migration', id: RUN } },
    { merge: true },
  )
  const after = ((await ai.get()).get('ignoredContacts') as string[] | undefined) ?? []
  console.log(`✅ ignoredContacts: ${before.length} → ${after.length}; ${closes.length} aday kapandı`)
  process.exit(0)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
