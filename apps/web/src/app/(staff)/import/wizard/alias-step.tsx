'use client'

import { ArrowRightIcon, CircleAlertIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// "PAKETLERİ EŞLEŞTİRİN" — the same puzzle as the columns, one level down.
//
// The studio's real export writes `6 AY`, `3 AY`, `1 AY`, `2 AY`, `3AY`. Those are durations, not
// product names, and demanding an exact match rejected all hundred rows with nothing to do about it
// but retype a spreadsheet. Five distinct labels, five answers, a hundred rows imported.
//
// The suggestion reads a number and a unit out of the label and offers products of that shape. It
// never guesses a CATEGORY: `1 AY` matches both the one-month fitness membership and the eight-class
// pilates package, because both run thirty days, and only the operator knows which her file means.
// A wrong product is a right in the wrong category, and the category wall is the one thing the UI
// cannot repair afterwards.

const SKIP = '__skip__'

export interface UnknownLabel {
  readonly label: string
  readonly rows: number
  readonly suggestions: readonly { productId: string; name: string; reason: string }[]
}

const REASON: Record<string, string> = {
  same_duration: 'süresi aynı',
  same_credits: 'ders sayısı aynı',
}

export function AliasStep({
  unknown,
  products,
  aliases,
  onChange,
}: {
  unknown: readonly UnknownLabel[]
  products: readonly { productId: string; name: string }[]
  aliases: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const undecided = unknown.filter((u) => (aliases[u.label] ?? '') === '').length
  const affected = unknown.reduce((n, u) => n + u.rows, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          Dosyanızdaki <strong>{unknown.length} paket adı</strong> katalogda yok — toplam{' '}
          <strong>{affected} satır</strong>. Her birinin hangi pakete karşılık geldiğini bir kez
          seçin, o ada sahip bütün satırlara uygulanır.
        </p>
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Dosyanızdaki ad</span>
          <span />
          <span>Katalogdaki paket</span>
        </div>

        {unknown.map((u) => {
          const value = aliases[u.label] ?? ''
          return (
            <div key={u.label} className="grid grid-cols-[1fr_auto_1.4fr] items-start gap-3 border-b px-4 py-3 last:border-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{u.label}</span>
                  <Badge variant="secondary">{u.rows} satır</Badge>
                </div>
                {u.suggestions.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bu ada uyan bir paket bulunamadı — listeden seçin, ya da bu satırları atlayın.
                  </p>
                ) : null}
              </div>

              <ArrowRightIcon className={`mt-2 size-4 shrink-0 ${value ? 'text-accent' : 'text-muted-foreground/30'}`} />

              <div className="min-w-0">
                <Select value={value} onValueChange={(v) => onChange({ ...aliases, [u.label]: v ?? '' })}>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder="Paket seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Suggestions first, each with the reason it was suggested. */}
                    {u.suggestions.map((s) => (
                      <SelectItem key={s.productId} value={s.productId}>
                        {s.name} — {REASON[s.reason] ?? s.reason}
                      </SelectItem>
                    ))}
                    <SelectItem value={SKIP}>Bu satırları atla</SelectItem>
                    {/* And the whole catalogue, because a suggestion is not a shortlist. */}
                    {products
                      .filter((p) => !u.suggestions.some((s) => s.productId === p.productId))
                      .map((p) => (
                        <SelectItem key={`all_${p.productId}`} value={p.productId}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        })}
      </div>

      {undecided > 0 ? (
        <p className="text-sm text-muted-foreground">{undecided} ad karar bekliyor.</p>
      ) : (
        <p className="text-sm text-success">Hepsi karara bağlandı.</p>
      )}
    </div>
  )
}

export { SKIP as ALIAS_SKIP }
