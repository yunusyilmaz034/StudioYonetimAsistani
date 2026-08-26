import type { BranchId, Clock, Instant, MemberId, NewEvent, TenantContext, DeviceId} from '../../../shared'
import type { BranchOccupancy, CheckIn, Presence, TurnstileCode, TurnstileDevice} from '../domain/types'
import type { Entitlement } from '../../entitlements'

// Admin SDK only (AD-15). The check-in state lives in three shapes: the append-style
// `/checkIns` log, the `/presence/{memberId}` toggle docs (existence ⇔ inside), and
// the branch occupancy window.
export interface CheckinRepository {
  getBranch(ctx: TenantContext, branchId: BranchId): Promise<BranchOccupancy | null>
  saveBranch(ctx: TenantContext, branch: BranchOccupancy, events: readonly NewEvent[]): Promise<void>

  getPresence(ctx: TenantContext, memberId: MemberId): Promise<Presence | null>
  countPresence(ctx: TenantContext, branchId: BranchId): Promise<number>
  listPresence(ctx: TenantContext, branchId: BranchId): Promise<readonly Presence[]>
  listStalePresence(ctx: TenantContext, checkedInBefore: Instant): Promise<readonly Presence[]>
  // Dashboard (v1.16): the branch's check-ins since a day boundary (the log read).
  listCheckInsForDay(ctx: TenantContext, branchId: BranchId, since: Instant): Promise<readonly CheckIn[]>
  // Member Workspace (v1.18): one member's check-in history since a bound, newest first.
  listCheckInsByMember(ctx: TenantContext, memberId: MemberId, since: Instant): Promise<readonly CheckIn[]>

  // One transaction: write the CheckIn record, set-or-delete the presence doc, append
  // the events (non-negotiable #1).
  applyCheckIn(
    ctx: TenantContext,
    memberId: MemberId,
    checkIn: CheckIn,
    presenceNext: Presence | null,
    events: readonly NewEvent[],
  ): Promise<void>

  // ── Turnstile (v1.33) ──
  getDevice(ctx: TenantContext, deviceId: DeviceId): Promise<TurnstileDevice | null>
  listDevices(ctx: TenantContext): Promise<readonly TurnstileDevice[]>
  saveDevice(ctx: TenantContext, device: TurnstileDevice): Promise<void>
  getTurnstileCode(ctx: TenantContext, code: string): Promise<TurnstileCode | null>
  saveTurnstileCode(ctx: TenantContext, code: TurnstileCode): Promise<void>
  /**
   * Spend the code, and REFUSE if somebody already did.
   *
   * A transaction rather than a read-then-write, because the whole point of single use is the race:
   * two phones scanning the same screen in the same second must not both succeed. Returns false when
   * it was already spent — the caller turns that into "kod kullanılmış", never into an open door.
   */
  consumeTurnstileCode(ctx: TenantContext, code: string, memberId: MemberId, at: Instant): Promise<boolean>
  /**
   * Touch the device AND append its events in one write.
   *
   * A separate method rather than reusing `saveBranch`: that one writes a whole `BranchOccupancy`,
   * and passing it a half-built object to smuggle an event through would overwrite the branch's real
   * state with a stub. State and its events still commit together (#1) — just the right state.
   */
  saveDeviceWithEvents(ctx: TenantContext, device: TurnstileDevice, events: readonly NewEvent[]): Promise<void>

  // Auto-check-out: delete the presence doc + append the event.
  applyAutoCheckOut(ctx: TenantContext, memberId: MemberId, events: readonly NewEvent[]): Promise<void>
}

/**
 * The fitness serbest-giriş meter, reached from the door.
 *
 * ZORUNLU, bilerek. Giriş tüketimi 2026-08-26'ya kadar `qr.ts` içinde üç kez KOPYALANMIŞTI ve
 * diğer iki kapı (elle check-in, turnike) onu hiç çağırmıyordu: üye geliyor, sayaç hiç hareket
 * etmiyordu. Alanı opsiyonel yapmak aynı hatayı sessizce mümkün kılardı — zorunlu olunca derleyici
 * her kapıyı tek tek buluyor.
 */
export interface EntryMeterRepository {
  listActiveByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly Entitlement[]>
  saveEntitlement(ctx: TenantContext, ent: Entitlement, events: readonly NewEvent[]): Promise<void>
}

/**
 * DERSE Mİ GELDİ, SPORA MI? (owner kararı, 2026-08-26)
 *
 * Owner'ın cümlesi: *"pilates rezervasyonu varsa kişi pilatese katılmıştır diye görmeliyiz, onun
 * dışında geldikleri olursa fitness."*
 *
 * Hibrit paketli bir üye (2 fitness girişi + 1 pilates dersi) kapıdan geçtiğinde sistem bugüne
 * kadar tek bir soru soruyordu: "limitli fitness üyeliği var mı?" Varsa giriş düşüyordu — dersine
 * gelmiş olsa bile. Yani rezervasyonlu dersine 10 dakika önce gelen üye, hem ders kredisini hem de
 * spor salonu giriş hakkını kaybediyordu.
 *
 * Bu port o soruyu ikiye ayırıyor. Sayaç yalnızca ziyaretin bir DERSE bağlanamadığı durumda işler.
 */
export interface ClassVisitLookup {
  /**
   * Üyenin, `at` anına denk gelen iptal edilmemiş bir ders rezervasyonu var mı?
   *
   * "Denk gelmek" = dersin başlangıcından `earlyArrivalMs` kadar önce başlayıp dersin bitişinde
   * biten pencere. Erken gelme payı gerekli: kimse dersin başladığı saniyede turnikeden geçmiyor.
   */
  hasClassAround(
    ctx: TenantContext,
    memberId: MemberId,
    at: Instant,
    earlyArrivalMs: number,
  ): Promise<boolean>
}

export interface CheckinDeps {
  readonly repo: CheckinRepository
  readonly clock: Clock
  readonly entries: EntryMeterRepository
  /** ZORUNLU, `entries` ile aynı sebeple: opsiyonel olsaydı bir kapı sessizce eski davranışta kalırdı. */
  readonly classes: ClassVisitLookup
}
