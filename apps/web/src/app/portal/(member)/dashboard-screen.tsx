'use client'

import Link from 'next/link'
import { CalendarPlusIcon, ClipboardListIcon, QrCodeIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Section } from '@/components/ui/section'
import type { PortalDashboard } from '@/server/portal-query'

import { CATEGORY_CHIP, CATEGORY_LABEL } from '../category'

const TZ = 'Europe/Istanbul'
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
const day = (ms: number) =>
  new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: TZ })
const dayTime = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })

// The member's one-glance screen: what's next, what do I have, what do I owe.
export function PortalDashboardScreen({ data }: { data: PortalDashboard }) {
  const first = data.memberName.split(' ')[0]

  return (
    <main className="mx-auto max-w-lg space-y-6 p-4 pb-8">
      <div>
        <h1 className="text-display font-semibold text-foreground">Merhaba, {first}</h1>
        <p className="text-sm text-muted-foreground">Bugün ne yapmak istersiniz?</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <QuickLink href="/portal/agenda" icon={CalendarPlusIcon} label="Rezervasyon Yap" />
        <QuickLink href="/portal/reservations" icon={ClipboardListIcon} label="Rezervasyonlarım" />
        <QuickLink href="/portal/qr" icon={QrCodeIcon} label="QR Kodum" />
      </div>

      <Section title="Yaklaşan rezervasyonum">
        {data.upcoming.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">Yaklaşan rezervasyonunuz yok.</p>
              <Button size="sm" render={<Link href="/portal/agenda" />}>
                Rezervasyon Yap
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {data.upcoming.map((r) => (
              <li key={r.reservationId}>
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-h3">
                      <span className="truncate">{r.serviceName}</span>
                      <Badge className={CATEGORY_CHIP[r.category] ?? ''}>
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p className="capitalize text-foreground">{dayTime(r.startsAt)}</p>
                    <p className="text-xs">
                      {r.trainerName ?? 'Eğitmen yok'}
                      {r.roomName ? ` · ${r.roomName}` : ''}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Paketlerim">
        {data.packages.length === 0 ? (
          <Card>
            <CardContent className="py-1 text-sm text-muted-foreground">
              Aktif paketiniz bulunmuyor. Paket almak için stüdyoyla iletişime geçin.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {data.packages.map((p) => (
              <li key={p.entitlementId}>
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-h3">
                      <span className="truncate">{p.productName}</span>
                      <Badge className={CATEGORY_CHIP[p.category] ?? ''}>
                        {CATEGORY_LABEL[p.category] ?? p.category}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-h1 font-semibold tabular-nums text-foreground">
                        {/* An unlimited package has no counter to show. Inventing one would be a lie. */}
                        {p.remaining === null ? 'Sınırsız' : `${p.remaining} hak`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Son kullanım: <span className="tabular-nums">{day(p.validUntil)}</span>
                      </p>
                    </div>
                    {p.balanceDue > 0 ? (
                      <Badge className="bg-warning/10 text-warning">Bakiye: {tl(p.balanceDue)}</Badge>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.balanceDue > 0 ? (
        <div className="rounded-xl border border-border bg-warning/10 p-4">
          <p className="text-sm font-medium text-warning">
            Açık bakiyeniz: <span className="tabular-nums">{tl(data.balanceDue)}</span>
          </p>
          {/* Information, not a demand: there is no payment flow here, so we point at the studio
              rather than at a dead end (UX-6). */}
          <p className="mt-1 text-xs text-warning/90">Ödemenizi stüdyoda yapabilirsiniz.</p>
        </div>
      ) : null}
    </main>
  )
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: typeof QrCodeIcon
  label: string
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-center shadow-xs transition-colors hover:bg-muted/60"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-4" />
      </span>
      <span className="text-xs font-medium text-foreground">{label}</span>
    </Link>
  )
}
