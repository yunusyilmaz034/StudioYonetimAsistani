'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import { scheduleSessionAction } from '@/server/actions/scheduling'
import type { ScheduleData } from '@/server/schedule-query'

const NONE = '__none__'

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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!serviceId) {
      setError('Bir ders seçin.')
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
        <Field id="s-cap" label="Kapasite">
          <Input
            id="s-cap"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
      </div>

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
