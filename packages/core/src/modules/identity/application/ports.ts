import type { Clock, DomainError, NewEvent, Result, StaffUserId, TenantContext } from '../../../shared'
import type { StaffLeave, StaffLeaveDocument, StaffMember, StaffShift, StaffWeekPlan } from '../domain/types'

// Admin SDK only (AD-15). Staff are written by the owner, from the product — and, exactly once per
// studio, by a break-glass bootstrap script, because somebody has to be able to log in first.
export interface IdentityRepository {
  listStaff(ctx: TenantContext): Promise<readonly StaffMember[]>
  getStaff(ctx: TenantContext, id: StaffUserId): Promise<StaffMember | null>

  /** The staff document and its event commit TOGETHER (#1). If they could drift, the audit is
   *  decorative — and the audit is the only reason these are events at all. */
  saveStaff(ctx: TenantContext, staff: StaffMember, events: readonly NewEvent[]): Promise<void>
}

export interface IdentityDeps {
  readonly repo: IdentityRepository
  readonly clock: Clock
}

export interface StaffShiftDeps {
  readonly repo: StaffShiftRepository
  readonly clock: Clock
}

// ── MESAİ (owner, 2026-09-01) ───────────────────────────────────────────────────────────────
export interface StaffShiftRepository {
  /** Bu kişinin AÇIK vardiyası — yoksa null. Kararın tek girdisi bu. */
  getOpenShift(ctx: TenantContext, staffUserId: StaffUserId): Promise<StaffShift | null>
  /** Bir aralıktaki vardiyalar, en yenisi başta. Ekranın "kim kaçta girdi çıktı"sı. */
  listShifts(ctx: TenantContext, fromAt: number, toAt: number): Promise<readonly StaffShift[]>
  /** Belge ve olay(lar), TEK işlemde (#1). */
  saveShift(ctx: TenantContext, shift: StaffShift, events: readonly NewEvent[]): Promise<void>
  /** Birden çok vardiya ve olayları TEK işlemde — dünden kalanı kapatıp bugününü açan geçiş için. */
  saveShifts(ctx: TenantContext, shifts: readonly StaffShift[], events: readonly NewEvent[]): Promise<void>
  /** Stüdyodaki bütün açık vardiyalar. Gece işinin girdisi. */
  listOpenShifts(ctx: TenantContext): Promise<readonly StaffShift[]>
}

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
export interface StaffLeaveRepository {
  getLeave(ctx: TenantContext, id: string): Promise<StaffLeave | null>
  /**
   * Bir kişinin BEKLEYEN ve ONAYLI izinleri. Çakışma kontrolünün tek girdisi bu — ve reddedilmiş
   * ya da geri çekilmiş kayıtlar bilerek dışarıda: o günler gerçekten boş.
   */
  listLiveLeavesOf(ctx: TenantContext, staffUserId: StaffUserId): Promise<readonly StaffLeave[]>
  /** Bir aralığa DEĞEN bütün canlı izinler — takvimin "o gün kim yok" sorusu. */
  listLeavesOverlapping(ctx: TenantContext, fromAt: number, toAt: number): Promise<readonly StaffLeave[]>
  /** Karar bekleyenler; owner panelinin listesi. */
  listPendingLeaves(ctx: TenantContext): Promise<readonly StaffLeave[]>
  saveLeave(ctx: TenantContext, leave: StaffLeave, events: readonly NewEvent[]): Promise<void>

  // İzne rapor dosyası (OR-77, karar 4) — iznin altında, istemcinin okuyamadığı bir alt koleksiyon.
  listLeaveDocuments(ctx: TenantContext, leaveId: string): Promise<readonly StaffLeaveDocument[]>
  getLeaveDocument(ctx: TenantContext, leaveId: string, documentId: string): Promise<StaffLeaveDocument | null>
  /** Kayıt ve olay TEK işlemde (#1). */
  saveLeaveDocument(ctx: TenantContext, document: StaffLeaveDocument, events: readonly NewEvent[]): Promise<void>
  /** Kayıt silinir, olay (sebebiyle) kalır — düzeltme, sessiz silme değil (#9). */
  deleteLeaveDocument(ctx: TenantContext, leaveId: string, documentId: string, events: readonly NewEvent[]): Promise<void>
}

export interface StaffLeaveDeps {
  readonly repo: StaffLeaveRepository
  readonly clock: Clock
  /**
   * O aralıkta bu eğitmene atanmış ders sayısı. AYRI BİR PORT: izin modülü takvimi tanımıyor ve
   * tanımamalı — ama onaylayanın kaç dersin sahipsiz kalacağını görmesi, bu özelliğin tek gerçek
   * sebebidir. Bağımlılık değil, soru.
   */
  readonly affectedSessions: (ctx: TenantContext, staffUserId: StaffUserId, fromAt: number, toAt: number) => Promise<number>
}

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────
export interface StaffWeekPlanRepository {
  getWeekPlan(ctx: TenantContext, weekStart: string): Promise<StaffWeekPlan | null>
  /** Birkaç hafta birden (bu hafta + önümüzdeki hafta). Olmayan hafta listede yoktur. */
  getWeekPlans(ctx: TenantContext, weekStarts: readonly string[]): Promise<readonly StaffWeekPlan[]>
  /**
   * Oku → karar ver → yaz, TEK işlemde. Resepsiyon kaydederken owner onaylıyorsa biri ötekinin
   * üzerine yazmasın: onaylanan plan, onay anında okunan plandır. Olay yoksa hiçbir şey yazılmaz.
   */
  updateWeekPlan(
    ctx: TenantContext,
    weekStart: string,
    decide: (current: StaffWeekPlan | null) => Result<{ readonly next: StaffWeekPlan; readonly events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<StaffWeekPlan, DomainError>>
}

export interface StaffWeekPlanDeps {
  readonly repo: StaffWeekPlanRepository
  readonly clock: Clock
  /** "Bu hafta geçti mi" sorusundaki GÜN stüdyonun yerel günüdür. */
  readonly utcOffsetMinutes: number
}
