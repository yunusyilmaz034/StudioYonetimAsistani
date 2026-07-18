'use client'

import Link from 'next/link'
import { ActivityIcon, AlertTriangleIcon, BarChart3Icon, CalendarIcon, ChevronRightIcon, ClipboardCheckIcon, DoorOpenIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { canSee } from '@/lib/permissions'
import type { PrincipalRole } from '@studio/core'
import { Section } from '@/components/ui/section'
import { ActivityRow } from '@/components/activity/activity-row'
import { WIDGETS, WIDGET_ICON } from '@/lib/widgets/registry'
import type { OwnerDashboard } from '@/server/owner-dashboard'
import type { TodayOps } from '@/server/today-ops'

import { ChurnPulse } from './churn-pulse'
import { LogoutButton } from './logout-button'

// The dashboard renders the REGISTRY. It does not know what a widget contains — which is what makes
// a widget addable, reorderable, and (v1.30) readable by the AI Studio Manager through the same
// `present()` the human reads here.
//
// "Normal is quiet, abnormal is loud" (Doc 20): a widget whose `present().needsAttention` is true
// is pulled to the top and outlined. Everything else recedes.

export function DashboardScreen({
  data,
  todayOps,
  role,
  roleLabel,
}: {
  data: OwnerDashboard
  todayOps: TodayOps
  role: PrincipalRole
  roleLabel: string
}) {
  // A widget's drill-down lives under `/insights/…`, which is gated as `/analytics` (it exports the
  // studio's data to CSV, and bulk export is the owner's alone). Everything else a widget links to is
  // an ordinary operational screen.
  const canOpen = (href: string): boolean =>
    href.startsWith('/insights') ? canSee(role, '/analytics') : true

  const presented = WIDGETS.map((w) => ({ w, p: w.present(data) }))
  const attention = presented.filter((x) => x.p.needsAttention)
  const metrics = presented.filter((x) => x.w.kind === 'metric')
  const lists = presented.filter((x) => x.w.kind === 'list')

  return (
    <main className="mx-auto max-w-6xl space-y-7 p-4 pb-10 sm:p-6 lg:p-8">
      <PageHeader
        title="Genel Görünüm"
        description={roleLabel}
        actions={
          <>
            {/* Drawn only for the roles that may follow it. A link that bounces the person who clicks
                it back to where she started is a broken promise, and reception met it on her own
                dashboard (Alpha Review). */}
            {canSee(role, '/analytics') ? (
              <Button variant="outline" render={<Link href="/analytics" />}>
                <BarChart3Icon />
                <span className="hidden sm:inline">Analiz</span>
              </Button>
            ) : null}
            {/* The live feed used to sit OPEN at the bottom of the dashboard and made it look busy
                (owner, 2026-07-17). It moves here: a button that opens the last ten on hover, and
                whose click — and "Tümü" — go to the full page. */}
            {canSee(role, '/activity') ? <LiveFeedMenu feed={data.feed} /> : null}
            <LogoutButton />
          </>
        }
      />

      {/* "Bugün" — reception's one-glance operational summary. What is on today, what still needs
          marking, who is waiting, which rooms have a note. Every number read from live state. */}
      <TodayStrip ops={todayOps} />

      {/* The projector is the dashboard's only silent failure mode: a number that is simply late.
          A wrong number must be LOUD. */}
      {data.projectionLagsBehind ? (
        <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Günün sayıları gecikiyor — hareket akışı güncel, sayaçlar henüz değil.
        </p>
      ) : null}

      {/* What needs a decision TODAY. Nothing here is a number for its own sake. */}
      {attention.length > 0 ? (
        <Section title="Bugün ilgilenmen gerekenler">
          <ul className="space-y-1.5">
            {attention.map(({ w, p }) => {
              // Each item links to WHO/WHAT it is about (the widget's drill-down), so "1 üyenin kredisi
              // azaldı" is one click from the actual list of members (owner, PF-hotfix).
              const href = w.href(data)
              const openable = canOpen(href)
              const body = (
                <>
                  <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{p.headline}</span>
                    {p.detail ? <span className="text-muted-foreground"> {p.detail}</span> : null}
                  </span>
                  {openable ? <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
                </>
              )
              return (
                <li key={w.id}>
                  {openable ? (
                    <Link
                      href={href}
                      className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2 text-sm transition-colors hover:bg-warning/10"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2 text-sm">
                      {body}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      ) : null}

      {/* Phase 2 — the churn signal made visible: who has an active package but stopped coming. */}
      <ChurnPulse distribution={data.activityDistribution} dormant={data.dormant} />

      <Section title="Bugün">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map(({ w, p }) => {
            const Icon = WIDGET_ICON[w.id]
            return (
              <Link
                key={w.id}
                href={w.href(data)}
                title={p.headline}
                className={`block space-y-2 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/20 ${
                  p.needsAttention ? 'border-warning/40' : 'border-border'
                }`}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {Icon ? <Icon className="size-3.5" /> : null}
                  {w.title}
                </p>
                {w.render(data)}
              </Link>
            )
          })}
        </div>
      </Section>

      <Section title="İzlenecekler">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {lists.map(({ w, p }) => (
            <article
              key={w.id}
              className={`space-y-2 rounded-xl border bg-card p-3 shadow-sm ${
                p.needsAttention ? 'border-warning/40' : 'border-border'
              }`}
            >
              {/* The heading is the door: a list widget opens its own full, exportable list. The
                  rows below stay clickable in their own right (each goes to the member). */}
              {/* The drill-down (`/insights/…`) is gated as ANALYSIS and reception may not open it.
                  She still sees the widget and its rows — she simply is not offered a door that would
                  throw her back here. */}
              <div className="flex items-baseline justify-between gap-2">
                {canOpen(w.href(data)) ? (
                  <>
                    <Link
                      href={w.href(data)}
                      className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {w.title}
                    </Link>
                    <Link
                      href={w.href(data)}
                      className="shrink-0 text-xs text-muted-foreground hover:text-primary"
                    >
                      Tümü
                    </Link>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-foreground">{w.title}</span>
                )}
              </div>
              {w.render(data)}
            </article>
          ))}
        </div>
      </Section>

    </main>
  )
}

// The live feed, moved off the dashboard body into a hover menu next to "Analiz" (owner, 2026-07-17):
// the last ten movements open on hover, the button and "Tümü" both go to the full page. The gap
// between the trigger and the panel is padding INSIDE the hover group, so the mouse can cross it
// without the menu closing. It is a desktop affordance — on touch the button is a plain link to
// `/activity`, which is the same door.
function LiveFeedMenu({ feed }: { feed: OwnerDashboard['feed'] }) {
  const recent = feed.slice(0, 10)
  return (
    <div className="group relative">
      <Button variant="outline" render={<Link href="/activity" />}>
        <ActivityIcon />
        <span className="hidden sm:inline">Canlı akış</span>
      </Button>
      <div className="invisible absolute right-0 z-40 w-[22rem] max-w-[calc(100vw-2rem)] pt-2 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Son hareketler
          </p>
          <div className="max-h-[26rem] divide-y divide-border overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Bugün henüz hareket yok.</p>
            ) : (
              recent.map((e) => <ActivityRow key={e.eventId} event={e} showDate={false} />)
            )}
          </div>
          <Link
            href="/activity"
            className="block border-t border-border px-3 py-2 text-center text-sm font-medium text-primary hover:bg-primary-soft/20"
          >
            Tümü →
          </Link>
        </div>
      </div>
    </div>
  )
}

// The "Bugün" strip: quiet facts on the left (how much is on, how full), loud items on the right —
// each shown ONLY when it is non-zero, because a "0 katılım bekliyor" chip is noise that trains the
// eye to skip the row where a real number will one day appear.
function TodayStrip({ ops }: { ops: TodayOps }) {
  const pct = ops.capacity > 0 ? Math.round((ops.booked / ops.capacity) * 100) : 0
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <span className="flex items-center gap-2 text-sm">
        <CalendarIcon className="size-4 text-muted-foreground" />
        <span className="font-semibold tabular-nums text-foreground">{ops.sessionCount}</span>
        <span className="text-muted-foreground">seans bugün</span>
      </span>
      <span className="flex items-center gap-2 text-sm">
        <UsersIcon className="size-4 text-muted-foreground" />
        <span className="font-semibold tabular-nums text-foreground">
          {ops.booked}/{ops.capacity}
        </span>
        <span className="text-muted-foreground">dolu · %{pct}</span>
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {ops.pendingAttendance > 0 ? (
          <Link href="/attendance">
            <Badge className="gap-1 bg-warning/10 text-warning hover:bg-warning/20">
              <ClipboardCheckIcon className="size-3.5" />
              {ops.pendingAttendance} ders katılım bekliyor
            </Badge>
          </Link>
        ) : null}
        {ops.waiting > 0 ? (
          <Badge className="gap-1 bg-warning/10 text-warning">
            <UsersIcon className="size-3.5" />
            {ops.waiting} kişi bekleme listesinde
          </Badge>
        ) : null}
        {ops.activeRoomNotes > 0 ? (
          <Badge className="gap-1 bg-warning/10 text-warning">
            <DoorOpenIcon className="size-3.5" />
            {ops.activeRoomNotes} salon notu aktif
          </Badge>
        ) : null}
      </span>
    </section>
  )
}
