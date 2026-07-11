'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { MemberId, ClassSessionId, ReservationId } from '@studio/core'

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
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { domainErrorMessage } from '@/lib/domain-error'
import { bookReservationAction, cancelReservationAction } from '@/server/actions/reservations'
import type { ReservationRow, ReservationsWindow, SessionOption } from '@/server/reservations-workspace-query'

export type ReservationView = 'day' | 'week' | 'agenda'

interface MemberLite {
  readonly id: string
  readonly fullName: string
  readonly phone: string
}

const TZ = 'Europe/Istanbul'
const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const dayHead = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
const STATUS: Record<string, { label: string; className: string }> = {
  booked: { label: 'Rezerve', className: 'bg-primary/10 text-primary' },
  attended: { label: 'Katıldı', className: 'bg-success/10 text-success' },
  no_show: { label: 'Gelmedi', className: 'bg-danger/10 text-danger' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
  late_cancelled: { label: 'Geç iptal', className: 'bg-warning/10 text-warning' },
}

const shift = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const ALL = 'all'

export function ReservationsScreen({
  data,
  members,
  date,
  today,
  view,
}: {
  data: ReservationsWindow
  members: readonly MemberLite[]
  date: string
  today: string
  view: ReservationView
}) {
  const router = useRouter()
  const [memberQuery, setMemberQuery] = useState('')
  const [trainer, setTrainer] = useState(ALL)
  const [service, setService] = useState(ALL)
  const [session, setSession] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [createOpen, setCreateOpen] = useState(false)
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null)
  const [busy, setBusy] = useState(false)

  const go = (d: string, v: ReservationView) => router.push(`/reservations?date=${d}&view=${v}`)
  const step = view === 'week' ? 7 : view === 'agenda' ? 14 : 1

  const trainers = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data.reservations) if (r.trainerId) m.set(r.trainerId, r.trainerName ?? r.trainerId)
    return [...m.entries()]
  }, [data.reservations])
  const services = useMemo(() => [...new Set(data.reservations.map((r) => r.serviceName))], [data.reservations])
  const sessions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data.reservations) m.set(r.sessionId, `${time(r.startsAt)} · ${r.serviceName}`)
    return [...m.entries()]
  }, [data.reservations])

  const filtered = useMemo(() => {
    const q = memberQuery.trim().toLocaleLowerCase('tr')
    return data.reservations.filter(
      (r) =>
        (!q || r.memberName.toLocaleLowerCase('tr').includes(q)) &&
        (trainer === ALL || r.trainerId === trainer) &&
        (service === ALL || r.serviceName === service) &&
        (session === ALL || r.sessionId === session) &&
        (status === ALL || r.status === status),
    )
  }, [data.reservations, memberQuery, trainer, service, session, status])

  const byDay = useMemo(() => {
    const m = new Map<string, ReservationRow[]>()
    for (const r of filtered) {
      const k = dayKey(r.startsAt)
      const list = m.get(k) ?? []
      list.push(r)
      m.set(k, list)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  async function confirmCancel() {
    if (!cancelling) return
    setBusy(true)
    try {
      const res = await cancelReservationAction({ reservationId: cancelling.reservationId as ReservationId })
      if (res.ok) {
        toast.success('Rezervasyon iptal edildi.')
        setCancelling(null)
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İptal tamamlanamadı.')
    }
    setBusy(false)
  }

  const filtersActive = memberQuery || trainer !== ALL || service !== ALL || session !== ALL || status !== ALL
  const heading = view === 'day' ? dayHead(Date.parse(`${date}T00:00:00Z`)) : `${date}${view === 'week' ? ' haftası' : ' + 14g'}`

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Toaster />
      <PageHeader
        title="Rezervasyonlar"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" render={<Link href="/" />}>
              Ana Sayfa
            </Button>
            <Button className="min-h-11 sm:min-h-0" onClick={() => setCreateOpen(true)} disabled={data.sessions.length === 0}>
              <PlusIcon />
              Yeni Rezervasyon
            </Button>
          </div>
        }
      />

      {/* View + date nav */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-border p-0.5">
          {(['day', 'week', 'agenda'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => go(date, v)}
              className={`min-h-9 flex-1 rounded-md px-3 text-sm sm:flex-none ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {v === 'day' ? 'Gün' : v === 'week' ? 'Hafta' : 'Ajanda'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Önceki" onClick={() => go(shift(date, -step), view)}>
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium capitalize">{heading}</span>
          <Button variant="outline" size="icon" aria-label="Sonraki" onClick={() => go(shift(date, step), view)}>
            <ChevronRightIcon />
          </Button>
          <Button variant={date === today ? 'secondary' : 'ghost'} onClick={() => go(today, view)}>
            Bugün
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-40 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Üye ara…" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
        </div>
        <FilterSelect label="Eğitmen" value={trainer} onChange={setTrainer} options={trainers.map(([id, name]) => ({ id, name }))} />
        <FilterSelect label="Ders" value={service} onChange={setService} options={services.map((s) => ({ id: s, name: s }))} />
        <FilterSelect label="Seans" value={session} onChange={setSession} options={sessions.map(([id, name]) => ({ id, name }))} />
        <FilterSelect
          label="Durum"
          value={status}
          onChange={setStatus}
          options={Object.entries(STATUS).map(([id, s]) => ({ id, name: s.label }))}
        />
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMemberQuery('')
              setTrainer(ALL)
              setService(ALL)
              setSession(ALL)
              setStatus(ALL)
            }}
          >
            Temizle
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CalendarIcon} title="Rezervasyon yok" description="Bu aralıkta/filtrede rezervasyon bulunmuyor." />
      ) : (
        <div className="space-y-4">
          {byDay.map(([k, rows]) => (
            <div key={k}>
              {view !== 'day' ? <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{dayHead(rows[0]!.startsAt)}</h3> : null}
              <div className="space-y-2">
                {rows.map((r) => (
                  <ReservationLine key={r.reservationId} r={r} onCancel={() => setCancelling(r)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md">
          <SheetHeader className="p-0">
            <SheetTitle>Yeni Rezervasyon</SheetTitle>
            <SheetDescription>Bir seans seçin, üyeleri ekleyin.</SheetDescription>
          </SheetHeader>
          <CreateForm
            sessions={data.sessions}
            members={members}
            onDone={() => {
              setCreateOpen(false)
              router.refresh()
            }}
          />
        </SheetContent>
      </Sheet>

      <Dialog open={cancelling !== null} onOpenChange={(o) => (o ? null : setCancelling(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rezervasyonu iptal et?</DialogTitle>
            <DialogDescription>{cancelling?.memberName} bu seanstan çıkarılacak.</DialogDescription>
          </DialogHeader>
          {cancelling && lateCancel(cancelling) ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning" role="alert">
              Geç iptal: bu üyenin kredisi yanabilir.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function lateCancel(r: ReservationRow): boolean {
  const hoursUntil = (r.startsAt - Date.now()) / 3_600_000
  return hoursUntil < r.cancellationWindowHours && r.lateCancellationConsumesCredit
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly { id: string; name: string }[]
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger size="sm" className="min-w-32">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: Tümü</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ReservationLine({ r, onCancel }: { r: ReservationRow; onCancel: () => void }) {
  const s = STATUS[r.status] ?? { label: r.status, className: 'bg-muted text-muted-foreground' }
  const open = r.status === 'booked'
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <Link href={`/members/${r.memberId}`} className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{r.memberName}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="tabular-nums">{time(r.startsAt)}</span> · {r.serviceName}
          {r.trainerName ? ` · ${r.trainerName}` : ''}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {r.capacity > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {r.bookedCount}/{r.capacity}
          </span>
        ) : null}
        <Badge className={s.className}>{s.label}</Badge>
        {open ? (
          <Button variant="ghost" size="icon-sm" aria-label="İptal" onClick={onCancel}>
            <XIcon />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CreateForm({
  sessions,
  members,
  onDone,
}: {
  sessions: readonly SessionOption[]
  members: readonly MemberLite[]
  onDone: () => void
}) {
  const [sessionId, setSessionId] = useState(sessions[0]?.sessionId ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<MemberLite[]>([])
  const [busy, setBusy] = useState(false)

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return []
    const pickedIds = new Set(picked.map((m) => m.id))
    return members
      .filter((m) => !pickedIds.has(m.id) && (m.fullName.toLocaleLowerCase('tr').includes(q) || (digits.length > 0 && m.phone.includes(digits))))
      .slice(0, 15)
  }, [members, query, picked])

  async function submit() {
    if (!sessionId || picked.length === 0) return
    setBusy(true)
    const outcomes = await Promise.all(
      picked.map((m) =>
        bookReservationAction({ memberId: m.id as MemberId, sessionId: sessionId as ClassSessionId }).then(
          (res) => ({ m, res }),
          () => ({ m, res: { ok: false as const, error: { code: 'session_not_bookable' as const } } }),
        ),
      ),
    )
    const okCount = outcomes.filter((r) => r.res.ok).length
    const fails = outcomes.filter((r) => !r.res.ok)
    if (okCount > 0) toast.success(`${okCount} rezervasyon oluşturuldu.`)
    for (const f of fails.slice(0, 4)) if (!f.res.ok) toast.error(`${f.m.fullName}: ${domainErrorMessage(f.res.error)}`)
    setBusy(false)
    if (okCount > 0) onDone()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Seans</span>
        <Select value={sessionId} onValueChange={(v) => setSessionId(v ?? '')}>
          <SelectTrigger>
            <SelectValue placeholder="Seans seç" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.sessionId} value={s.sessionId}>
                {time(s.startsAt)} · {s.serviceName} ({s.bookedCount}/{s.capacity})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">Üyeler</span>
        {picked.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPicked((p) => p.filter((x) => x.id !== m.id))}
                className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary"
              >
                {m.fullName} <XIcon className="size-3" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Üye ara ve ekle…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {results.length > 0 ? (
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked((p) => [...p, m])
                    setQuery('')
                  }}
                  className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{m.fullName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{m.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Button className="min-h-11 w-full" disabled={busy || !sessionId || picked.length === 0} onClick={submit}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {picked.length > 1 ? `${picked.length} Üyeyi Rezerve Et` : 'Rezerve Et'}
      </Button>
    </div>
  )
}
