// The identity module's only public door (AD-29). Read-only in Phase 1: a staff /
// trainer list for the scheduling pickers. Staff creation with events is a later
// milestone; nothing here mutates state.
export type { StaffMember, StaffShift } from './domain/types'
export type { IdentityDeps, IdentityRepository, StaffShiftDeps, StaffShiftRepository } from './application/ports'
export { FirestoreIdentityRepository, FirestoreStaffShiftRepository } from './infrastructure/repos'
export {
  changeStaffRole,
  createStaff,
  deactivateStaff,
  reactivateStaff,
} from './application/staff'
export { endShift, startShift } from './application/shift'
// Turnikeden mesai (owner, 2026-09-13 · OR-74): ilk geçiş açar, gece işi son geçişe kapatır.
export { closeShiftsAtLastCrossing, commitStaffCrossing, prepareStaffCrossing } from './application/staff-crossing'
export type { StaffCrossingDecision, StaffCrossingInput } from './domain/decide'
export {
  decideChangeRole,
  decideCloseShiftAtLastCrossing,
  decideCreateStaff,
  decideDeactivateStaff,
  decideEndShift,
  decideReactivateStaff,
  decideStaffCrossing,
  decideStartShift,
} from './domain/decide'
export * from './events'

// ── İzin / yokluk (owner onayı, 2026-09-11). Eklenen şey izin BAKİYESİ değil YOKLUKTUR: takvimde
//    hangi derslerin sahipsiz kalacağını söyleyen kayıt. Gerekçesi `events.ts`te. ──
export { requestStaffLeave, decideStaffLeave, cancelStaffLeave } from './application/leave'
export type { StaffLeaveDeps, StaffLeaveRepository } from './application/ports'
export type { StaffLeave } from './domain/types'
export { FirestoreStaffLeaveRepository } from './infrastructure/repos'

// ── Haftalık vardiya planı (owner, 2026-09-14 · OR-77). Resepsiyon taslak → owner onay → yayın;
//    personel yayındakini görür. Plan niyettir, turnike gözlemdir — ikisi yan yana karşılaştırılır. ──
export {
  approveWeekPlan,
  loadWeekPlans,
  returnWeekPlan,
  saveWeekPlanDraft,
  submitWeekPlan,
} from './application/week-plan'
export {
  decideApproveWeekPlan,
  decideReturnWeekPlan,
  decideSaveWeekPlanDraft,
  decideSubmitWeekPlan,
  leaveDaysInWeek,
  mondayOf,
  planVsActual,
  weekDates,
} from './domain/week-plan'
export type { StaffWeekPlanDeps, StaffWeekPlanRepository } from './application/ports'
export type { ShiftBlock, StaffWeekPlan, WeekPlanEntries, WeekPlanStatus } from './domain/types'
export { FirestoreStaffWeekPlanRepository } from './infrastructure/repos'

// ── İzne rapor dosyası (owner, 2026-09-14 · OR-77, karar 4). Sağlık verisi: yalnızca izin sahibi ve owner
//    görür; olayda yol yok. ──
export { addLeaveDocument, listLeaveDocuments, removeLeaveDocument } from './application/leave'
export {
  LEAVE_DOCUMENT_MAX_PAGES,
  canSeeLeaveDocuments,
  decideAddLeaveDocument,
  decideRemoveLeaveDocument,
} from './domain/leave-document'
export type { StaffLeaveDocument } from './domain/types'

// Vardiya planında görünmek (owner, 2026-09-14 · OR-77): kimin planlanacağı bir rol değil, owner'ın kararı.
export { setShiftPlanMembership } from './application/staff'
export { decideSetShiftPlanMembership } from './domain/decide'

// ── Çalışma süresi, ara dinlenmesi ve A/B hafta döngüsü (owner, 2026-10-06/07) ──────────────
//    SAF ve SAYISIZ: limitler `WorkingTimeLimits` olarak dışarıdan geçer (#4). Şablon ÜRETİR,
//    onaylanmış haftalık plan KARAR VERİR.
export {
  compareDay,
  dayTotals,
  minimumBreakMinutes,
  netWorkMinutes,
  validatePlannedWeek,
  type BreakTier,
  type DayComparison,
  type DayTotals,
  type PlannedDay,
  type WeekTotals,
  type WorkingTimeLimits,
} from './domain/working-time'
export {
  templateWeekDays,
  weekParityAt,
  type IsoWeekday,
  type ShiftTemplate,
  type TemplateWeek,
  type WeekParity,
} from './domain/shift-template'
export { dakika, gecerliSaat } from './domain/time-of-day'

// ── Ara dinlenmesi ve haftalık çizelge (owner, 2026-10-06/07) ───────────────────────────────
export type { BreakSource } from './events'
export type { EmploymentType, StaffBreak, TimesheetDay, WeeklyTimesheet } from './domain/types'
export {
  decideCloseBreakWithShift,
  decideCorrectBreak,
  decideEndBreak,
  decideEnterBreakRetroactively,
  decideStartBreak,
  type RetroBreakInput,
  type RetroEntryWindow,
  type StartBreakInput,
} from './domain/break'
export {
  buildTimesheetSnapshot,
  decideGenerateTimesheet,
  decideSignTimesheet,
  sameTimesheetContent,
  type TimesheetSnapshot,
} from './domain/timesheet'
export {
  closeOpenBreakWithShift,
  correctBreak,
  endBreak,
  enterBreakRetroactively,
  retroEntryWindow,
  startBreak,
} from './application/break'
export { generateTimesheet, signTimesheet } from './application/timesheet'
export type {
  StaffBreakDeps,
  StaffBreakRepository,
  StaffTimesheetDeps,
  StaffTimesheetRepository,
} from './application/ports'
export { FirestoreStaffBreakRepository, FirestoreStaffTimesheetRepository } from './infrastructure/repos'

