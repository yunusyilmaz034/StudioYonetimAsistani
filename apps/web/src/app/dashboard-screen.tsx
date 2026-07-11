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

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import type { DashboardData, ExpiringRow, SessionRow } from '@/server/dashboard-query'

import { LogoutButton } from './logout-button'

const TZ = 'Europe/Istanbul'
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const day = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: TZ })
const memberHref = (id: string) => `/members/${id}`

export function DashboardScreen({ data, roleLabel }: { data: DashboardData; roleLabel: string }) {
  const router = useRouter()

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Panel"
        description={`${roleLabel} · ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Yenile" onClick={() => router.refresh()}>
              <RefreshCwIcon />
            </Button>
            <Badge>{roleLabel}</Badge>
            <LogoutButton />
          </div>
        }
      />

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickAction href="/members?new=1" icon={UserPlusIcon} label="Yeni Üye" />
        <QuickAction href="/members" icon={GiftIcon} label="Yeni Abonelik" />
        <QuickAction href="/checkin" icon={QrCodeIcon} label="Giriş / Çıkış" />
        <QuickAction href="/reservations" icon={CalendarIcon} label="Rezervasyon" />
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Şu an içeride" value={data.isOpen ? data.occupancy : '—'} icon={DoorOpenIcon} href="/checkin" />
        <Stat label="Bugün giriş" value={data.todayCheckInCount} icon={LogInIcon} href="/checkin" />
        <Stat label="Bugünkü ders" value={data.todaySessions.length} icon={CalendarIcon} href="/schedule" />
        <Stat label="Bugünkü PT" value={data.todayPt.length} icon={DumbbellIcon} href="/schedule" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Widget title="İçeridekiler" icon={UsersIcon} count={data.occupancy} empty={data.inside.length === 0} emptyText={data.isOpen ? 'Şu an kimse yok.' : 'Şube kapalı.'}>
          {data.inside.slice(0, 10).map((m) => (
            <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={time(m.checkedInAt)} />
          ))}
        </Widget>

        <Widget title="Yaklaşan, henüz giriş yok" icon={ClockIcon} count={data.expectedSoon.length} empty={data.expectedSoon.length === 0} emptyText="Yok.">
          {data.expectedSoon.map((m) => (
            <MemberLine key={m.memberId + m.startsAt} id={m.memberId} name={m.name} right={time(m.startsAt)} warn />
          ))}
        </Widget>

        <Widget title="Bugünkü dersler" icon={CalendarIcon} count={data.todaySessions.length} empty={data.todaySessions.length === 0} emptyText="Bugün ders yok.">
          {data.todaySessions.map((s) => (
            <SessionLine key={s.sessionId} s={s} />
          ))}
        </Widget>

        <Widget title="Bugünkü PT dersleri" icon={DumbbellIcon} count={data.todayPt.length} empty={data.todayPt.length === 0} emptyText="Bugün PT yok.">
          {data.todayPt.map((s) => (
            <SessionLine key={s.sessionId} s={s} />
          ))}
        </Widget>

        <Widget title="Yakında bitecek üyelikler" icon={ClockIcon} count={data.expiringSoon.length} empty={data.expiringSoon.length === 0} emptyText="Yok.">
          {data.expiringSoon.map((e: ExpiringRow) => (
            <MemberLine key={e.memberId + e.validUntil} id={e.memberId} name={e.name} sub={e.productName} right={day(e.validUntil)} warn />
          ))}
        </Widget>

        <Widget title="Tahsil edilmemiş bakiyeler" icon={WalletIcon} count={data.balances.length} empty={data.balances.length === 0} emptyText="Açık bakiye yok.">
          {data.balances.map((b) => (
            <MemberLine key={b.memberId} id={b.memberId} name={b.name} right={tl(b.balanceKurus)} warn />
          ))}
        </Widget>

        <Widget title="Son 14 gün rezervasyon yapmayan" icon={UsersIcon} count={data.inactive.length} empty={data.inactive.length === 0} emptyText="Yok.">
          {data.inactive.map((m) => (
            <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={`üye: ${day(m.joinedAt)}`} />
          ))}
        </Widget>

        <Widget title="Bugün doğum günü" icon={CakeIcon} count={data.birthdays.length} empty={data.birthdays.length === 0} emptyText="Bugün doğum günü yok.">
          {data.birthdays.map((m) => (
            <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={m.age !== null ? `${m.age} yaş` : ''} />
          ))}
        </Widget>

        <Widget title="Son eklenen üyeler" icon={UserPlusIcon} count={data.recentMembers.length} empty={data.recentMembers.length === 0} emptyText="Yok.">
          {data.recentMembers.map((m) => (
            <MemberLine key={m.memberId} id={m.memberId} name={m.name} right={day(m.joinedAt)} />
          ))}
        </Widget>
      </div>
    </main>
  )
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }) {
  return (
    <Button variant="outline" className="min-h-14 flex-col gap-1" render={<Link href={href} />}>
      <Icon />
      <span className="text-xs">{label}</span>
    </Button>
  )
}

function Stat({ label, value, icon: Icon, href }: { label: string; value: number | string; icon: ComponentType<SVGProps<SVGSVGElement>>; href: string }) {
  return (
    <Link href={href} className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
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
}: {
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  count: number
  empty: boolean
  emptyText: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {count > 0 ? <Badge variant="outline">{count}</Badge> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {empty ? <p className="py-2 text-sm text-muted-foreground">{emptyText}</p> : <ul className="divide-y divide-border">{children}</ul>}
      </CardContent>
    </Card>
  )
}

function MemberLine({ id, name, sub, right, warn }: { id: string; name: string; sub?: string; right?: string; warn?: boolean }) {
  return (
    <li>
      <Link href={memberHref(id)} className="flex items-center justify-between gap-2 py-2 hover:bg-muted/40">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {right ? <span className={`shrink-0 text-xs tabular-nums ${warn ? 'text-warning' : 'text-muted-foreground'}`}>{right}</span> : null}
      </Link>
    </li>
  )
}

function SessionLine({ s }: { s: SessionRow }) {
  const full = s.bookedCount >= s.capacity
  return (
    <li>
      <Link href="/schedule" className="flex items-center justify-between gap-2 py-2 hover:bg-muted/40">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            <span className="tabular-nums">{time(s.startsAt)}</span> · {s.serviceName}
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
