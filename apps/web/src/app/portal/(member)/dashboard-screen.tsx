'use client'

import Link from 'next/link'
import { CalendarPlusIcon, ClipboardListIcon, QrCodeIcon, ArrowRightIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Section } from '@/components/ui/section'
import type { PortalDashboard } from '@/server/portal-query'

import { CATEGORY_CHIP, CATEGORY_LABEL } from '../category'
import { CafePayButton } from './cafe-pay-button'
import { OccupancyCard } from './occupancy-card'

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

      {/* Plus Phase 8 — how busy the studio is right now, anonymously (a band, never a headcount). */}
      <OccupancyCard />

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

      {/* ── KAFE HESABIM (owner, 2026-09-04) ────────────────────────────────────────────────
          *"Stüdyoda kahve su içiyorlar ödemeden gidiyorlar."* Resepsiyon üyenin hesabına yazıyor,
          üye burada görüyor: ne, kaç adet, hangi gün saat kaçta.

          BORÇ YOKKEN HİÇ ÇIKMIYOR. "0 ₺ borcun var" diyen bir kart, her açılışta bir borç
          hatırlatmasıdır ve stresi boşuna artırır.

          Paket taksiti buraya ÇIKMAZ (owner kararı): ölçüldüğünde 10 üyenin 90.900 ₺ açık paket
          borcu vardı ve bir kısmının ödeme anlaşması sözlüydü. Kahve borcuyla aynı ekrana koymak
          ikisini de yanlış anlatırdı. */}
      {data.cafeDueKurus > 0 ? (
        <Section title="Kafe hesabım">
          <Card>
            <CardContent className="space-y-3 py-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Toplam</span>
                <span className="text-h2 font-semibold tabular-nums text-foreground">
                  {(data.cafeDueKurus / 100).toLocaleString('tr-TR')} ₺
                </span>
              </div>

              <ul className="space-y-1 border-t border-border pt-2">
                {data.cafeItems.map((it, i) => (
                  <li key={`${it.name}-${it.at}-${i}`} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {it.name}
                      {/* Adet YALNIZCA birden fazlaysa: "1 ×" yazmak, okuyanın saymasını istemektir. */}
                      {it.quantity > 1 ? <span className="text-muted-foreground"> × {it.quantity}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(it.at).toLocaleString('tr-TR', {
                        timeZone: 'Europe/Istanbul',
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {(it.totalKurus / 100).toLocaleString('tr-TR')} ₺
                    </span>
                  </li>
                ))}
              </ul>

              {/* İKİ YOL, owner'ın söylediği gibi. Kartla doğrudan ödeme YOK: küçük tutarlarda
                  komisyon oranı anlamsızlaşıyor (10 ₺ su için ~%3) ve her biri ayrı bir işlem olurdu.
                  Cüzdan bir kez yüklenir, kahveler oradan düşer. */}
              <div className="space-y-2 border-t border-border pt-3">
                {/* Bakiye YETİYORSA doğrudan öde; yetmiyorsa yükleme yolu. İki düğmeyi birden
                    göstermek, üyeye kendi bakiyesini hesaplatmaktır. */}
                <CafePayButton walletKurus={data.walletKurus} dueKurus={data.cafeDueKurus} />
                {data.walletKurus < data.cafeDueKurus ? (
                  <Button size="sm" className="w-full" render={<Link href="/portal/wallet" />}>
                    Cüzdanıma yükle ve öde
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Dilersen resepsiyona uğrayıp nakit veya kartla da ödeyebilirsin.
                </p>
              </div>
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <Section title="Paketlerim">
        {data.packages.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-1 text-sm text-muted-foreground">
              <p>Aktif paketiniz bulunmuyor.</p>
              {/* The old copy sent her to find a phone number. She is already holding the thing that
                  can sell her a package. */}
              <Link
                href="/portal/paket"
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Paket al
              </Link>
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
        {/* Offered where she just read "3 hak" — the moment she learns she is running out is the
            moment renewing should be one tap, not a phone call tomorrow.

            Deliberately NOT a quiet link (owner: "çok basit kalmış, görülmüyor"). It is the only
            action on this screen and the studio's renewal flow depends on it being seen; a muted
            row under three package cards is a button nobody presses. */}
        {data.packages.length > 0 ? (
          <Link
            href="/portal/paket"
            className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground shadow-md transition-transform active:scale-[0.99]"
          >
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">Paket al / yenile</p>
              <p className="text-sm opacity-85">
                Kartınızla ödeyin, paketiniz ödeme onaylanır onaylanmaz tanımlansın.
              </p>
            </div>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20">
              <ArrowRightIcon className="size-5" />
            </span>
          </Link>
        ) : null}
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
