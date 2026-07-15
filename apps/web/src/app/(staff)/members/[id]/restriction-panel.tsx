'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { MemberId, MemberRestriction } from '@studio/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { clearMemberRestrictionAction, setMemberRestrictionAction } from '@/server/actions/members'

// ── labels / helpers ─────────────────────────────────────────────────────────────────────────
const REASON_LABEL: Record<string, string> = {
  vip: 'VIP',
  corporate: 'Kurumsal',
  promotional: 'Promosyon',
  problem: 'Sorunlu',
  other: 'Diğer',
}
// Display order Pzt…Paz; the domain uses 0=Sun … 6=Sat.
const WEEKDAYS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Pzt' },
  { value: 2, label: 'Sal' },
  { value: 3, label: 'Çar' },
  { value: 4, label: 'Per' },
  { value: 5, label: 'Cum' },
  { value: 6, label: 'Cmt' },
  { value: 0, label: 'Paz' },
]
const pad = (n: number) => String(n).padStart(2, '0')
const minToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const hhmmToMin = (s: string): number => {
  const [h, m] = s.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

// A limit override is tri-state: absent ⇒ inherit the package; null ⇒ unlimited; a number ⇒ value.
type LimitMode = 'inherit' | 'unlimited' | 'value'
const modeOf = (v: number | null | undefined): LimitMode => (v === undefined ? 'inherit' : v === null ? 'unlimited' : 'value')

function limitLabel(v: number | null | undefined, unit: string): { text: string; source: 'member' | 'package' } {
  if (v === undefined) return { text: 'Paket varsayılanı', source: 'package' }
  if (v === null) return { text: 'Sınırsız', source: 'member' }
  return { text: `${v} ${unit}`, source: 'member' }
}

export function RestrictionPanel({
  memberId,
  restriction,
  canEdit,
}: {
  memberId: MemberId
  restriction: MemberRestriction | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [editorOpen, setEditorOpen] = useState(false)
  const [clearReason, setClearReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function clear() {
    if (clearReason === null) return
    setBusy(true)
    try {
      const res = await clearMemberRestrictionAction({ memberId, reason: clearReason.trim() || 'Kaldırıldı' })
      if (res.ok) {
        toast.success('Kısıt kaldırıldı.')
        setClearReason(null)
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Section
      title="Kısıtlı Üyelik"
      hint="Bu üyeye özel kurallar. Rezervasyonda önce üye kuralı, yoksa paket, yoksa stüdyo varsayılanı uygulanır."
      actions={
        canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
            {restriction ? 'Düzenle' : 'Kısıt Ekle'}
          </Button>
        ) : null
      }
    >
      {restriction === null ? (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Bu üye standart kurallara tabidir.
        </p>
      ) : (
        <div className="space-y-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1 bg-warning/15 text-warning">
              <ShieldAlertIcon className="size-3.5" />
              {REASON_LABEL[restriction.reason] ?? restriction.reason}
            </Badge>
            {restriction.note ? <span className="text-sm text-muted-foreground">{restriction.note}</span> : null}
          </div>

          {/* Effective rules, each with its source. */}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Rule label="İzinli günler">
              {restriction.allowedWeekdays == null ? (
                <SourcedText text="Tüm günler" source="package" />
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {WEEKDAYS.filter((w) => restriction.allowedWeekdays!.includes(w.value)).map((w) => (
                    <Badge key={w.value} className="bg-primary-soft/50 text-foreground">
                      {w.label}
                    </Badge>
                  ))}
                  <SourceTag source="member" />
                </span>
              )}
            </Rule>
            <Rule label="İzinli saatler">
              {restriction.allowedHourRanges == null || restriction.allowedHourRanges.length === 0 ? (
                <SourcedText text="Tüm saatler" source="package" />
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {restriction.allowedHourRanges.map((r, i) => (
                    <Badge key={i} className="bg-primary-soft/50 tabular-nums text-foreground">
                      {minToHHMM(r.startMinutes)}–{minToHHMM(r.endMinutes)}
                    </Badge>
                  ))}
                  <SourceTag source="member" />
                </span>
              )}
            </Rule>
            <Rule label="İptal hakkı">
              <SourcedLimit v={restriction.cancellationAllowance} unit="hak" />
            </Rule>
            <Rule label="Günlük rez. limiti">
              <SourcedLimit v={restriction.dailyReservationLimit} unit="/gün" />
            </Rule>
            <Rule label="Aktif rez. limiti">
              <SourcedLimit v={restriction.activeReservationLimit} unit="aktif" />
            </Rule>
          </dl>

          {canEdit ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setClearReason('')}>
                Kaldır
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {editorOpen ? (
        <RestrictionEditor
          memberId={memberId}
          initial={restriction}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false)
            router.refresh()
          }}
        />
      ) : null}

      {/* Clear-with-reason */}
      <Dialog open={clearReason !== null} onOpenChange={(o) => (o ? null : setClearReason(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kısıtı kaldır</DialogTitle>
            <DialogDescription>Bu üye tekrar standart kurallara tabi olur. Kayda geçer.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Sebep (ör. anlaşma sona erdi)"
            value={clearReason ?? ''}
            onChange={(e) => setClearReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearReason(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => void clear()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Kaldır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  )
}
function SourceTag({ source }: { source: 'member' | 'package' }) {
  return (
    <span className="text-xs text-muted-foreground">{source === 'member' ? '· Üye (özel)' : '· Paket varsayılanı'}</span>
  )
}
function SourcedText({ text, source }: { text: string; source: 'member' | 'package' }) {
  return (
    <span>
      {text} <SourceTag source={source} />
    </span>
  )
}
function SourcedLimit({ v, unit }: { v: number | null | undefined; unit: string }) {
  const { text, source } = limitLabel(v, unit)
  return <SourcedText text={text} source={source} />
}

// ── the editor ─────────────────────────────────────────────────────────────────────────────
interface HourRow {
  start: string
  end: string
}

function RestrictionEditor({
  memberId,
  initial,
  onClose,
  onSaved,
}: {
  memberId: MemberId
  initial: MemberRestriction | null
  onClose: () => void
  onSaved: () => void
}) {
  const [reason, setReason] = useState<string>(initial?.reason ?? 'vip')
  const [note, setNote] = useState(initial?.note ?? '')

  const [dayRestricted, setDayRestricted] = useState(initial?.allowedWeekdays != null)
  const [days, setDays] = useState<number[]>(initial?.allowedWeekdays ? [...initial.allowedWeekdays] : [1, 2, 3, 4, 5])

  const [hourRestricted, setHourRestricted] = useState(
    initial?.allowedHourRanges != null && initial.allowedHourRanges.length > 0,
  )
  const [hours, setHours] = useState<HourRow[]>(
    initial?.allowedHourRanges && initial.allowedHourRanges.length > 0
      ? initial.allowedHourRanges.map((r) => ({ start: minToHHMM(r.startMinutes), end: minToHHMM(r.endMinutes) }))
      : [{ start: '10:00', end: '16:00' }],
  )

  const [cancelMode, setCancelMode] = useState<LimitMode>(modeOf(initial?.cancellationAllowance))
  const [cancelValue, setCancelValue] = useState<number>(
    typeof initial?.cancellationAllowance === 'number' ? initial.cancellationAllowance : 3,
  )
  const [dailyMode, setDailyMode] = useState<LimitMode>(modeOf(initial?.dailyReservationLimit))
  const [dailyValue, setDailyValue] = useState<number>(
    typeof initial?.dailyReservationLimit === 'number' ? initial.dailyReservationLimit : 2,
  )
  const [activeMode, setActiveMode] = useState<LimitMode>(modeOf(initial?.activeReservationLimit))
  const [activeValue, setActiveValue] = useState<number>(
    typeof initial?.activeReservationLimit === 'number' ? initial.activeReservationLimit : 4,
  )

  const [busy, setBusy] = useState(false)

  const toggleDay = (v: number) => setDays((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))

  function limitInput(mode: LimitMode, value: number): number | null | undefined {
    return mode === 'inherit' ? undefined : mode === 'unlimited' ? null : value
  }

  async function submit() {
    // Client-side guards mirror the domain (which refuses too).
    if (note.trim().length === 0) {
      toast.error('Gerekçe notu zorunludur.')
      return
    }
    if (dayRestricted && days.length === 0) {
      toast.error('En az bir gün seçin veya gün kısıtını kapatın.')
      return
    }
    let ranges: { startMinutes: number; endMinutes: number }[] | null = null
    if (hourRestricted) {
      ranges = hours.map((h) => ({ startMinutes: hhmmToMin(h.start), endMinutes: hhmmToMin(h.end) }))
      if (ranges.some((r) => r.endMinutes <= r.startMinutes)) {
        toast.error('Saat aralığında bitiş, başlangıçtan sonra olmalı.')
        return
      }
    }

    const payload = {
      memberId,
      reason,
      note: note.trim(),
      allowedWeekdays: dayRestricted ? days : null,
      allowedHourRanges: ranges,
      // Tri-state: only include a key when it is NOT "inherit".
      ...(cancelMode !== 'inherit' ? { cancellationAllowance: limitInput(cancelMode, cancelValue) } : {}),
      ...(dailyMode !== 'inherit' ? { dailyReservationLimit: limitInput(dailyMode, dailyValue) } : {}),
      ...(activeMode !== 'inherit' ? { activeReservationLimit: limitInput(activeMode, activeValue) } : {}),
    }

    setBusy(true)
    try {
      const res = await setMemberRestrictionAction(payload)
      if (res.ok) {
        toast.success('Kısıt kaydedildi.')
        onSaved()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kısıtlı Üyelik</DialogTitle>
          <DialogDescription>Bu kurallar yalnızca bu üyeyi etkiler; paketi değiştirmez.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex flex-col gap-1 text-sm">
            Gerekçe
            <Select value={reason} onValueChange={(v) => setReason(v ?? 'vip')}>
              <SelectTrigger>
                <SelectValue>{(v: unknown) => REASON_LABEL[String(v)] ?? 'Gerekçe'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Not (zorunlu)
            <Textarea placeholder="Neden ve kapsam" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {/* Allowed days */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={dayRestricted} onCheckedChange={(v) => setDayRestricted(v === true)} />
              Gün kısıtı
            </label>
            {dayRestricted ? (
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => toggleDay(w.value)}
                    className={`min-h-9 rounded-lg border px-3 text-sm transition-colors ${
                      days.includes(w.value)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Kapalı: üye her gün rezervasyon yapabilir.</p>
            )}
          </div>

          {/* Allowed hours */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={hourRestricted} onCheckedChange={(v) => setHourRestricted(v === true)} />
              Saat kısıtı
            </label>
            {hourRestricted ? (
              <div className="space-y-2">
                {hours.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={h.start}
                      onChange={(e) => setHours((hs) => hs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={h.end}
                      onChange={(e) => setHours((hs) => hs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                    />
                    {hours.length > 1 ? (
                      <Button variant="ghost" size="sm" onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))}>
                        Sil
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setHours((hs) => [...hs, { start: '10:00', end: '16:00' }])}>
                  Aralık ekle
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Kapalı: üye her saatte rezervasyon yapabilir.</p>
            )}
          </div>

          {/* Limit overrides */}
          <LimitField label="İptal hakkı" mode={cancelMode} setMode={setCancelMode} value={cancelValue} setValue={setCancelValue} min={0} />
          <LimitField label="Günlük rez. limiti" mode={dailyMode} setMode={setDailyMode} value={dailyValue} setValue={setDailyValue} min={1} />
          <LimitField label="Aktif rez. limiti" mode={activeMode} setMode={setActiveMode} value={activeValue} setValue={setActiveValue} min={1} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LimitField({
  label,
  mode,
  setMode,
  value,
  setValue,
  min,
}: {
  label: string
  mode: LimitMode
  setMode: (m: LimitMode) => void
  value: number
  setValue: (n: number) => void
  min: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Select value={mode} onValueChange={(v) => setMode((v as LimitMode) ?? 'inherit')}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {(v: unknown) =>
                v === 'inherit' ? 'Pakete göre' : v === 'unlimited' ? 'Sınırsız' : 'Özel değer'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Pakete göre (varsayılan)</SelectItem>
            <SelectItem value="unlimited">Sınırsız</SelectItem>
            <SelectItem value="value">Özel değer</SelectItem>
          </SelectContent>
        </Select>
        {mode === 'value' ? (
          <Input
            type="number"
            min={min}
            className="w-20"
            value={value}
            onChange={(e) => setValue(Math.max(min, Number(e.target.value) || min))}
          />
        ) : null}
      </div>
    </div>
  )
}
