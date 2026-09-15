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

export function PortalReservationsScreen({
  upcoming,
}: {
  upcoming: readonly PortalReservation[]
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
                  {/* Inside the window there is no button at all. It used to be offered with a
                      warning underneath, and a member pressed it twice in fifty-one seconds believing
                      it freed her class — two credits gone (owner, 2026-08-06). A warning under a
                      live button is not a rule; the absence of the button is. */}
                  {isLate(r) ? null : (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setConfirming(r)}>
                      İptal Et
                    </Button>
                  )}
                </div>
                <p className={`mt-2 text-xs ${isLate(r) ? 'text-warning' : 'text-muted-foreground'}`}>
                  {isLate(r)
                    ? `İptal süresi doldu — bu ders artık uygulamadan iptal edilemez. Gelemeyecekseniz lütfen stüdyoyu arayın.`
                    : `Ders başlamasına ${r.cancellationWindowHours} saat kalana kadar ücretsiz iptal.`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Geçmiş listesi üyeye gösterilmiyor (owner, 2026-09-15) — bkz. `loadPortalReservations`. */}

      <Dialog open={confirming !== null} onOpenChange={(o) => (o ? null : setConfirming(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rezervasyonu iptal et?</DialogTitle>
            <DialogDescription>
              {confirming ? `${confirming.serviceName} · ${dayTime(confirming.startsAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
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
