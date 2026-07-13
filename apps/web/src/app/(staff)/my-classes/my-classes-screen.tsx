'use client'

import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ReservationId } from '@studio/core'

import { markAttendanceCommand } from '@/lib/commands'
import {
  getMyRosterAction,
  listMyClassesAction,
  type MyClass,
  type MyRosterEntry,
} from '@/server/actions/trainer'

// The trainer's screen. She is holding a phone, standing in a doorway, and eight women are walking
// in. Everything here is built for that: big targets, one tap per person, no navigation.
//
// Attendance rides the OFFLINE path (`markAttendanceCommand` → `/commands`), because the studio's
// wifi is worst exactly where she is — in the room. The mark is written locally, the UI moves
// immediately, and a trigger applies it when the connection comes back. She never waits for a
// spinner to find out whether Ayşe was here.

const dayName = (ms: number) =>
  new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' })
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
  })
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
  })

const shiftDay = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function MyClassesScreen({ date, trainerName }: { date: string; trainerName: string }) {
  const router = useRouter()
  const [classes, setClasses] = useState<readonly MyClass[] | null>(null)
  const [open, setOpen] = useState<MyClass | null>(null)
  const [, startTransition] = useTransition()

  const load = useCallback(async () => {
    setClasses(await listMyClassesAction({ date }))
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const go = (days: number) =>
    startTransition(() => router.push(`/my-classes?date=${shiftDay(date, days)}`))

  const pending = classes?.reduce((n, c) => n + c.pending, 0) ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Derslerim"
        description={
          classes === null
            ? 'Yükleniyor…'
            : pending > 0
              ? `${dayLabel(date)} · ${pending} kişi için yoklama bekliyor`
              : `${dayLabel(date)} · yoklama tamam`
        }
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Önceki gün" onClick={() => go(-1)}>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Sonraki gün" onClick={() => go(1)}>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        }
      />

      {classes !== null && classes.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title="Bugün dersin yok."
          description="Başka bir güne bakmak için oklarla ilerle."
        />
      ) : null}

      <div className="grid gap-3">
        {(classes ?? []).map((c) => (
          <Card key={c.sessionId}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <button
                type="button"
                className="min-h-11 flex-1 text-left"
                onClick={() => setOpen(c)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-h3 font-semibold tabular-nums">{clock(c.startsAt)}</span>
                  <span className="text-sm text-muted-foreground">{dayName(c.startsAt)}</span>
                </div>
                <div className="mt-0.5 font-medium">{c.serviceName}</div>
                <div className="text-sm text-muted-foreground">
                  {c.bookedCount}/{c.capacity} kişi
                  {c.roomName ? ` · ${c.roomName}` : ''}
                </div>
              </button>

              {/* The one number she needs: how many people she has not yet answered for. */}
              {c.pending > 0 ? (
                <Badge className="bg-warning/15 text-warning-foreground">{c.pending} bekliyor</Badge>
              ) : (
                <Badge className="bg-success/15 text-success-foreground">Tamam</Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <RosterSheet
        session={open}
        date={date}
        onClose={() => {
          setOpen(null)
          void load() // the pending counts move as she marks
        }}
      />
      <span className="sr-only">{trainerName}</span>
    </div>
  )
}

function RosterSheet({
  session,
  date,
  onClose,
}: {
  session: MyClass | null
  date: string
  onClose: () => void
}) {
  const [roster, setRoster] = useState<readonly MyRosterEntry[] | null>(null)

  useEffect(() => {
    if (!session) {
      setRoster(null)
      return
    }
    void getMyRosterAction({ sessionId: session.sessionId, date }).then(setRoster)
  }, [session, date])

  const mark = async (r: MyRosterEntry, outcome: 'attended' | 'no_show') => {
    // OPTIMISTIC, and honestly so: the command is queued (offline-safe), and the trigger applies it.
    // She does not wait, because in a doorway with eight women there is nothing to wait with.
    setRoster((rows) =>
      (rows ?? []).map((x) => (x.reservationId === r.reservationId ? { ...x, status: outcome } : x)),
    )
    try {
      await markAttendanceCommand({ reservationId: r.reservationId as ReservationId, outcome })
    } catch {
      toast.error('Yoklama kaydedilemedi. Tekrar dene.')
      setRoster((rows) =>
        (rows ?? []).map((x) =>
          x.reservationId === r.reservationId ? { ...x, status: 'booked' } : x,
        ),
      )
    }
  }

  return (
    <Sheet open={session !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {session ? `${clock(session.startsAt)} · ${session.serviceName}` : ''}
          </SheetTitle>
        </SheetHeader>

        {roster !== null && roster.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Bu derste rezervasyon yok.
          </p>
        ) : null}

        <div className="divide-y divide-border">
          {(roster ?? []).map((r) => (
            <div key={r.reservationId} className="flex items-center justify-between gap-3 py-3">
              {/* Her name. Not her phone, not her package, not her balance. */}
              <span className="font-medium">{r.memberName}</span>

              {r.status === 'booked' ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 min-w-11"
                    aria-label={`${r.memberName} geldi`}
                    onClick={() => void mark(r, 'attended')}
                  >
                    <CheckIcon className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 min-w-11"
                    aria-label={`${r.memberName} gelmedi`}
                    onClick={() => void mark(r, 'no_show')}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
              ) : (
                <Badge
                  className={
                    r.status === 'attended'
                      ? 'bg-success/15 text-success-foreground'
                      : 'bg-muted text-muted-foreground'
                  }
                >
                  {r.status === 'attended' ? 'Geldi' : 'Gelmedi'}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
