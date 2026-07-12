'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Section } from '@/components/ui/section'
import { domainErrorMessage } from '@/lib/domain-error'
import { cancelOwnReservationAction } from '@/server/actions/portal'
import type { PortalReservation } from '@/server/portal-query'

import { CATEGORY_CHIP, CATEGORY_LABEL, CATEGORY_RAIL } from '../../category'

const TZ = 'Europe/Istanbul'
const dayTime = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })

const STATUS: Record<string, { label: string; className: string }> = {
  booked: { label: 'Rezerve', className: 'bg-primary-soft text-primary' },
  attended: { label: 'Katıldınız', className: 'bg-success/10 text-success' },
  no_show: { label: 'Gelmediniz', className: 'bg-danger/10 text-danger' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
  late_cancelled: { label: 'Geç iptal', className: 'bg-warning/10 text-warning' },
}

export function PortalReservationsScreen({
  upcoming,
  past,
}: {
  upcoming: readonly PortalReservation[]
  past: readonly PortalReservation[]
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<PortalReservation | null>(null)
  const [busy, setBusy] = useState(false)

  // Is she inside the window? Computed from the window STAMPED on her session (D14) — never a
  // hard-coded 6, and never re-derived from today's settings.
  const hoursUntil = (r: PortalReservation) => (r.startsAt - Date.now()) / 3_600_000
  const isLate = (r: PortalReservation) => hoursUntil(r) < r.cancellationWindowHours

  async function cancel() {
    if (!confirming) return
    setBusy(true)
    try {
      const res = await cancelOwnReservationAction({ reservationId: confirming.reservationId })
      if (res.ok) {
        toast.success('Rezervasyonunuz iptal edildi.')
        setConfirming(null)
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İptal tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 p-4 pb-8">
      <h1 className="text-display font-semibold text-foreground">Rezervasyonlarım</h1>

      <Section title="Yaklaşan" hint={`${upcoming.length}`}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Yaklaşan rezervasyonunuz yok.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((r) => (
              <li
                key={r.reservationId}
                className={`rounded-xl border border-l-4 border-border bg-card p-3 shadow-xs ${CATEGORY_RAIL[r.category] ?? ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="truncate">{r.serviceName}</span>
                      <Badge className={CATEGORY_CHIP[r.category] ?? ''}>
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </Badge>
                    </p>
                    <p className="capitalize text-xs text-muted-foreground">{dayTime(r.startsAt)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setConfirming(r)}>
                    İptal Et
                  </Button>
                </div>
                <p className={`mt-2 text-xs ${isLate(r) ? 'text-warning' : 'text-muted-foreground'}`}>
                  {isLate(r)
                    ? r.lateCancellationConsumesCredit
                      ? `İptal süresi doldu — şimdi iptal ederseniz hakkınız düşer.`
                      : `İptal süresi doldu, ancak hakkınız düşmez.`
                    : `Ders başlamasına ${r.cancellationWindowHours} saat kalana kadar ücretsiz iptal.`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Geçmiş">
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geçmiş rezervasyonunuz yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {past.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, className: 'bg-muted text-muted-foreground' }
              return (
                <li key={r.reservationId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.serviceName}</p>
                    <p className="truncate text-xs capitalize text-muted-foreground">{dayTime(r.startsAt)}</p>
                  </div>
                  <Badge className={`shrink-0 ${st.className}`}>{st.label}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Dialog open={confirming !== null} onOpenChange={(o) => (o ? null : setConfirming(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rezervasyonu iptal et?</DialogTitle>
            <DialogDescription>
              {confirming ? `${confirming.serviceName} · ${dayTime(confirming.startsAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {confirming && isLate(confirming) && confirming.lateCancellationConsumesCredit ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning" role="alert">
              İptal süresi doldu. Şimdi iptal ederseniz bu ders hakkınızdan düşecek.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
