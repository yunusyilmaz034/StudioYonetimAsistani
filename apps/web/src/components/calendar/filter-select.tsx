'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// A compact filter dropdown with an "all" sentinel, shared by the calendar screens. `value`
// is the option id or 'all' — the sentinel is an internal token and must never be what the
// user reads: `allLabel` gives it plain Turkish ("Tüm Salonlar"), which is also the trigger's
// resting text.
export function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  label: string
  allLabel?: string
  value: string
  onChange: (v: string) => void
  options: readonly { id: string; name: string }[]
}) {
  const all = allLabel ?? `${label}: Tümü`
  // The trigger must show the option's NAME, never its id: Select.Value renders the raw value
  // by default, which is how the internal 'all' sentinel leaked onto the screen.
  const nameOf = (v: unknown): string =>
    typeof v === 'string' && v !== 'all' ? (options.find((o) => o.id === v)?.name ?? all) : all

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? 'all')}>
      <SelectTrigger size="sm" className="min-w-32">
        <SelectValue placeholder={all}>{(v: unknown) => nameOf(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
