'use server'

import {
  DEFAULT_TIME_ZONE,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  systemClock,
  updateStudioSettings,
  type SchedulingDeps,
  type StudioSettings,
} from '@studio/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { observed } from '../log'

// STUDIO SETTINGS (v1.27 S2 · owner, 2026-07-13).
//
// The point of this sprint is not a screen. It is that **a studio can be set up without anybody
// touching the Firestore console** — which is the thing the runbook forbids, and which was, until
// today, the only way to do it.
//
// One document (`/studios/{sid}/settings/studio`), one write path, one source of truth. A company
// name typed into an e-mail template is a company name that will be wrong in one of them.

const OWNER = ['owner', 'platform_admin'] as const
const deps = (): SchedulingDeps => ({
  repo: new FirestoreSchedulingRepository(adminDb()),
  clock: systemClock,
  studioConfig: { timeZone: DEFAULT_TIME_ZONE, utcOffsetMinutes: 180 },
  hours: new FirestoreStudioHours(adminDb()),
})

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD biçiminde olmalı')
const dayHours = z.object({ open: hhmm, close: hhmm }).nullable()

const schema = z.object({
  company: z
    .object({
      legalName: z.string().min(1),
      displayName: z.string().min(1),
      taxOffice: z.string(),
      taxNumber: z.string(),
      phone: z.string(),
      email: z.string(),
      website: z.string().nullable(),
      address: z.string(),
    })
    .nullable(),
  workingHours: z
    .object({
      0: dayHours,
      1: dayHours,
      2: dayHours,
      3: dayHours,
      4: dayHours,
      5: dayHours,
      6: dayHours,
    })
    .nullable(),
  defaultCancellationWindowHours: z.number().int().min(0).max(720).nullable(),
  defaultSessionDurationMinutes: z.number().int().min(1).max(600).nullable(),
  lowCreditThreshold: z.number().int().min(0).max(100).nullable(),
  discountCeilingPercent: z.number().int().min(0).max(100).nullable(),
  qr: z
    .object({
      tokenTtlSeconds: z.number().int().min(15).max(600),
      checkInWindowMinutes: z.number().int().min(0).max(240),
    })
    .nullable(),
  notifications: z
    .object({
      dailyLimit: z.number().int().min(1).max(100_000),
      quietFromHour: z.number().int().min(0).max(23),
      quietToHour: z.number().int().min(0).max(23),
      // `in_app` is not negotiable and is added below. E-mail (Resend) and WhatsApp (Meta, Plus
      // Phase 5) both have a real transport now, so both are toggles; SMS and push do not, and a
      // switch that turns on a channel we cannot send is a switch that lies.
      emailEnabled: z.boolean(),
      whatsappEnabled: z.boolean().optional(),
    })
    .nullable(),
  // Plus Phase 8 — the studio's physical capacity and occupancy bands (fractions of capacity,
  // ascending). Optional: a save that does not touch it preserves whatever is stored.
  fitness: z
    .object({
      capacity: z.number().int().min(0).max(100_000),
      moderateAt: z.number().min(0).max(1),
      busyAt: z.number().min(0).max(1),
      veryBusyAt: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
  // Plus (pilot) — the KK/havale surcharge (integer kuruş) + max installments for PAYTR. Optional:
  // a save that does not touch it preserves whatever is stored.
  paymentSurcharge: z
    .object({
      cardTransferSurchargeKurus: z.number().int().min(0),
      maxInstallments: z.number().int().min(1).max(12),
    })
    .nullable()
    .optional(),
})

/** Read. Reception may READ them (the session form needs the default duration); only the owner writes. */
export async function getStudioSettingsAction(): Promise<StudioSettings | null> {
  const ctx = await requireTenantContext(['owner', 'receptionist', 'platform_admin'])
  return new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
}

export async function updateStudioSettingsAction(input: unknown) {
  const p = schema.parse(input)
  const ctx = await requireTenantContext(OWNER)

  // The TIMEZONE is not in the form (owner, 2026-07-13): it is stored, the system uses it, and the
  // screen shows it read-only. Five client components still hard-code the offset, so a picker would
  // be a control that half-works — and a setting that lies is worse than a setting that is absent.
  const current = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)

  const next: StudioSettings = {
    studioId: ctx.studioId,
    timeZone: current?.timeZone ?? DEFAULT_TIME_ZONE,
    company: p.company,
    workingHours: p.workingHours as StudioSettings['workingHours'],
    defaultCancellationWindowHours: p.defaultCancellationWindowHours,
    defaultSessionDurationMinutes: p.defaultSessionDurationMinutes,
    lowCreditThreshold: p.lowCreditThreshold,
    discountCeilingPercent: p.discountCeilingPercent,
    qr: p.qr,
    notifications: p.notifications
      ? {
          dailyLimit: p.notifications.dailyLimit,
          quietFromHour: p.notifications.quietFromHour,
          quietToHour: p.notifications.quietToHour,
          // `in_app` is ALWAYS on. It is not a message — it is her record of what happened to her
          // account. She may say "not by e-mail"; she may not say "never tell me my class was
          // cancelled" (v1.25).
          enabledChannels: [
            'in_app' as const,
            ...(p.notifications.emailEnabled ? (['email'] as const) : []),
            ...(p.notifications.whatsappEnabled ? (['whatsapp'] as const) : []),
          ],
        }
      : null,
    // Preserve the stored occupancy config unless the caller explicitly sends one (the settings form
    // may save other sections without touching it). `undefined` = untouched; `null` = cleared.
    fitness: p.fitness === undefined ? current?.fitness ?? null : p.fitness,
    paymentSurcharge: p.paymentSurcharge === undefined ? current?.paymentSurcharge ?? null : p.paymentSurcharge,
  }

  const res = await observed('studio.settings_update', ctx, undefined, {}, () =>
    updateStudioSettings(deps(), ctx, next),
  )

  revalidatePath('/settings')
  revalidatePath('/schedule')
  return res
}
