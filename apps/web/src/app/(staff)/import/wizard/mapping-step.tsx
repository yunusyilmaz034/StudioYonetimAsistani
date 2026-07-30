'use client'

import { ArrowRightIcon, CircleAlertIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// THE MAPPING STEP — the puzzle the owner asked for.
//
// Left: what this system can fill. Right: the columns in her file. An arrow between them, and every
// arrow can be changed. The suggestion is pre-filled from the header names and is only ever a
// suggestion: a wizard that silently guessed and imported would produce the exact failure this
// screen exists to prevent — forty-five records with a phone number in the name field.
//
// A column may stay unmapped on either side and that is normal. Her file will have things we do not
// want (an old system's internal id, a "durum" column); we have fields her file does not carry.
// Both are stated rather than hidden, because an operator who cannot see what was left out cannot
// tell a deliberate omission from a mistake.

const NONE = '__none__'

export interface FieldInfo {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly hint: string | null
}

export function MappingStep({
  fields,
  header,
  sample,
  mapping,
  onChange,
}: {
  fields: readonly FieldInfo[]
  header: readonly string[]
  /** The first data row, so each column can show what is actually in it. */
  sample: readonly string[]
  mapping: Record<string, number | null>
  onChange: (key: string, index: number | null) => void
}) {
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null))
  const unmappedColumns = header.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i))

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card">
        <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Bizim alanımız</span>
          <span />
          <span>Dosyanızdaki sütun</span>
        </div>

        {fields.map((f) => {
          const at = mapping[f.key] ?? null
          const missing = f.required && at === null
          return (
            <div key={f.key} className="grid grid-cols-[1fr_auto_1.4fr] items-start gap-3 border-b px-4 py-3 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{f.label}</span>
                  {f.required ? <Badge variant="outline">zorunlu</Badge> : null}
                </div>
                {f.hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.hint}</p> : null}
              </div>

              <ArrowRightIcon className={cn('mt-2 size-4 shrink-0', at === null ? 'text-muted-foreground/30' : 'text-accent')} />

              <div className="min-w-0">
                <Select
                  value={at === null ? NONE : String(at)}
                  onValueChange={(v) => onChange(f.key, v === NONE ? null : Number(v))}
                >
                  <SelectTrigger className={cn('min-h-11 w-full', missing && 'border-danger')}>
                    <SelectValue placeholder="Sütun seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— eşleştirme —</SelectItem>
                    {header.map((h, i) => (
                      <SelectItem key={i} value={String(i)} disabled={used.has(i) && at !== i}>
                        {h || `(başlıksız sütun ${i + 1})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* What is actually in that column, from the first data row. A header can say
                    "Telefon" while the column holds something else entirely, and the only way to
                    notice is to look at a value. */}
                {at !== null && sample[at] ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">örnek: {sample[at]}</p>
                ) : null}
                {missing ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                    <CircleAlertIcon className="size-3.5" /> Bu alan zorunlu — eşleştirin veya sonraki adımda elle doldurun.
                  </p>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {unmappedColumns.length > 0 ? (
        <div className="rounded-xl border border-dashed p-4">
          <p className="text-sm font-medium text-foreground">Kullanılmayan sütunlar ({unmappedColumns.length})</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bunlar aktarılmayacak. Sorun değilse devam edin — eski sistemin kendi kolonları genelde buraya düşer.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unmappedColumns.map(({ h, i }) => (
              <Badge key={i} variant="secondary">{h || `sütun ${i + 1}`}</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
