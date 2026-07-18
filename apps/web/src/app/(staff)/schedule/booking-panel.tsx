'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRightLeftIcon,
  CheckIcon,
  HistoryIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  StickyNoteIcon,
  XIcon,
} from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  getBookingStatusAction,
  getSessionRosterAction,
  listBookingMembersAction,
  type BookingMember,
  type BookingStatus,
  type RosterMember,
} from '@/server/actions/booking'
import {
  bookReservationAction,
  cancelReservationAction,
  setReservationNoteAction,
} from '@/server/actions/reservations'
import type { CalendarSession } from '@/server/schedule-query'

import { MoveReservationDialog } from './move-reservation-dialog'
import { ReservationTimelineDialog } from './reservation-timeline-dialog'
import { RecurringDialog } from './recurring-dialog'
import { occupancy } from './types'

const HINT_LABEL: Record<BookingStatus['hint'], string> = {
  ok: 'Uygun',
  full: 'Seans dolu',
  no_entitlement: 'Kullanılabilir paket yok',
  past: 'Bu seansa rezervasyon yapılamaz',
}

export function BookingPanel({ session, onMutated }: { session: CalendarSession; onMutated: () => void }) {
  const [roster, setRoster] = useState<readonly RosterMember[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<BookingMember | null>(null)
  const [status, setStatus] = useState<BookingStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<RosterMember | null>(null)
  const [noting, setNoting] = useState<RosterMember | null>(null)
  const [noteText, setNoteText] = useState('')

  const bookable = session.status === 'scheduled' && session.startsAt > Date.now()
  const occ = occupancy(session.bookedCount, session.capacity)

  const loadRoster = useCallback(async () => {
    setRoster(null)
    try {
      setRoster(await getSessionRosterAction({ sessionId: session.sessionId }))
    } catch {
      setRoster([])
      toast.error('Katılımcılar yüklenemedi.')
    }
  }, [session.sessionId])

  useEffect(() => {
    void loadRoster()
    setAdding(false)
    setPicked(null)
    setStatus(null)
    setQuery('')
  }, [loadRoster])

  async function openPicker() {
    setAdding(true)
    if (!members) {
      try {
        setMembers(await listBookingMembersAction())
      } catch {
        toast.error('Üye listesi yüklenemedi.')
      }
    }
  }

  const filteredMembers = useMemo(() => {
    if (!members) return []
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return members.slice(0, 30)
    return members
      .filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q) || (digits.length > 0 && m.phone.includes(digits)))
      .slice(0, 30)
  }, [members, query])

  const alreadyBooked = useMemo(
    () => (picked && roster ? roster.some((r) => r.memberId === picked.id) : false),
    [picked, roster],
  )

  async function pickMember(m: BookingMember) {
    setPicked(m)
    setStatus(null)
    setStatusLoading(true)
    try {
      setStatus(await getBookingStatusAction({ sessionId: session.sessionId, memberId: m.id }))
    } catch {
      toast.error('Uygunluk kontrol edilemedi.')
    }
    setStatusLoading(false)
  }

  async function book() {
    if (!picked) return
    setBusy(true)
    try {
      const res = await bookReservationAction({
        memberId: picked.id,
        sessionId: session.sessionId,
        entitlementId: status?.entitlementId ?? undefined,
      })
      if (res.ok) {
        toast.success(`${picked.fullName} rezerve edildi.`)
        setPicked(null)
        setStatus(null)
        setAdding(false)
        setQuery('')
        await loadRoster()
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Rezervasyon tamamlanamadı.')
    }
    setBusy(false)
  }

  // `replace` — the "wrong member" fix: cancel this reservation, then open the add picker so
  // reception books the correct member. Two clean, independent events; no fragile combined write.
  async function confirmCancel(replace = false) {
    if (!cancelling) return
    setBusy(true)
    try {
      const res = await cancelReservationAction({ reservationId: cancelling.reservationId })
      if (res.ok) {
        toast.success(replace ? 'İptal edildi — doğru üyeyi seçin.' : 'Rezervasyon iptal edildi.')
        setCancelling(null)
        await loadRoster()
        onMutated()
        if (replace) await openPicker()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İptal tamamlanamadı.')
    }
    setBusy(false)
  }

  const [moving, setMoving] = useState<RosterMember | null>(null)
  const [repeating, setRepeating] = useState<RosterMember | null>(null)
  const [history, setHistory] = useState<RosterMember | null>(null)

  async function saveNote() {
    if (!noting) return
    setBusy(true)
    try {
      const res = await setReservationNoteAction({ reservationId: noting.reservationId, text: noteText.trim() })
      if (res.ok) {
        toast.success(noteText.trim() ? 'Not kaydedildi.' : 'Not silindi.')
        setNoting(null)
        await loadRoster()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Not kaydedilemedi.')
    }
    setBusy(false)
  }

  const hoursUntil = (session.startsAt - Date.now()) / 3_600_000
  const lateCancel = hoursUntil < session.cancellationWindowHours && session.lateCancellationConsumesCredit

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h2 font-semibold tabular-nums text-foreground">
          {session.bookedCount}
          <span className="text-sm font-normal text-muted-foreground">/{session.capacity} katılımcı</span>
        </h3>
        <Badge className={occ.className}>{occ.label}</Badge>
      </div>

      {roster === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz rezervasyon yok.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-xs [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">
          {roster.map((r) => (
            <li key={r.reservationId} className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-primary-soft/40">
              {/* The name/main area is a link to the member's workspace — independent of
                  the pencil (note) and X (cancel) actions; keyboard-accessible. */}
              <Link
                href={`/members/${r.memberId}`}
                className="group min-w-0 flex-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <p className="truncate text-sm font-medium text-foreground group-hover:text-primary group-hover:underline">
                  {r.memberName}
                </p>
                {r.note ? (
                  <p className="flex items-center gap-1 truncate text-xs text-info" title={r.note}>
                    <StickyNoteIcon className="size-3 shrink-0" />
                    <span className="truncate">{r.note}</span>
                  </p>
                ) : (
                  <p className="text-xs tabular-nums text-muted-foreground">···{r.phoneLast4}</p>
                )}
              </Link>
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Hızlı not"
                  onClick={() => {
                    setNoteText(r.note ?? '')
                    setNoting(r)
                  }}
                >
                  <PencilIcon />
                </Button>
                {bookable ? (
                  <>
                    {/* D19 — moving is not cancelling. It sits BEFORE the X on purpose: it is the
                        answer to "I can't make Tuesday", and it costs the member nothing. */}
                    {/* The reservation's own story: booked → moved → cancelled, with who and when. */}
                    <Button variant="ghost" size="icon-sm" aria-label="Rezervasyon geçmişi" onClick={() => setHistory(r)}>
                      <HistoryIcon />
                    </Button>
                    {/* D18 — repeat THIS member in THIS slot for the next weeks. */}
                    <Button variant="ghost" size="icon-sm" aria-label="Sabit rezervasyon" onClick={() => setRepeating(r)}>
                      <RepeatIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Başka seansa taşı" onClick={() => setMoving(r)}>
                      <ArrowRightLeftIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="İptal et" onClick={() => setCancelling(r)}>
                      <XIcon />
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add member — inline, in the same workspace (UX-1) */}
      {bookable ? (
        adding ? (
          <div className="space-y-2 rounded-xl border border-border p-2.5">
            {picked ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{picked.fullName}</p>
                  <Button variant="ghost" size="sm" onClick={() => { setPicked(null); setStatus(null) }}>
                    Değiştir
                  </Button>
                </div>
                {statusLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" /> Kontrol ediliyor…
                  </p>
                ) : alreadyBooked ? (
                  <p className="text-sm text-warning">Bu üye zaten kayıtlı.</p>
                ) : status ? (
                  <p className={`text-sm ${status.bookable ? 'text-success' : 'text-danger'}`}>
                    {status.bookable
                      ? `✓ Uygun · ${status.productName}${status.available !== null ? ` · ${status.available} kredi` : ' · sınırsız'}`
                      : `✗ ${HINT_LABEL[status.hint]}`}
                  </p>
                ) : null}
                <Button
                  className="min-h-11 w-full"
                  disabled={busy || statusLoading || alreadyBooked || !(status?.bookable ?? false)}
                  onClick={book}
                >
                  {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                  Rezerve Et
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Üye ara (isim veya telefon)…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {members === null ? (
                  <p className="text-sm text-muted-foreground">Yükleniyor…</p>
                ) : (
                  <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                    {filteredMembers.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => pickMember(m)}
                          className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="truncate font-medium">{m.fullName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{m.phone}</span>
                        </button>
                      </li>
                    ))}
                    {filteredMembers.length === 0 ? (
                      <li className="p-2 text-sm text-muted-foreground">Eşleşen üye yok.</li>
                    ) : null}
                  </ul>
                )}
                <Button variant="ghost" className="w-full" onClick={() => setAdding(false)}>
                  Kapat
                </Button>
              </>
            )}
          </div>
        ) : (
          <Button variant="outline" className="min-h-11 w-full" onClick={openPicker} disabled={occ.label === 'Dolu'}>
            <PlusIcon />
            Üye Ekle
          </Button>
        )
      ) : null}

      {/* Cancel confirm — with the late-cancellation warning */}
      <Dialog open={cancelling !== null} onOpenChange={(o) => (o ? null : setCancelling(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rezervasyonu iptal et?</DialogTitle>
            <DialogDescription>{cancelling?.memberName} bu seanstan çıkarılacak.</DialogDescription>
          </DialogHeader>
          {lateCancel ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning" role="alert">
              Geç iptal: ders başlamasına {Math.max(0, Math.floor(hoursUntil))} saatten az kaldı — bu üyenin kredisi yanacak.
            </p>
          ) : null}
          <DialogFooter className="sm:flex-col sm:gap-2">
            {/* "Wrong member" — cancel and immediately pick the correct one, without leaving. */}
            <Button variant="outline" onClick={() => void confirmCancel(true)} disabled={busy}>
              İptal Et ve Üye Değiştir
            </Button>
            <Button variant="destructive" onClick={() => void confirmCancel()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Rezervasyonu İptal Et
            </Button>
            <Button variant="ghost" onClick={() => setCancelling(null)} disabled={busy}>
              Vazgeç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hızlı Not — staff-only quick note per reservation */}
      <Dialog open={noting !== null} onOpenChange={(o) => (o ? null : setNoting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hızlı Not</DialogTitle>
            <DialogDescription>{noting?.memberName} · yalnızca personel görür.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            placeholder="Bu rezervasyon/üye için kısa not…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoting(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={saveNote} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MoveReservationDialog
        open={moving !== null}
        reservationId={moving?.reservationId ?? null}
        memberName={moving?.memberName ?? ''}
        fromStartsAt={session.startsAt}
        cancellationWindowHours={session.cancellationWindowHours}
        onClose={() => setMoving(null)}
        onMoved={() => {
          void loadRoster()
          onMutated()
        }}
      />

      <RecurringDialog
        open={repeating !== null}
        memberId={repeating?.memberId ?? null}
        memberName={repeating?.memberName ?? ''}
        sessionId={session.sessionId}
        seedStartsAt={session.startsAt}
        onClose={() => setRepeating(null)}
        onBooked={() => {
          void loadRoster()
          onMutated()
        }}
      />

      <ReservationTimelineDialog
        open={history !== null}
        reservationId={history?.reservationId ?? null}
        memberName={history?.memberName ?? ''}
        onClose={() => setHistory(null)}
      />

    </section>
  )
}
