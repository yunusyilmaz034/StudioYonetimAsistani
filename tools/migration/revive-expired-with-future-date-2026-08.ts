// Süresi dolmuş sayılan ama bitiş tarihi GELECEKTE olan paketleri düzelt (owner, 2026-08-31).
//
//   pnpm tsx tools/migration/revive-expired-with-future-date-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/revive-expired-with-future-date-2026-08.ts --apply
//
// WHY. The owner extended two members' end dates to 7 September from the subscription dialog. The
// date moved and the status did not, because nothing moved it: `decideAmend` never touched status,
// `decideReactivate` takes only `cancelled`, `decideExtend` refuses anything not active. Both
// records ended up contradicting themselves — `expired`, valid for another week — and two paying
// members could not book. One of them scanned her QR at the door and the studio saw "pasif".
//
// The code fix landed in the same commit: an expired PERIOD package whose end date moves into the
// future now comes back, and a credit package is refused because expiry burned its credits. This
// script repairs the two rows that were already written before the fix existed.
//
// It goes through the DOMAIN, not around it. A hand-edit in the console would leave the state right
// and the log silent — and the log is the only thing that can later answer why a membership came
// back to life. `amendSubscription` writes `entitlement.amended` + `entitlement.reactivated` with a
// mandatory reason, exactly as the panel now does.
//
// STRICTLY BOUNDED: only rows that are `expired` AND whose `validUntil` is in the future AND which
// carry no credits. Anything else is listed and skipped — this is a repair, not a sweep.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

import {
  amendEntitlement,
  FirestoreEntitlementRepository,
  instant,
  systemClock,
  type EntitlementId,
  type TenantContext,
} from '@studio/core'

const STUDIO = 'retro'
const REASON =
  'Bitiş tarihi ileri alındı ama paket "süresi doldu" durumunda kalmıştı; 31.08.2026 düzeltmesi.'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const now = Date.now()
  const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
  const gun = (t: number) => new Date(t).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const uyeler = new Map(
    (await db.collection(`studios/${STUDIO}/members`).get()).docs.map((d) => [d.id, String((d.data() as { fullName?: string }).fullName ?? '')]),
  )
  const snap = await db.collection(`studios/${STUDIO}/entitlements`).get()
  const hedef = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string } & Record<string, unknown>)
    .filter((e) => e.status === 'expired' && ms(e.validUntil) > now)

  if (hedef.length === 0) {
    console.log('Düzeltilecek kayıt yok.')
    return
  }

  // The break-glass identity, and it is named: the log must be able to say that a script did this,
  // not a member of staff who was at home (#5 — no actor borrows a human's identity).
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:revive-expired-2026-08' },
    branchIds: [],
    correlationId: 'mig_revive_expired_2026_08',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  for (const e of hedef) {
    const ad = uyeler.get(String(e.memberId)) ?? '?'
    const krediliMi = e.credits != null
    console.log(`${ad.padEnd(24)} ${String((e.productSnapshot as { name?: string })?.name).padEnd(24)} bitiş ${gun(ms(e.validUntil))} · ${krediliMi ? 'KREDİLİ' : 'süreli'}`)
    if (krediliMi) {
      console.log('   ⏭  atlandı: kredili paket. Süre dolarken kalan dersler yandı — sadece tarih')
      console.log('       ileri alınırsa dersi olmayan "aktif" paket kalır. Bu ayrı bir karar.')
      continue
    }
    if (!apply) {
      console.log('   → aktife alınacak')
      continue
    }
    // The SAME validUntil it already has: the amend is not changing the date, it is asking the
    // domain to re-judge a row whose date has already moved. The revival rule fires on that.
    const res = await amendEntitlement(deps, ctx, {
      entitlementId: e.id as EntitlementId,
      patch: { validUntil: instant(ms(e.validUntil)) },
      reason: REASON,
    })
    console.log(res.ok ? '   ✅ aktife alındı' : `   ❌ reddedildi: ${JSON.stringify(res.error)}`)
  }

  if (!apply) console.log('\n(uygulamak için --apply)')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
