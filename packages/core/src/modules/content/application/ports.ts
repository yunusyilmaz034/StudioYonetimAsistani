import type { Clock, DomainError, NewEvent, Result, TenantContext } from '../../../shared'
import type { ContentPost } from '../domain/types'

export interface ContentRepository {
  getPost(ctx: TenantContext, id: string): Promise<ContentPost | null>
  listWeek(ctx: TenantContext, weekStart: string): Promise<readonly ContentPost[]>
  /** State and events in one write (#1). */
  savePosts(ctx: TenantContext, posts: readonly ContentPost[], events: readonly NewEvent[]): Promise<void>
  /** IG-2b */
  listByStatus(ctx: TenantContext, status: ContentPost['status']): Promise<readonly ContentPost[]>
  mutatePost(
    ctx: TenantContext,
    id: string,
    decide: (current: ContentPost) => Result<{ next: ContentPost; events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<ContentPost, DomainError>>
}

export interface ContentDeps {
  readonly repo: ContentRepository
  readonly clock: Clock
}
