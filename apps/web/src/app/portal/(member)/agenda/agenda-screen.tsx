'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { domainErrorMessage } from '@/lib/domain-error'
import { bookOwnReservationAction } from '@/server/actions/portal'
import type { PortalAgenda, PortalSession } from '@/server/portal-query'

import { CATEGORY_CHIP, CATEGORY_LABEL, CATEGORY_RAIL } from '../../category'

const TZ = 'Europe/Istanbul'
const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })

// Why she cannot book a class she can see. The server computed these from the same rules the
// decider enforces — the client only renders them.
const BLOCKED: Record<string, string> = {
  full: 'Kontenjan dolu',
  no_credit: 'Hakkınız kalmadı',
  self_booking_off: 'Online rezervasyona kapalı',
  past: 'Geçmiş',
}

export function PortalAgendaScreen({ data }: { data: PortalAgenda }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  const days = useMemo(() => {
    const map = new Map<string, PortalSession[]>()
    for (const s of data.sessions) {
      const k = dayKey(s.startsAt)
      map.set(k, [...(map.get(k) ?? []), s])
    }
    return [...map.entries()]
  }, [data.sessions])

  async function book(sessionId: string) {
    setBusyId(sessionId)
    try {
      const res = await bookOwnReservationAction({ sessionId })
      if (res.ok) {
        toast.success('Rezervasyonunuz oluşturuldu.')
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Rezervasyon tamamlanamadı.')
    }
    setBusyId(null)
  }

  // No active package → she sees nothing, and the screen says why instead of showing an empty
  // calendar she cannot interpret (UX-6: no dead ends).
  if (!data.hasActivePackage) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <EmptyState
          icon={CalendarIcon}
          title="Aktif paketiniz yok"
          description="Rezervasyon yapabilmek için geçerli bir paketiniz olmalı. Stüdyoyla iletişime geçin."
        />
      </main>
    )
  }

  if (data.sessions.length === 0) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <EmptyState
          icon={CalendarIcon}
          title="Uygun seans yok"
          description="Paketinizin kapsadığı yaklaşan bir ders bulunmuyor."
        />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 p-4 pb-8">
      <div>
        <h1 className="text-display font-semibold text-foreground">Rezervasyon Yap</h1>
        <p className="text-sm text-muted-foreground">Paketinizin kapsadığı dersler gösteriliyor.</p>
      </div>

      {days.map(([key, sessions]) => (
        <section key={key} className="space-y-2">
          <h2 className="text-h3 font-semibold capitalize text-foreground">{dayLabel(sessions[0]!.startsAt)}</h2>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.sessionId}
                className={`rounded-xl border border-l-4 border-border bg-card p-3 shadow-xs ${CATEGORY_RAIL[s.category] ?? ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="tabular-nums">{time(s.startsAt)}</span>
                      <span className="truncate">{s.serviceName}</span>
                      {/* Colour never carries meaning alone — the category is written out. */}
                      <Badge className={CATEGORY_CHIP[s.category] ?? ''}>
                        {CATEGORY_LABEL[s.category] ?? s.category}
                      </Badge>
                      {s.isAssignedToMe ? (
                        <Badge className="bg-primary-soft text-primary">Size ayrıldı</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.trainerName ?? 'Eğitmen yok'}
                      {s.roomName ? ` · ${s.roomName}` : ''} · {s.bookedCount}/{s.capacity}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {s.alreadyBooked ? (
                      <Badge className="bg-success/10 text-success">Rezerve</Badge>
                    ) : s.blockedReason ? (
                      <Badge className="bg-muted text-muted-foreground">{BLOCKED[s.blockedReason]}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="min-h-9"
                        disabled={busyId !== null}
                        onClick={() => book(s.sessionId)}
                      >
                        {busyId === s.sessionId ? <Loader2Icon className="animate-spin" /> : null}
                        Rezerve Et
                      </Button>
                    )}
                  </div>
                </div>

                {/* D14 — her real cancellation limit, read from the session's stamped snapshot. */}
                <p className="mt-2 text-xs text-muted-foreground">
                  Ders başlamasına {s.cancellationWindowHours} saat kalana kadar ücretsiz iptal
                  edebilirsiniz.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
