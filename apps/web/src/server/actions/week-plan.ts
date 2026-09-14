'use server'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreIdentityRepository,
  FirestoreStaffLeaveRepository,
  FirestoreStaffWeekPlanRepository,
  approveWeekPlan,
  instant,
  instantFromLocalDate,
  leaveDaysInWeek,
  loadWeekPlans,
  localDateAt,
  mondayOf,
  returnWeekPlan,
  saveWeekPlanDraft,
  submitWeekPlan,
  systemClock,
  weekDates,
  type LeaveKind,
  type WeekPlanEntries,
  type WeekPlanStatus,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────
//
// Resepsiyon taslağı hazırlar ve onaya gönderir, owner onaylar ya da sebep yazıp geri gönderir.
// Kurallar çekirdekte (`identity/domain/week-plan.ts`); burası yalnızca kimliği doğrular, girdiyi
// biçimler ve karar fonksiyonunu çağırır. Rol kapısı İKİ katlı: burada kim kapıyı çalabilir, karar
// fonksiyonunda kim girebilir (`week_plan_editor_required` / `week_plan_approver_required`).

const DUZENLEYEN = ['owner', 'receptionist', 'platform_admin'] as const
const ONAYLAYAN = ['owner', 'platform_admin'] as const
const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const GUN = 86_400_000

const deps = () => ({ repo: new FirestoreStaffWeekPlanRepository(adminDb()), clock: systemClock, utcOffsetMinutes: OFF })

const TARIH = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ENTRIES = z.record(
  z.string().min(1).max(128),
  z.record(TARIH, z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })),
)

export interface WeekPlanStaff {
  readonly id: string
  readonly displayName: string
  readonly role: string
}

export interface WeekPlanEditorView {
  readonly weekStart: string
  readonly dates: readonly string[]
  readonly today: string
  /** `null` ⇔ bu hafta için hiç kayıt yok. */
  readonly status: WeekPlanStatus | null
  readonly draft: WeekPlanEntries
  readonly published: WeekPlanEntries | null
  readonly version: number
  readonly returnReason: string
  readonly staff: readonly WeekPlanStaff[]
  /** Onaylı izinli günler: personel → gün → tür. Hücrede uyarı olarak görünür, reddetmez. */
  readonly leaveDays: Readonly<Record<string, Readonly<Record<string, LeaveKind>>>>
  readonly canApprove: boolean
}

/** Plan tablosunun okuması: plan belgesi, planlanacak personel ve o haftanın onaylı izinleri. */
export async function loadWeekPlanEditorAction(input: unknown): Promise<WeekPlanEditorView> {
  const p = z.object({ weekStart: TARIH }).parse(input)
  const ctx = await requireTenantContext(DUZENLEYEN)
  const weekStart = mondayOf(p.weekStart)
  const db = adminDb()
  const bas = instantFromLocalDate(weekStart, OFF) as number
  const [planlar, personel, izinler] = await Promise.all([
    loadWeekPlans(deps(), ctx, [weekStart]),
    new FirestoreIdentityRepository(db).listStaff(ctx),
    new FirestoreStaffLeaveRepository(db).listLeavesOverlapping(ctx, bas, bas + 7 * GUN - 1),
  ])
  const plan = planlar[0] ?? null

  // PLANLANAN: aktif resepsiyon ve eğitmenler. Owner ve kiosk hesabı listede yok — owner kendi
  // mesaisini planlatmıyor, kiosk bir tablet. Ama planda KAYDI olan biri (sonradan pasife alınmış)
  // yine görünür: yayındaki bir satır sessizce kaybolmasın.
  const plandaki = new Set([...Object.keys(plan?.draft ?? {}), ...Object.keys(plan?.published ?? {})])
  const staff = personel
    .filter((s) => (s.active && (s.role === 'receptionist' || s.role === 'trainer')) || plandaki.has(String(s.id)))
    .map((s) => ({ id: String(s.id), displayName: s.displayName, role: s.role }))
    .sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'tr') : a.role === 'receptionist' ? -1 : 1))

  return {
    weekStart,
    dates: weekDates(weekStart),
    today: localDateAt(instant(Date.now()), OFF),
    status: plan?.status ?? null,
    draft: plan?.draft ?? {},
    published: plan?.published ?? null,
    version: plan?.version ?? 0,
    returnReason: plan?.returnReason ?? '',
    staff,
    leaveDays: leaveDaysInWeek(weekStart, izinler, OFF),
    canApprove: ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin',
  }
}

export async function saveWeekPlanDraftAction(input: unknown) {
  const p = z.object({ weekStart: TARIH, entries: ENTRIES }).parse(input)
  const ctx = await requireTenantContext(DUZENLEYEN)
  const r = await saveWeekPlanDraft(deps(), ctx, { weekStart: p.weekStart, entries: p.entries })
  return r.ok ? { ok: true as const } : r
}

export async function submitWeekPlanAction(input: unknown) {
  const p = z.object({ weekStart: TARIH }).parse(input)
  const ctx = await requireTenantContext(DUZENLEYEN)
  const r = await submitWeekPlan(deps(), ctx, p.weekStart)
  return r.ok ? { ok: true as const } : r
}

export async function approveWeekPlanAction(input: unknown) {
  const p = z.object({ weekStart: TARIH }).parse(input)
  const ctx = await requireTenantContext(ONAYLAYAN)
  const r = await approveWeekPlan(deps(), ctx, p.weekStart)
  return r.ok ? { ok: true as const } : r
}

export async function returnWeekPlanAction(input: unknown) {
  const p = z.object({ weekStart: TARIH, reason: z.string().trim().min(1).max(300) }).parse(input)
  const ctx = await requireTenantContext(ONAYLAYAN)
  const r = await returnWeekPlan(deps(), ctx, p.weekStart, p.reason)
  return r.ok ? { ok: true as const } : r
}
