import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type { ContentPost } from '../domain/types'

export interface ContentRepository {
  getPost(ctx: TenantContext, id: string): Promise<ContentPost | null>
  listWeek(ctx: TenantContext, weekStart: string): Promise<readonly ContentPost[]>
  /** State and events in one write (#1). */
  savePosts(ctx: TenantContext, posts: readonly ContentPost[], events: readonly NewEvent[]): Promise<void>
}

export interface ContentDeps {
  readonly repo: ContentRepository
  readonly clock: Clock
}
