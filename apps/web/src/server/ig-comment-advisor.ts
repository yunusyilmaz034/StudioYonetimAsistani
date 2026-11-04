import { FirestoreCommentRepository, type TenantContext } from '@studio/core'

import type { AdvisorItem } from './advisor-query'
import { adminDb } from './firebase-admin'

// IG-3 (owner, 2026-11-04) — Instagram comments waiting for an answer, on the dashboard's list.
// A COMPLAINT is urgent and named on its own line; other open comments are counted (one group line).
// The comment TEXT is not shown here (the AI narrator reads these lines); the username goes in
// `subject`, which the narrator tokenises out.
export async function igCommentAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const open = await new FirestoreCommentRepository(adminDb()).listByStatus(ctx, 'open', 200)
  const now = Date.now()
  const ago = (t: number) => {
    const m = Math.max(1, Math.round((now - t) / 60_000))
    return m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`
  }
  return open
    .filter((c) => c.category !== 'spam')
    .sort((a, b) => Number(b.category === 'complaint') - Number(a.category === 'complaint') || (a.commentedAt as number) - (b.commentedAt as number))
    .map((c) => {
      const complaint = c.category === 'complaint'
      return {
        id: `${complaint ? 'ig_complaint' : 'ig_comment'}__${c.id}`,
        kind: complaint ? ('ig_complaint' as const) : ('ig_comment' as const),
        severity: complaint ? ('urgent' as const) : ('attention' as const),
        subject: { id: c.id, name: `@${c.username}` },
        title: complaint ? `@${c.username} — olumsuz Instagram yorumu · cevap bekliyor` : `@${c.username} — Instagram yorumu cevap bekliyor`,
        detail: `${c.mediaLabel ? `Gönderi: “${c.mediaLabel}” · ` : ''}${ago(c.commentedAt as number)}${complaint ? ' · cevabı sahip verir' : ''}`,
        href: '/content?tab=comments',
        actionLabel: 'Yorumu aç',
      }
    })
}
