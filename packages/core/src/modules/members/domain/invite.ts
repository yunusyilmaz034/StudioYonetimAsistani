import { err, ok, type DomainError, type Instant, type MemberId, type Result, type StudioId } from '../../../shared'

// D1/D2/D17 (v1.21) — the portal invite.
//
// Reception never sets a member's password and never knows it. Reception creates the *member*;
// the system issues an *invite*; the member creates her own *account*.
//
// The token is a **bearer credential**: whoever holds the link can set the password on that
// account. Three consequences are baked into this type:
//
//   1. **We store only a HASH of it.** The raw token exists in the WhatsApp message and nowhere
//      else — not in the database, and (I-13) never in an event. A database dump therefore
//      yields no usable links.
//   2. **One active invite per member.** Issuing a new one SUPERSEDES the old, which stops
//      working immediately. "Resend" is a new invite, not a re-send of the old link — the safe
//      reading of the owner's rule, and the one that makes revocation possible.
//   3. **Single use, 72 hours.** Both are checked server-side, on the clock the domain is given.
export const INVITE_TTL_HOURS = 72

export type InviteStatus = 'pending' | 'consumed' | 'superseded'

export interface MemberInvite {
  readonly tokenHash: string // sha-256 of the raw token; the raw token is never stored
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly status: InviteStatus
  readonly issuedAt: Instant
  readonly expiresAt: Instant
  readonly consumedAt: Instant | null
}

// Can this invite be used, right now? The failure modes are deliberately collapsed into ONE
// error at the boundary (see `invite_invalid` in the web layer): an attacker probing links must
// not learn whether a token was wrong, expired, already used, or belongs to a real member.
export function checkInviteUsable(
  invite: MemberInvite | null,
  now: Instant,
): Result<MemberInvite, DomainError> {
  if (!invite) return err({ code: 'invite_invalid' })
  if (invite.status !== 'pending') return err({ code: 'invite_invalid' })
  if (now > invite.expiresAt) return err({ code: 'invite_invalid' })
  return ok(invite)
}
