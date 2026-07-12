import type { ClassSessionId, Clock, MemberId, NewEvent, TenantContext } from '../../../shared'
import type { WaitlistEntry } from '../domain/types'

export interface WaitlistRepository {
  getEntry(ctx: TenantContext, id: string): Promise<WaitlistEntry | null>
  // The queue for one class, FIFO. Any status — the screen shows who was promoted, too.
  listBySession(ctx: TenantContext, sessionId: ClassSessionId): Promise<readonly WaitlistEntry[]>
  listByMember(ctx: TenantContext, memberId: MemberId): Promise<readonly WaitlistEntry[]>
  // The dashboard's waiting-list widget: everyone still waiting, studio-wide, FIFO.
  listWaiting(ctx: TenantContext): Promise<readonly WaitlistEntry[]>
  save(ctx: TenantContext, entry: WaitlistEntry, events: readonly NewEvent[]): Promise<void>
}

export interface WaitlistDeps {
  readonly repo: WaitlistRepository
  readonly clock: Clock
}
