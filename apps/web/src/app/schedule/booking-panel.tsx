'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
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
import { domainErrorMessage } from '@/lib/domain-error'
import {
  getBookingStatusAction,
  getSessionRosterAction,
  listBookingMembersAction,
  type BookingMember,
  type BookingStatus,
  type RosterMember,
} from '@/server/actions/booking'
import { bookReservationAction, cancelReservationAction } from '@/server/actions/reservations'
import type { CalendarSession } from '@/server/schedule-query'

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

  async function confirmCancel() {
    if (!cancelling) return
    setBusy(true)
    try {
      const res = await cancelReservationAction({ reservationId: cancelling.reservationId })
      if (res.ok) {
        toast.success('Rezervasyon iptal edildi.')
        setCancelling(null)
        await loadRoster()
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İptal tamamlanamadı.')
    }
    setBusy(false)
  }

  const hoursUntil = (session.startsAt - Date.now()) / 3_600_000
  const lateCancel = hoursUntil < session.cancellationWindowHours && session.lateCancellationConsumesCredit

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Katılımcılar{' '}
          <span className="tabular-nums text-muted-foreground">
            {session.bookedCount}/{session.capacity}
          </span>
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
        <ul className="divide-y divide-border rounded-xl border border-border">
          {roster.map((r) => (
            <li key={r.reservationId} className="flex items-center justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{r.memberName}</p>
                <p className="text-xs text-muted-foreground">···{r.phoneLast4}</p>
              </div>
              {bookable ? (
                <Button variant="ghost" size="icon-sm" aria-label="İptal et" onClick={() => setCancelling(r)}>
                  <XIcon />
                </Button>
              ) : null}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Rezervasyonu İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
