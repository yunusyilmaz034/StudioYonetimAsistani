'use server'

import {
  available,
  debtByMember,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  systemClock,
} from '@studio/core'

import { foldTr } from '@/lib/fold-tr'
import { badgesFor, STATE_LABEL, type MemberFacts } from '@/lib/members/filters'
import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// The command palette's member lookup (Plus Phase 2 §1). One light pass over the roster, filtered in
// memory — the same client-side-search shape the members screen uses (DEBT-001); at pilot scale it is
// cheaper than an index, and it repays to Typesense/Algolia with the members list at ~2,000 members.
//
// It returns what reception needs to ACT without opening the detail: the name, the phone, a one-line
// package summary (credits/period + days left), and the single most urgent status. No PII beyond what
// the members list already shows; read-only — every write still goes through its own trusted action.

const DAY = 86_400_000

export interface MemberHit {
  readonly id: string
  readonly fullName: string
  readonly phone: string
  readonly hasPhone: boolean
  /** "8 kredi · 12 gün" | "Sınırsız · 45 gün" | "Donmuş" | "—" */
  readonly packageLabel: string
  /** The one status worth surfacing, or null when nothing needs attention. */
  readonly warn: string | null
}

const digits = (s: string): string => s.replace(/\D/g, '')

function packageLabel(packages: MemberFacts['packages'], now: number): string {
  const live = packages.filter((p) => p.status === 'active' || p.status === 'frozen')
  // No live package: say nothing here. `warn` already reads "Duraklatılmış" for exactly this member,
  // and a row that says the same thing twice in two words is a row nobody finishes reading.
  if (live.length === 0) return '—'
  const active = live.filter((p) => p.status === 'active')
  if (active.length === 0) return 'Donmuş'
  // The one she will use next: the earliest-expiring active package (I-17's shape).
  const next = [...active].sort((a, b) => Number(a.validUntil) - Number(b.validUntil))[0]!
  const credit = next.creditsAvailable === null ? 'Sınırsız' : `${next.creditsAvailable} kredi`
  const days = Math.max(0, Math.ceil((Number(next.validUntil) - now) / DAY))
  return `${credit} · ${days} gün`
}

export async function searchMembersAction(query: string): Promise<MemberHit[]> {
  // `toLowerCase()` DEĞİL (owner, 2026-09-02). Türkçede `I`nin küçüğü `ı`dır; `toLowerCase()`
  // "KILIÇ"ı "kiliç" yapıyordu ve "kılıç" arayan hiçbir zaman bulamıyordu. `foldTr` aksanı da
  // düşürüyor: "gulnare" → "GÜLNARE".
  const q = foldTr(query.trim())
  if (q.length < 2) return []

  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'platform_admin'])
  const now = systemClock.now()
  const db = adminDb()

  // ÖNCE SÜZ, SONRA OKU (owner: *"bazen çok geç kalıyor"*).
  //
  // Eskiden her tuş vuruşunda stüdyodaki BÜTÜN abonelikler okunuyordu — yüzlerce belge, tek bir
  // ismi bulmak için. Oysa süzme yalnızca isim ve telefon istiyor; abonelik ve borç ancak
  // GÖSTERİLECEK sekiz satır için gerekiyor. Ağır okuma, sonucun büyüklüğüne bağlı olmalı, listenin
  // büyüklüğüne değil.
  const members = await new FirestoreMemberRepository(db).list(ctx)
  const qDigits = digits(q)
  const eslesen = members
    .filter((m) => {
      if (foldTr(m.fullName).includes(q)) return true
      return qDigits.length >= 3 && digits(m.phoneNormalized as string).includes(qDigits)
    })
    .slice(0, 8)
  if (eslesen.length === 0) return []

  const entRepo = new FirestoreEntitlementRepository(db)
  const [entitlementLists, debt] = await Promise.all([
    Promise.all(eslesen.map((m) => entRepo.listByMember(ctx, m.id))),
    debtByMember({ repo: new FirestoreFinanceRepository(db), clock: systemClock }, ctx),
  ])
  const entitlements = entitlementLists.flat()

  const byMember = new Map<string, MemberFacts['packages']>()
  for (const e of entitlements) {
    const list = (byMember.get(e.memberId as string) ?? []) as MemberFacts['packages'][number][]
    list.push({
      status: e.status,
      validUntil: e.validUntil,
      creditsAvailable: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
    })
    byMember.set(e.memberId as string, list)
  }

  return eslesen.map((m) => {
      const packages = byMember.get(m.id as string) ?? []
      const badges = badgesFor(
        { status: m.status, balanceDueKurus: debt.get(m.id as string)?.amount ?? 0, packages },
        now,
      )
      // Same order of precedence as the members list, so a member does not carry one word in search
      // and another in the list: money, then state, then what her package is doing.
      const warn = badges.inDebt
        ? 'Borçlu'
        : badges.state !== 'active'
          ? STATE_LABEL[badges.state]
          : badges.frozen
            ? 'Donmuş'
            : badges.expiring
              ? 'Bitiyor'
              : badges.lowCredits
                ? 'Kredi az'
                : null
      return {
        id: m.id as string,
        fullName: m.fullName,
        phone: m.phone as string,
        hasPhone: Boolean((m.phone as string)?.trim()),
        packageLabel: packageLabel(packages, now),
        warn,
      }
    })
}
