'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import type { BookingMember } from '@/server/actions/booking'
import { listEligibleMembersForServiceAction, scheduleSessionAction } from '@/server/actions/scheduling'
import type { ScheduleData } from '@/server/schedule-query'

const NONE = '__none__'
// D13 — the PT capacity band (owner): 1 = one-on-one, 2 = partner PT. Three or more is a group
// class. The DOMAIN enforces this (`pt_capacity_exceeded`); the form just avoids the round-trip.
const PT_MAX_CAPACITY = 2

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function SessionForm({
  data,
  defaultBranchId,
  defaultDate,
  onDone,
}: {
  data: ScheduleData
  defaultBranchId: string | null
  defaultDate: string
  onDone: () => void
}) {
  const [serviceId, setServiceId] = useState<string>(data.services[0]?.id ?? '')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('10:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [capacity, setCapacity] = useState(8)
  // D13 — PT assignment, chosen at creation. 'open' is the DEFAULT business model: any member
  // with a PT package sees the slot and may book it. 'member' reserves it for one person.
  const [ptMode, setPtMode] = useState<'open' | 'member'>('open')
  const [ptMemberId, setPtMemberId] = useState<string | null>(null)
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  // D14 — level 1 of the cancellation chain. Empty ⇒ inherit the service, then the studio.
  const [cancelWindow, setCancelWindow] = useState<number | null>(null)
  const [roomId, setRoomId] = useState<string>(NONE)
  const [trainerId, setTrainerId] = useState<string>(NONE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const branchId = defaultBranchId ?? data.rooms[0]?.branchId ?? ''
  const branchName = useMemo(
    () => data.sessions.find((s) => s.branchId === branchId)?.branchName ?? branchId,
    [data.sessions, branchId],
  )
  const rooms = useMemo(() => data.rooms.filter((r) => r.branchId === branchId), [data.rooms, branchId])

  const isPt = data.services.find((s) => s.id === serviceId)?.category === 'private'

  // Switching to a PT service pulls capacity into the 1–2 band (default 1: one-on-one);
  // switching away restores a group-sized default. The domain enforces the band regardless —
  // this only spares the owner a pointless refusal.
  useEffect(() => {
    if (isPt) {
      setCapacity((c) => (c >= 1 && c <= PT_MAX_CAPACITY ? c : 1))
    } else {
      setPtMode('open')
      setPtMemberId(null)
      setCapacity((c) => (c === 1 || c === 2 ? 8 : c))
    }
  }, [isPt])

  // D13 — ONLY members who could actually book this PT slot. Not a looser UI filter: the server
  // runs the same core eligibility predicate the booking decider uses. Re-fetched when the
  // service or the slot's time changes, because expiry is part of eligibility.
  const startsAtMs = useMemo(() => Date.parse(`${date}T${startTime}:00Z`) - 180 * 60_000, [date, startTime])
  useEffect(() => {
    if (ptMode !== 'member' || !serviceId) return
    let alive = true
    setMembers(null)
    setPtMemberId(null)
    listEligibleMembersForServiceAction({ serviceId, startsAt: startsAtMs })
      .then((m) => alive && setMembers(m))
      .catch(() => {
        if (!alive) return
        setMembers([])
        toast.error('Üye listesi yüklenemedi.')
      })
    return () => {
      alive = false
    }
  }, [ptMode, serviceId, startsAtMs])

  const q = memberQuery.trim().toLocaleLowerCase('tr')
  const filteredMembers = (members ?? []).filter(
    (m) => q === '' || m.fullName.toLocaleLowerCase('tr').includes(q) || m.phone.includes(q),
  )
  const chosenMember = (members ?? []).find((m) => m.id === ptMemberId) ?? null

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!serviceId) {
      setError('Bir ders seçin.')
      return
    }
    if (isPt && ptMode === 'member' && !ptMemberId) {
      setError('Seansı ayırmak istediğiniz üyeyi seçin.')
      return
    }
    setLoading(true)
    setError(null)
    const trainer = trainerId === NONE ? null : (data.staff.find((s) => s.id === trainerId) ?? null)
    try {
      const res = await scheduleSessionAction({
        serviceId,
        branchId,
        branchName,
        roomId: roomId === NONE ? null : roomId,
        trainerId: trainer ? trainer.id : null,
        trainerName: trainer ? trainer.name : null,
        date,
        startTime,
        durationMinutes,
        capacity,
        assignedMemberId: isPt && ptMode === 'member' ? ptMemberId : null,
        cancellationWindowHours: cancelWindow,
      })
      if (res.ok) {
        toast.success('Seans oluşturuldu.')
        onDone()
      } else {
        setError(domainErrorMessage(res.error))
        setLoading(false)
      }
    } catch {
      setError('Seans oluşturulamadı. Lütfen tekrar deneyin.')
      setLoading(false)
    }
  }

  if (data.services.length === 0) {
    return <p className="text-sm text-muted-foreground">Önce bir ders (service) tanımlanmalı.</p>
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field id="s-service" label="Ders">
        <Select value={serviceId} onValueChange={(v) => setServiceId(v ?? '')}>
          <SelectTrigger>
            <SelectValue placeholder="Ders seç" />
          </SelectTrigger>
          <SelectContent>
            {data.services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="s-date" label="Tarih">
          <Input id="s-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field id="s-time" label="Saat">
          <Input id="s-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </Field>
        <Field id="s-dur" label="Süre (dk)">
          <Input
            id="s-dur"
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <Field id="s-cap" label={isPt ? 'Kapasite (PT: 1–2)' : 'Kapasite'}>
          <Input
            id="s-cap"
            type="number"
            min={1}
            max={isPt ? PT_MAX_CAPACITY : undefined}
            value={capacity}
            onChange={(e) => {
              const n = Math.max(1, Number(e.target.value) || 1)
              setCapacity(isPt ? Math.min(n, PT_MAX_CAPACITY) : n)
            }}
          />
          {isPt ? (
            <p className="mt-1.5 text-xs text-muted-foreground">1 = birebir PT · 2 = partner PT</p>
          ) : null}
        </Field>
      </div>

      {/* D13 — PT assignment. Shown only for a private service; open is the default. */}
      {isPt ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <p className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
            PT Atama
          </p>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="pt-mode"
              className="mt-1"
              checked={ptMode === 'open'}
              onChange={() => {
                setPtMode('open')
                setPtMemberId(null)
              }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Açık PT (varsayılan)</span>
              <span className="block text-xs text-muted-foreground">
                PT paketine sahip uygun tüm üyeler görebilir ve kapasite dolana kadar rezerve edebilir.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name="pt-mode"
              className="mt-1"
              checked={ptMode === 'member'}
              onChange={() => setPtMode('member')}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Belirli üyeye ayır</span>
              <span className="block text-xs text-muted-foreground">
                Yalnızca seçilen üye bu seansı görebilir ve rezerve edebilir.
              </span>
            </span>
          </label>

          {ptMode === 'member' ? (
            <div className="space-y-2 pl-6">
              {chosenMember ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                  <span className="truncate text-sm font-medium text-foreground">{chosenMember.fullName}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPtMemberId(null)}>
                    Değiştir
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="Üye ara (isim veya telefon)…"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                  />
                  {members === null ? (
                    <p className="text-sm text-muted-foreground">Yükleniyor…</p>
                  ) : (
                    <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {filteredMembers.slice(0, 30).map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => setPtMemberId(m.id)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary-soft/40"
                          >
                            <span className="truncate font-medium text-foreground">{m.fullName}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{m.phone}</span>
                          </button>
                        </li>
                      ))}
                      {filteredMembers.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-muted-foreground">
                          {members.length === 0
                            ? 'Bu PT hizmetini kapsayan aktif pakete sahip üye bulunamadı.'
                            : 'Eşleşen üye yok.'}
                        </li>
                      ) : null}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <Field id="s-cancel" label="İptal süresi (saat, opsiyonel)">
        <Input
          id="s-cancel"
          type="number"
          min={0}
          placeholder="Varsayılan"
          value={cancelWindow ?? ''}
          onChange={(e) => setCancelWindow(e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Boş bırakılırsa dersin, o da yoksa stüdyonun varsayılanı kullanılır. Seans oluşturulurken
          damgalanır — sonradan varsayılanı değiştirmek bu seansı etkilemez.
        </p>
      </Field>

      <Field id="s-room" label="Salon (opsiyonel)">
        <Select value={roomId} onValueChange={(v) => setRoomId(v ?? NONE)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Salon yok</SelectItem>
            {rooms.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` (${r.capacity})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="s-trainer" label="Eğitmen (opsiyonel)">
        <Select value={trainerId} onValueChange={(v) => setTrainerId(v ?? NONE)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Eğitmen yok</SelectItem>
            {data.staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 w-full" disabled={loading}>
        {loading ? <Loader2Icon className="animate-spin" /> : null}
        Seansı Oluştur
      </Button>
    </form>
  )
}
