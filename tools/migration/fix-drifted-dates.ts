import {
  FirestoreEntitlementRepository,
  amendEntitlement,
  instant,
  systemClock,
  type EntitlementId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// FIX THE DRIFTED PACKAGE DATES — a break-glass script, run by hand, once.
//
//   pnpm tsx tools/migration/fix-drifted-dates.ts              (dry run — writes NOTHING)
//   pnpm tsx tools/migration/fix-drifted-dates.ts --apply
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
//
// The panel's date inputs converted a stored instant to `yyyy-mm-dd` in UTC while the studio lives
// at UTC+3. Every save of an already-saved package therefore re-read the date one day earlier and
// wrote it back, so a package edited four times had walked four days into the past. The member's
// validity window moved with it: she lost days off the END that she had paid for.
//
// The input bug is fixed (`STUDIO_UTC_OFFSET_MIN` in members/subscriptions.tsx). This repairs the
// rows it already damaged. The owner supplied the true START dates from his own records; the END
// dates below are START + the product's own duration, which is the same arithmetic the sale used.
//
// ── WHY IT IS SAFE TO RUN TWICE ─────────────────────────────────────────────────────────────
//
// `amendEntitlement` compares before writing and emits nothing when a patch changes nothing, so a
// second run is a no-op rather than a second event. Nothing is overwritten in place: each change is
// an append-only compensating event carrying the reason below (non-negotiable #9).
//
// ── THE ACTOR ───────────────────────────────────────────────────────────────────────────────
//
// A `migration` principal, not a human's login (#5). Reception did not make this change and the log
// must never say she did.
const RUN_ID = 'mig_2026_08_14_date_drift'
const REASON = 'Tarih kayması düzeltmesi — panelin gün alanı UTC okuduğu için başlangıç her kayıtta bir gün geriye gitmişti'

interface Fix {
  readonly who: string
  readonly id: string
  readonly validFrom: string
  /** Absent where the record already ends on the right day and only the start is wrong. */
  readonly validUntil?: string
}

// İrem's row is the one exception and it is deliberate: her window is recorded as 31 days against a
// 30-day product, so the drift added a day at the front without moving the end. Correcting only the
// start makes the record true and takes nothing from her — moving the end too would hand her a
// second day she was never sold.
const FIXES: readonly Fix[] = [
  { who: 'Çağla Kökener · Reformer 24 Ders',   id: 'ent_01KXZYQS0CYZ7NGKXZSMHDMFH6', validFrom: '2026-07-06', validUntil: '2026-10-04' },
  { who: 'İrem Kılıç · Reformer 8 Ders',       id: 'ent_01KY537F7YB2HC02NP09N8NMSQ', validFrom: '2026-07-22' },
  { who: 'Gülcan Ayvaz · Fitness 6 Aylık',     id: 'ent_01KZ3E35PYC01HTRPQW030Z1MH', validFrom: '2026-08-03', validUntil: '2027-01-30' },
  { who: 'Buse Ertaş · Hibrit (fitness)',      id: 'ent_01KZWZKWG8JJNMYVYJYT7GM2RX', validFrom: '2026-08-13', validUntil: '2026-09-12' },
  { who: 'Buse Ertaş · Hibrit (pilates)',      id: 'ent_01KZWZKWM0Q180E460YKK91MXF', validFrom: '2026-08-13', validUntil: '2026-09-12' },
  { who: 'Şule Gürses · Hibrit (fitness)',     id: 'ent_01KZNVQ4G0GGVKB5GCHEVGQK6E', validFrom: '2026-09-01', validUntil: '2026-10-01' },
  { who: 'Şule Gürses · Hibrit (pilates)',     id: 'ent_01KZNVQ4NQ3V0KZZ4WS58A372P', validFrom: '2026-09-01', validUntil: '2026-10-01' },
]

// A studio day, read as the studio reads it. The same +03:00 the panel now uses — a date typed by a
// human in Türkiye means midnight in Türkiye, and building it any other way is the bug this repairs.
const dayMs = (iso: string): number => {
  const ms = Date.parse(`${iso}T00:00:00+03:00`)
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`)
  return ms
}
const show = (ms: number): string => new Date(ms + 180 * 60_000).toISOString().slice(0, 10)

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId: 'retro' as StudioId,
    branchIds: ['mutlukent'] as unknown as TenantContext['branchIds'],
    role: 'owner',
    actor: { type: 'migration', id: RUN_ID as never },
  }
  const deps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  let changed = 0
  for (const f of FIXES) {
    const before = await db.doc(`studios/retro/entitlements/${f.id}`).get()
    if (!before.exists) {
      console.log(`✗ ${f.who}: kayıt yok (${f.id})`)
      continue
    }
    const curFrom = before.get('validFrom')?.toMillis?.() ?? before.get('validFrom')
    const curUntil = before.get('validUntil')?.toMillis?.() ?? before.get('validUntil')
    const wantUntil = f.validUntil ? dayMs(f.validUntil) : curUntil

    console.log(
      `${f.who}\n   ${show(curFrom)} → ${show(curUntil)}   ⇒   ${f.validFrom} → ${show(wantUntil)}` +
        (f.validUntil ? '' : '   (bitiş bilerek değişmiyor)'),
    )

    if (!apply) {
      changed++
      continue
    }

    const res = await amendEntitlement(deps, ctx, {
      entitlementId: f.id as EntitlementId,
      patch: {
        validFrom: instant(dayMs(f.validFrom)),
        ...(f.validUntil ? { validUntil: instant(dayMs(f.validUntil)) } : {}),
      },
      reason: REASON,
    })
    if (!res.ok) {
      console.log(`   ✗ REDDEDİLDİ: ${JSON.stringify(res.error)}`)
      continue
    }
    const after = await db.doc(`studios/retro/entitlements/${f.id}`).get()
    console.log(`   ✓ ${show(after.get('validFrom').toMillis())} → ${show(after.get('validUntil').toMillis())}`)
    changed++
  }

  console.log(`\n${changed}/${FIXES.length} kayıt${apply ? ' düzeltildi' : ' düzeltilecek'}.`)
  process.exit(0)
}

void main()
