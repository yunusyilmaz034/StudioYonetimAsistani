'use server'

import {
  isClean,
  readBulutGymMembers,
  REJECTION_COPY,
  registerMember,
  systemClock,
  validateMembers,
  type BranchId,
  type MembersDeps,
  type ValidationReport,
} from '@studio/core'
import { FirestoreMemberRepository } from '@studio/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { observed } from '../log'

// THE BULUTGYM IMPORT, from the product (v1.27 S5).
//
// ── What it imports, and what it refuses to invent ──────────────────────────────────────────
// BulutGym exports a name and a phone. That is all (owner, 2026-07-13), and so that is all this
// imports. **Packages, credits, balances and history are NOT derived, NOT estimated and NOT carried
// over** — they are opened by hand, member by member, against the owner's own list. Forty-five
// members is an afternoon. A guessed credit balance is a dispute that lasts a year.
//
// ── ONE bad row blocks the ENTIRE run ───────────────────────────────────────────────────────
// A partial import leaves a members list that is *almost* right, and nobody can tell which half. The
// cost of refusing is an afternoon with a spreadsheet; the cost of a half-import is discovering in
// March that a member has been missing since January.
//
// ── The rules are the SAME rules the break-glass script runs ────────────────────────────────
// `validateMembers` lives in `members/domain` and both callers use it. Two validators are two answers
// to *"may this row enter production?"*, and one of them is wrong.
//
// ── On AD-36 ────────────────────────────────────────────────────────────────────────────────
// The architecture says a migration is a script, never automatable — *"a migration that can run
// automatically is a migration that will, once, at the wrong moment."* That rule was written about
// the migration that emits historical events and reconciles credits, and it still holds: **that one
// is still a script, and nothing here touches it.** This imports names and phones, refuses everything
// it cannot read, and is idempotent by construction (a phone is unique — I-21 — so the domain refuses
// the same member twice). The owner cannot run a CLI, and asking her to is how the import ends up
// being done by hand into the Firestore console.

const OWNER = ['owner', 'platform_admin'] as const

const deps = (): MembersDeps => ({
  repo: new FirestoreMemberRepository(adminDb()),
  clock: systemClock,
  source: 'migration', // the log will say what produced these rows, and it will be true
})

/**
 * The preview, in a shape the SCREEN can hold.
 *
 * The rejection reason is translated *here*, on the server — the screen never imports `@studio/core`,
 * because one `import` of a value from the kernel drags `firebase-admin` into the browser bundle.
 */
export interface ImportPreview {
  readonly total: number
  readonly validCount: number
  readonly rejected: readonly {
    readonly line: number
    readonly fullName: string
    readonly phoneRaw: string
    readonly message: string
  }[]
  readonly clean: boolean
  readonly error: string | null
}

const present = (report: ValidationReport): ImportPreview => ({
  total: report.total,
  validCount: report.valid.length,
  rejected: report.rejected.map((r) => ({
    line: r.line,
    fullName: r.fullName,
    phoneRaw: r.phoneRaw,
    message:
      REJECTION_COPY[r.reason] +
      (r.collidesWithLine ? ` (satır ${r.collidesWithLine} ile)` : ''),
  })),
  clean: isClean(report),
  error: null,
})

/**
 * Read the file and say, row by row, whether it may enter the system. **Writes nothing.**
 *
 * A phone collision needs a human and a phone call — so it is found here, days before anyone presses
 * the other button, and not at T+2h on cutover morning (Doc 8, R9).
 */
export async function previewImportAction(input: unknown): Promise<ImportPreview> {
  const p = z.object({ csv: z.string().min(1) }).parse(input)
  await requireTenantContext(OWNER)

  try {
    return present(validateMembers(readBulutGymMembers(p.csv)))
  } catch (err) {
    // A file whose columns we cannot name is a file we do not understand, and importing a file you do
    // not understand is how a phone number ends up in the name field of forty-five member records.
    return {
      total: 0,
      validCount: 0,
      rejected: [],
      clean: false,
      error: err instanceof Error ? err.message : 'Dosya okunamadı.',
    }
  }
}

export interface ImportResult {
  readonly imported: number
  readonly failed: readonly { readonly line: number; readonly fullName: string; readonly code: string }[]
}

export async function applyImportAction(input: unknown) {
  const p = z.object({ csv: z.string().min(1), branchId: z.string().nullable() }).parse(input)
  const ctx = await requireTenantContext(OWNER)

  const report = validateMembers(readBulutGymMembers(p.csv))
  if (!isClean(report)) {
    // The screen already showed her this. Refusing again here is the lock behind the door: nothing
    // enters production because a button was enabled by a stale render.
    throw new Error('Dosyada reddedilen satırlar var. İçe aktarma yapılmadı.')
  }

  const imported: string[] = []
  const failed: { line: number; fullName: string; code: string }[] = []

  for (const member of report.valid) {
    const res = await registerMember(deps(), ctx, {
      fullName: member.fullName,
      phone: member.phoneE164,
      homeBranchId: (p.branchId ?? null) as BranchId | null,
      // Everything else is ABSENT, and absence is the honest record of what the source held. A birth
      // date we invent is a birthday card sent on the wrong day, forever.
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    })
    if (res.ok) imported.push(member.fullName)
    else failed.push({ line: member.line, fullName: member.fullName, code: res.error.code })
  }

  await observed('member.import', ctx, undefined, { imported: imported.length, failed: failed.length }, async () => ({
    ok: true as const,
    value: undefined,
  }))

  revalidatePath('/members')
  return { imported: imported.length, failed } satisfies ImportResult
}
