'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CakeIcon,
  CalendarIcon,
  ClockIcon,
  DoorOpenIcon,
  DumbbellIcon,
  GiftIcon,
  LogInIcon,
  QrCodeIcon,
  RefreshCwIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { ActivityRow } from '@/components/activity/activity-row'
import type { ActivityEvent } from '@/server/activity-query'
import type { DashboardData, ExpiringRow, SessionRow } from '@/server/dashboard-query'

import { LogoutButton } from './logout-button'

const TZ = 'Europe/Istanbul'
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const day = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: TZ })
const memberHref = (id: string) => `/members/${id}`

// The owner dashboard, on DS v2 (v1.20 · Doc 20). Same data, same actions, same links — the
// information architecture is what changed. The screen now reads top-down in the order the
// owner acts:
//   Hızlı işlem → Şimdi (live) → Bugün (the day's plan) → Dikkat (follow-up) → Son hareketler.
// Grouping is carried by section headers and whitespace instead of nine equal-weight boxes,
// and the day's programme is ONE chronological list (private sessions carry a PT chip) rather
// than a class list plus a PT list that repeated the same rows.
export function DashboardScreen({
  data,
  roleLabel,
  feed,
}: {
  data: DashboardData
  roleLabel: string
  feed: readonly ActivityEvent[]
}) {
  const router = useRouter()
  const programme = [...data.todaySessions].sort((a, b) => a.startsAt - b.startsAt)
  // `todaySessions` carries every session, private ones included; `todayPt` is its
  // category === 'private' subset. The two metrics must not overlap (owner, v1.20 Batch 2).
  const groupCount = data.todaySessions.length - data.todayPt.length

  return (
    <main className="mx-auto max-w-6xl space-y-7 p-4 pb-10 sm:p-6 lg:p-8">
      <PageHeader
        title="Genel Görünüm"
        description={`${roleLabel} · ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Yenile" onClick={() => router.refresh()}>
              <RefreshCwIcon />
            </Button>
            {/* The desktop rail already carries logout; on mobile the bottom bar does not. */}
            <span className="md:hidden">
              <LogoutButton />
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickAction href="/members?new=1" icon={UserPlusIcon} label="Yeni Üye" />
        <QuickAction href="/members" icon={GiftIcon} label="Yeni Abonelik" />
        <QuickAction href="/checkin" icon={QrCodeIcon} label="Giriş / Çıkış" />
        <QuickAction href="/reservations" icon={CalendarIcon} label="Rezervasyon" />
      </div>

      <Section title="Şimdi" hint={data.isOpen ? 'şube açık' : 'şube kapalı'}>
        <MetricStrip>
          <Metric label="Şu an içeride" value={data.isOpen ? data.occupancy : '—'} icon={DoorOpenIcon} href="/checkin" />
          <Metric label="Bugün giriş" value={data.todayCheckInCount} icon={LogInIcon} href="/checkin" />
          <Metric label="Bugünkü grup dersi" value={groupCount} icon={CalendarIcon} href="/schedule" />
          <Metric label="Bugünkü PT" value={data.todayPt.length} icon={DumbbellIcon} href="/schedule" />
        </MetricStrip>

        <div className="grid gap-4 md:grid-cols-2">
          <Widget
            title="Yaklaşan, henüz giriş yok"
            icon={ClockIcon}
            count={data.expectedSoon.length}
            empty={data.expectedSoon.length === 0}
            emptyText="Bekleyen yok."
          >
            {data.expectedSoon.map((m) => (
              <MemberLine key={m.memberId + m.startsAt} id={m.memberId} name={m.name} right={time(m.startsAt)} warn />
            ))}
          </Widget>

          <Widget
            title="İçeridekiler"
            icon={UsersIcon}
            count={data.occupancy}
            empty={data.inside.length === 0}
            emptyText={data.isOpen ? 'Şu an kimse yok.' : 'Şube kapalı.'}
          >
            {data.inside.slice(0, 10).map((m) => (
              <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={time(m.checkedInAt)} />
            ))}
          </Widget>
        </div>
      </Section>

      <Section title="Bugün">
        <div className="grid gap-4 md:grid-cols-3">
          <Widget
            className="md:col-span-2"
            title="Bugünkü program"
            icon={CalendarIcon}
            count={programme.length}
            empty={programme.length === 0}
            emptyText="Bugün ders yok."
          >
            {programme.map((s) => (
              <SessionLine key={s.sessionId} s={s} />
            ))}
          </Widget>

          <Widget
            title="Bugün doğum günü"
            icon={CakeIcon}
            count={data.birthdays.length}
            empty={data.birthdays.length === 0}
            emptyText="Bugün doğum günü yok."
          >
            {data.birthdays.map((m) => (
              <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={m.age !== null ? `${m.age} yaş` : ''} />
            ))}
          </Widget>
        </div>
      </Section>

      <Section title="Dikkat gerektirenler" hint="takip edilecek">
        <div className="grid gap-4 md:grid-cols-3">
          <Widget
            title="Tahsil edilmemiş bakiye"
            icon={WalletIcon}
            count={data.balances.length}
            empty={data.balances.length === 0}
            emptyText="Açık bakiye yok."
          >
            {data.balances.map((b) => (
              <MemberLine key={b.memberId} id={b.memberId} name={b.name} right={tl(b.balanceKurus)} warn />
            ))}
          </Widget>

          <Widget
            title="Yakında bitecek üyelik"
            icon={ClockIcon}
            count={data.expiringSoon.length}
            empty={data.expiringSoon.length === 0}
            emptyText="Yakında biten yok."
          >
            {data.expiringSoon.map((e: ExpiringRow) => (
              <MemberLine key={e.memberId + e.validUntil} id={e.memberId} name={e.name} sub={e.productName} right={day(e.validUntil)} warn />
            ))}
          </Widget>

          <Widget
            title="14 gündür rezervasyon yok"
            icon={UsersIcon}
            count={data.inactive.length}
            empty={data.inactive.length === 0}
            emptyText="Herkes aktif."
          >
            {data.inactive.map((m) => (
              <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={`üye: ${day(m.joinedAt)}`} />
            ))}
          </Widget>
        </div>
      </Section>

      {/* The live activity feed (v1.22, owner rule 5). Not a report — an operations screen:
          who did what, to whom, to the second. Sentences, never event names. */}
      <Section
        title="Canlı akış"
        actions={
          <Link href="/activity" className="text-sm font-medium text-primary hover:underline">
            Tümü
          </Link>
        }
      >
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {feed.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Bugün henüz hareket yok.</p>
          ) : (
            feed.map((e) => <ActivityRow key={e.eventId} event={e} showDate={false} />)
          )}
        </div>
      </Section>

      <Section title="Son eklenen üyeler">
        <Widget
          title="Son eklenen üyeler"
          icon={UserPlusIcon}
          count={data.recentMembers.length}
          empty={data.recentMembers.length === 0}
          emptyText="Yeni üye yok."
        >
          {data.recentMembers.map((m) => (
            <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={day(m.joinedAt)} />
          ))}
        </Widget>
      </Section>
    </main>
  )
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs transition-colors hover:bg-muted/60"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-4" />
      </span>
      <span className="truncate text-sm font-medium text-foreground">{label}</span>
    </Link>
  )
}

function Widget({
  title,
  icon: Icon,
  count,
  empty,
  emptyText,
  children,
  className,
}: {
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  count: number
  empty: boolean
  emptyText: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={`gap-3 ${className ?? ''}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h3 font-semibold">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </CardTitle>
        {count > 0 ? (
          <CardAction>
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-1 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="-mx-2">{children}</ul>
        )}
      </CardContent>
    </Card>
  )
}

// Rows carry no rules: separation comes from rhythm and a hover tint, which keeps a long list
// calm to scan for hours (Doc 20 §1).
function MemberLine({ id, name, sub, right, warn }: { id: string; name: string; sub?: string; right?: string; warn?: boolean }) {
  return (
    <li>
      <Link
        href={memberHref(id)}
        className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {right ? (
          <span className={`shrink-0 text-xs tabular-nums ${warn ? 'text-warning' : 'text-muted-foreground'}`}>{right}</span>
        ) : null}
      </Link>
    </li>
  )
}

function SessionLine({ s }: { s: SessionRow }) {
  const full = s.bookedCount >= s.capacity
  const isPt = s.category === 'private'
  return (
    <li>
      <Link
        href="/schedule"
        className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{time(s.startsAt)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
            <span className="truncate">{s.serviceName}</span>
            {isPt ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground">
                PT
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">{s.trainerName ?? 'Eğitmen yok'}</p>
        </div>
        <span className={`shrink-0 text-xs tabular-nums ${full ? 'text-danger' : 'text-muted-foreground'}`}>
          {s.bookedCount}/{s.capacity}
        </span>
      </Link>
    </li>
  )
}
