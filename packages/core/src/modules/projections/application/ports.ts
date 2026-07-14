import type { TenantContext } from '../../../shared'
import type { DailyIncrement, DailyReadModel } from '../domain/daily'

export interface ProjectionRepository {
  getDaily(ctx: TenantContext, date: string): Promise<DailyReadModel | null>
  listDaily(ctx: TenantContext, from: string, to: string): Promise<readonly DailyReadModel[]>
  // Applies ONE event's increment, at most once. The idempotency marker and the counter move in the
  // SAME transaction — the trigger is at-least-once, and a double-counted booking is a silently
  // wrong dashboard, which is worse than a broken one.
  applyOnce(
    ctx: TenantContext,
    eventId: string,
    recordedAt: number, // LOG time — the clock `projection_lag` reads. Never domain time.
    inc: DailyIncrement,
  ): Promise<boolean> // false ⇒ already applied
  // Rebuild: wipe the read model so the log can be replayed into it. Projections are DISPOSABLE —
  // this is the whole point of the design, and it is why it is safe to have one at all.
  clearAll(ctx: TenantContext): Promise<void>
}
