'use server'

import { FirestoreMemberRepository } from '@studio/core'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// The command palette's member lookup (Plus Phase 2 — Operations Workspace, Doc 32 §2). A single
// light read of the roster, filtered in memory: at pilot scale (< a few hundred members) this is
// cheaper and simpler than a search index, and it inherits the same client-side-search shape the
// members screen already uses (DEBT-001). When the roster crosses ~2,000, this and the members list
// repay together to Typesense/Algolia — the debt names them as one.
//
// It returns the LEAST a result row needs — id, name, phone — and no ledger, no badges, no PII beyond
// what reception already sees on the list. Read-only; every write still goes through its own action.

export interface MemberHit {
  readonly id: string
  readonly fullName: string
  readonly phone: string
}

const digits = (s: string): string => s.replace(/\D/g, '')

export async function searchMembersAction(query: string): Promise<MemberHit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'platform_admin'])
  const members = await new FirestoreMemberRepository(adminDb()).list(ctx)

  const qDigits = digits(q)
  const hits = members.filter((m) => {
    const name = m.fullName.toLowerCase()
    if (name.includes(q)) return true
    // A phone search is on digits only, so "532" matches regardless of spaces or +90 formatting.
    return qDigits.length >= 3 && digits(m.phoneNormalized as string).includes(qDigits)
  })

  // Name matches first, then cap — the palette shows a short, fast list, never the whole roster.
  return hits
    .slice(0, 8)
    .map((m) => ({ id: m.id as string, fullName: m.fullName, phone: m.phone as string }))
}
