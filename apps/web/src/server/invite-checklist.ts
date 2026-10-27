import { FirestoreMemberRepository, loadExcludedMemberIds, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'
import type { AdvisorItem } from './advisor-query'

// DAVET GİTMEDİ — "uygulama davetini elle gönderin" (owner, 2026-10-27).
//
// Ülkü Hançer web sitesinden online üye oldu; ödeme işlendi, üye ve paket oluştu, davet ÜRETİLDİ ve WhatsApp'a
// verildi — Meta reddetti (`meta_404`: kod, Meta'da hiç oluşmamış bir şablon adına bakıyordu). Davet yalnızca
// uygulama-içi kutuya düştü; hesabı olmayan biri o kutuyu göremez. Kimse bilmedi: başarısızlık bir olay olarak
// kayıttaydı, ama hiçbir ekran onu okumuyordu.
//
// Şablon düzeltildi; bu liste onun yerine değil, YANINDA: Meta bir gün yine bir şablonu reddederse (onay geri
// alınır, kategori değişir, numara kısıtlanır) yeni üye yine sessizce davetsiz kalmasın. Satır, üye şifresini
// belirlediği an kendiliğinden kalkar — tik gerekmez, iş bitince iş biter.

export const INVITE_LOOKBACK_DAYS = 30

export interface FailedInvite {
  readonly memberId: string
  readonly failedAt: number
}

export interface InviteRow {
  readonly memberId: string
  readonly status: string // pending | consumed | expired | revoked
}

/**
 * Pure: which members to list. A member whose LATEST invite was consumed has an account — off the list.
 * A member re-invited by hand after the failure is still listed until she actually sets a password:
 * "the desk sent it" is not "she got in".
 */
export function undeliveredInvites(
  failures: readonly FailedInvite[],
  invites: readonly InviteRow[],
  excluded: ReadonlySet<string>,
  nowMs: number,
): readonly FailedInvite[] {
  const since = nowMs - INVITE_LOOKBACK_DAYS * 86_400_000
  const activated = new Set(invites.filter((i) => i.status === 'consumed').map((i) => i.memberId))
  const latest = new Map<string, FailedInvite>()
  for (const f of failures) {
    if (f.failedAt < since || !f.memberId || activated.has(f.memberId) || excluded.has(f.memberId)) continue
    const prev = latest.get(f.memberId)
    if (!prev || f.failedAt > prev.failedAt) latest.set(f.memberId, f)
  }
  return [...latest.values()].sort((a, b) => b.failedAt - a.failedAt)
}

export async function inviteAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const db = adminDb()
  // One equality filter, no ordering — no composite index (a production-only trap here, OR-14). The set
  // is every failed notification ever, which is small (dozens) and grows only when something breaks.
  const [failedSnap, invites, excluded] = await Promise.all([
    db.collection(`studios/${ctx.studioId}/events`).where('type', '==', 'notification.failed').get(),
    new FirestoreMemberRepository(db).listInvites(ctx),
    loadExcludedMemberIds(db, ctx.studioId),
  ])
  const failures: FailedInvite[] = failedSnap.docs
    .filter((d) => d.get('payload.templateId') === 'portal_invite' && d.get('payload.channel') === 'whatsapp')
    .map((d) => ({ memberId: String(d.get('related.memberId') ?? ''), failedAt: msOf(d.get('occurredAt')) }))

  const rows = undeliveredInvites(
    failures,
    invites.map((i) => ({ memberId: i.memberId as string, status: i.status })),
    excluded,
    Date.now(),
  )
  if (rows.length === 0) return []

  const docs = await db.getAll(...rows.map((r) => db.doc(`studios/${ctx.studioId}/members/${r.memberId}`)))
  const names = new Map(docs.filter((d) => d.exists).map((d) => [d.id, String(d.get('fullName') ?? '')]))

  return rows
    .filter((r) => names.has(r.memberId)) // erased since — nothing to do
    .map((r) => {
      const name = names.get(r.memberId) || 'Üye'
      return {
        id: `invite_undelivered:${r.memberId}`,
        kind: 'invite_undelivered' as const,
        severity: 'attention' as const,
        subject: { id: r.memberId, name },
        title: `${name} — uygulama daveti WhatsApp'tan gitmedi`,
        detail:
          'Üye henüz uygulamaya giremiyor. Üyeyi açın → Genel → "Davet bağlantısı oluştur" → Kopyala → stüdyo ' +
          'WhatsApp\'ından gönderin. Üye şifresini belirleyince bu satır kendiliğinden kalkar.',
        href: `/members/${r.memberId}?tab=profile`,
        actionLabel: 'Üyeyi aç',
      }
    })
}

function msOf(v: unknown): number {
  if (typeof v === 'number') return v
  const t = v as { toMillis?: () => number } | null
  return typeof t?.toMillis === 'function' ? t.toMillis() : 0
}
