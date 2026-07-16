'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon, Loader2Icon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { domainErrorMessage } from '@/lib/domain-error'
import { getBookingStatusAction, listUpcomingSessionsAction, type BookingStatus, type UpcomingSession } from '@/server/actions/booking'
import { bookReservationAction } from '@/server/actions/reservations'
import { searchMembersAction, type MemberHit } from '@/server/actions/search'
import { cn } from '@/lib/utils'

// Quick booking (Plus Phase 2 §2) — a fast reservation WITHOUT touching the calendar. Opened from ⌘K's
// "Yeni rezervasyon" or the "N" shortcut, it is a modal, not a screen change: find the member, pick an
// upcoming session, see the eligibility pre-check, confirm. It calls the EXISTING trusted path
// (bookReservationAction → the domain decides credits, the category wall, capacity, the window); there
// is no second booking route that could skip a rule. On success it just closes — the calendar behind
// it is untouched and refreshes on next load.

const hhmm = (ms: number) => new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(ms)

type Member = { id: string; fullName: string; phone: string }

export function QuickBooking() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [member, setMember] = useState<Member | null>(null)
  const [mq, setMq] = useState('')
  const [hits, setHits] = useState<readonly MemberHit[]>([])
  const [sessions, setSessions] = useState<readonly UpcomingSession[] | null>(null)
  const [sq, setSq] = useState('')
  const [status, setStatus] = useState<BookingStatus | null>(null)
  const [chosen, setChosen] = useState<UpcomingSession | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  const reset = useCallback(() => {
    setMember(null)
    setMq('')
    setHits([])
    setSessions(null)
    setSq('')
    setStatus(null)
    setChosen(null)
  }, [])

  // Opened by ⌘K (with a member) or the "N" shortcut (empty).
  useEffect(() => {
    const onOpen = (e: Event) => {
      reset()
      const detail = (e as CustomEvent).detail as Member | undefined
      if (detail?.id) setMember(detail)
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        reset()
        setOpen(true)
      }
    }
    window.addEventListener('sos:quick-book', onOpen)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('sos:quick-book', onOpen)
      window.removeEventListener('keydown', onKey)
    }
  }, [reset])

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open, member])

  // Member search (only until one is chosen).
  useEffect(() => {
    const q = mq.trim()
    if (member || q.length < 2) {
      setHits([])
      return undefined
    }
    const id = ++reqId.current
    const t = setTimeout(async () => {
      const r = await searchMembersAction(q)
      if (id === reqId.current) setHits(r)
    }, 160)
    return () => clearTimeout(t)
  }, [mq, member])

  // Load upcoming sessions once a member is chosen.
  useEffect(() => {
    if (!member) return
    let live = true
    void listUpcomingSessionsAction({ nowMs: Date.now() }).then((s) => {
      if (live) setSessions(s)
    })
    return () => {
      live = false
    }
  }, [member])

  const filteredSessions = useMemo(() => {
    const q = sq.trim().toLowerCase()
    const list = sessions ?? []
    return q ? list.filter((s) => s.serviceName.toLowerCase().includes(q) || (s.trainerName ?? '').toLowerCase().includes(q)) : list
  }, [sessions, sq])

  const pickSession = async (s: UpcomingSession) => {
    if (!member) return
    setChosen(s)
    setStatus(null)
    setStatus(await getBookingStatusAction({ sessionId: s.sessionId, memberId: member.id }))
  }

  const confirm = async () => {
    if (!member || !chosen) return
    setBusy(true)
    const r = await bookReservationAction({ memberId: member.id, sessionId: chosen.sessionId })
    setBusy(false)
    if (r.ok) {
      toast.success(`${member.fullName} · ${chosen.serviceName} rezervasyonu oluşturuldu.`)
      setOpen(false)
      router.refresh()
    } else {
      toast.error(domainErrorMessage(r.error))
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Hızlı rezervasyon">
      <button aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 -z-10 cursor-default bg-foreground/25 backdrop-blur-sm" />
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {member ? (
            <button onClick={() => { setMember(null); setChosen(null); setStatus(null) }} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Geri">
              <ChevronLeftIcon className="size-4" />
            </button>
          ) : null}
          <span className="font-heading text-base font-medium text-foreground">Hızlı rezervasyon</span>
          <span className="ml-auto text-xs text-muted-foreground">{member ? member.fullName : 'Üye seç'}</span>
          <button onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Kapat"><XIcon className="size-4" /></button>
        </div>

        {!member ? (
          <div className="p-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input ref={inputRef} value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Üye ara — isim veya telefon…" className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ul className="mt-1.5 max-h-[48vh] overflow-y-auto">
              {hits.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setMember({ id: m.id, fullName: m.fullName, phone: m.phone })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[0.7rem] font-semibold text-primary">{m.fullName.slice(0, 2).toLocaleUpperCase('tr')}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{m.fullName}</span><span className="block truncate text-xs text-muted-foreground">{m.phone} · {m.packageLabel}</span></span>
                    {m.warn ? <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[0.7rem] font-medium text-warning">{m.warn}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : chosen ? (
          <div className="flex flex-col p-4">
            <p className="text-sm text-muted-foreground">Seçilen ders</p>
            <p className="font-medium text-foreground">{chosen.serviceName} · <span className="tabular-nums">{hhmm(chosen.startsAt)}</span></p>
            <p className="text-xs text-muted-foreground">{chosen.trainerName ?? 'Eğitmen yok'} · {chosen.bookedCount}/{chosen.capacity} dolu</p>
            <div className="my-4 rounded-lg border border-border bg-background p-3 text-sm">
              {status === null ? (
                <span className="flex items-center gap-2 text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Kontrol ediliyor…</span>
              ) : status.bookable ? (
                <span className="text-success">Uygun{status.productName ? ` — ${status.productName}` : ''}{status.available !== null ? ` · ${status.available} kredi kalacak` : ' · sınırsız'}.</span>
              ) : (
                <span className="text-danger">{status.hint === 'full' ? 'Ders dolu.' : status.hint === 'no_entitlement' ? 'Uygun paket yok.' : status.hint === 'past' ? 'Ders geçmiş.' : 'Rezervasyon yapılamıyor.'}</span>
              )}
            </div>
            <button onClick={() => void confirm()} disabled={busy || !status?.bookable} className="h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:opacity-50">
              {busy ? 'Oluşturuluyor…' : 'Rezervasyonu oluştur'}
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col p-2">
            <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input ref={inputRef} value={sq} onChange={(e) => setSq(e.target.value)} placeholder="Ders veya eğitmen ara…" className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {sessions === null ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Dersler yükleniyor…</li>
              ) : filteredSessions.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Yaklaşan uygun ders yok.</li>
              ) : (
                filteredSessions.map((s) => {
                  const full = s.bookedCount >= s.capacity
                  return (
                    <li key={s.sessionId}>
                      <button onClick={() => void pickSession(s)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
                        <span className="font-heading text-sm font-medium tabular-nums text-foreground">{hhmm(s.startsAt)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">{s.serviceName}</span><span className="block truncate text-xs text-muted-foreground">{s.trainerName ?? 'Eğitmen yok'}</span></span>
                        <span className={cn('shrink-0 text-xs tabular-nums', full ? 'text-gold' : 'text-muted-foreground')}>{s.bookedCount}/{s.capacity}</span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
