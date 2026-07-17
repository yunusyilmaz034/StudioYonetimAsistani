import { DEFAULT_INSIGHT_CONFIG, deriveInsights, type Insight, type InsightFacts, type InsightSeverity, type InsightKind } from '@studio/core'
import type { TenantContext } from '@studio/core'

import { formatKurus } from '@/lib/payroll-labels'

import { loadOwnerDashboard } from './owner-dashboard'

// AI Insights L1 — the advisor's read. It maps the owner dashboard (a single bounded read; NO new
// heavy queries) into the PII-free `InsightFacts` the pure `deriveInsights` consumes, then resolves
// each ranked insight back into a display item with a name and a deep link to an EXISTING tool. The
// advisor suggests; it never acts.

export interface AdvisorItem {
  readonly id: string
  readonly kind: InsightKind
  readonly severity: InsightSeverity
  readonly title: string
  readonly detail: string
  readonly href: string
  readonly actionLabel: string
}

function present(insight: Insight, memberName: Map<string, string>, sessionName: Map<string, string>): AdvisorItem {
  const m = insight.metrics
  const memberId = insight.refs.memberId
  const name = (memberId && memberName.get(memberId)) || (insight.refs.sessionId && sessionName.get(insight.refs.sessionId)) || 'Bilinmeyen'
  const memberHref = memberId ? `/members/${memberId}` : '/members'

  switch (insight.kind) {
    case 'outstanding_balance':
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        title: `${name} — ${formatKurus(m.dueKurus ?? 0)} açık bakiye`,
        detail: `${m.daysOpen ?? 0} gündür ödenmedi. Tahsilat için üyeyi açın.`,
        href: memberHref,
        actionLabel: 'Tahsilat / üyeyi aç',
      }
    case 'expiring_soon': {
      const d = m.daysLeft ?? 0
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        title: `${name} — paketi ${d <= 0 ? 'bugün doluyor' : `${d} gün sonra doluyor`}`,
        detail: 'Yenileme için üyeyle iletişime geçin.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
    case 'low_credit':
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        title: `${name} — ${m.remaining ?? 0} ders hakkı kaldı`,
        detail: 'Yenileme fırsatı — üyeye yeni paket önerin.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    case 'empty_session':
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        title: `${name} — ${Math.round(m.hoursAway ?? 0)} saat sonra, rezervasyon yok`,
        detail: `Kapasite ${m.capacity ?? 0}. Bekleme listesi veya davetle doldurmayı deneyin.`,
        href: '/reservations',
        actionLabel: 'Dersi doldur',
      }
    case 'dormant_member': {
      const days = Math.round(m.daysSinceActivity ?? 0)
      return {
        id: insight.id,
        kind: insight.kind,
        severity: insight.severity,
        title: `${name} — ${days} gündür gelmiyor`,
        detail: 'Aktif paketi var ama uzaklaşıyor. Bir arayıp hatırını sorun — geç olmadan.',
        href: memberHref,
        actionLabel: 'Üyeyi aç',
      }
    }
  }
}

export async function loadAdvisor(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  const dash = await loadOwnerDashboard(ctx, Date.now())

  // Names are resolved HERE, never in the domain (the insight is PII-free). The dashboard rows carry
  // them, so no extra read is needed.
  const memberName = new Map<string, string>()
  const sessionName = new Map<string, string>()
  for (const r of dash.expiringSoon) memberName.set(r.id, r.name)
  for (const r of dash.lowCredit) memberName.set(r.id, r.name)
  for (const r of dash.pendingPayments) memberName.set(r.id, r.name)
  for (const r of dash.dormant) memberName.set(r.id, r.name)
  for (const s of dash.emptySessions) sessionName.set(s.sessionId, s.serviceName)

  const facts: InsightFacts = {
    expiring: dash.expiringSoon.map((r) => ({ memberId: r.id, entitlementId: r.entitlementId, daysLeft: r.daysLeft })),
    lowCredit: dash.lowCredit.map((r) => ({ memberId: r.id, entitlementId: r.entitlementId, remaining: r.remaining })),
    balances: dash.pendingPayments.map((r) => ({ memberId: r.id, saleId: r.saleId, dueKurus: r.dueKurus, daysOpen: r.daysOpen })),
    // The dashboard's emptySessions list is already filtered to bookedCount === 0 (owner-dashboard),
    // so booked is 0 by construction.
    emptySessions: dash.emptySessions.map((s) => ({ sessionId: s.sessionId, capacity: s.capacity, booked: 0, hoursAway: s.hoursAway })),
    // Already filtered to daysSinceActivity >= the attention threshold by the dashboard.
    dormant: dash.dormant.map((r) => ({ memberId: r.id, daysSinceActivity: r.daysSinceActivity })),
  }

  // deriveInsights returns the ranked order (urgent → attention → info); preserve it.
  return deriveInsights(facts, DEFAULT_INSIGHT_CONFIG).map((i) => present(i, memberName, sessionName))
}
