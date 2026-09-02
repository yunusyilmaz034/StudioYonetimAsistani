'use client'

import { foldTr } from '@/lib/fold-tr'
import { useMemo, useState } from 'react'
import { CircleAlertIcon, UserPlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// "KİME GİDİYOR?" — the step the owner asked for, and the one that has to refuse to be clever.
//
// Rows matched by PHONE never appear here: that match is certain and was applied without asking.
// Everything else does, with the reason it was proposed, and an operator decides one by one.
//
// The "hepsini onayla" shortcut deliberately skips ambiguous rows — the ones where two members
// could be meant. Those are exactly the rows a bulk button gets wrong, and getting one wrong means a
// package lands on the wrong woman and surfaces weeks later, at the door, as classes she never had.

const NEW = '__new__'
const SKIP = '__skip__'

export interface MatchRow {
  readonly line: number
  readonly memberName: string
  readonly productName: string
  readonly phoneE164: string | null
  readonly needsPhoneToCreate: boolean
  readonly match:
    | { kind: 'phone'; memberId: string }
    | { kind: 'proposal'; candidates: readonly { memberId: string; fullName: string; reason: string }[] }
    | { kind: 'none' }
}

export interface Decision {
  readonly line: number
  readonly memberId: string | null
  readonly skip: boolean
  /**
   * Typed by the operator when the row becomes a NEW member and the file gave no phone.
   *
   * A member without a phone cannot exist — it is her unique key, the thing that stops the same
   * woman being created twice (AD-40). But "the file has no phone" and "there is no phone" are
   * different problems, and only the second one is ours to refuse. She knows the number; the
   * spreadsheet just did not carry it.
   */
  readonly phone?: string
}

/** A loose shape check, only to colour the field. The server normalises and has the final say. */
const phoneLooksOk = (raw: string | undefined): boolean => {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length === 0 || /^(0?5\d{9}|905\d{9})$/.test(digits)
}

const REASON_LABEL: Record<string, string> = {
  exact_name: 'ad birebir aynı',
  same_surname_and_first_name: 'ad ve soyad aynı',
  same_surname_and_initial: 'soyadı aynı, ilk harf aynı',
  near_spelling: 'yazım çok yakın — harf hatası olabilir',
}

export function MatchStep({
  rows,
  roster,
  decisions,
  activePackages,
  onChange,
}: {
  rows: readonly MatchRow[]
  roster: readonly { memberId: string; fullName: string }[]
  decisions: Record<number, Decision>
  /** memberId → the live package(s) she already holds. A warning, never a refusal. */
  activePackages: Readonly<Record<string, string>>
  onChange: (next: Record<number, Decision>) => void
}) {
  const [filter, setFilter] = useState('')
  // Per-row search inside the roster dropdown. A hundred and twenty names in source order is a list
  // nobody can use — the owner had to scroll past thirty strangers to reach the one he wanted.
  const [rosterQuery, setRosterQuery] = useState<Record<number, string>>({})

  // Turkish collation, not ASCII: `Ç` belongs after `C` and `İ` after `I`, and a list that sorts
  // them anywhere else is a list you cannot scan.
  const sortedRoster = useMemo(
    () => [...roster].sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr')),
    [roster],
  )

  const undecided = rows.filter((r) => decisions[r.line] === undefined).length
  const ambiguous = useMemo(
    () => rows.filter((r) => r.match.kind === 'proposal' && r.match.candidates.length > 1),
    [rows],
  )

  function set(line: number, value: string) {
    if (!value) return
    const kept = decisions[line]?.phone
    const next = { ...decisions }
    next[line] =
      value === SKIP
        ? { line, memberId: null, skip: true }
        : value === NEW
          ? { line, memberId: null, skip: false, ...(kept ? { phone: kept } : {}) }
          : { line, memberId: value, skip: false }
    onChange(next)
  }

  function setPhone(line: number, phone: string) {
    const d = decisions[line] ?? { line, memberId: null, skip: false }
    onChange({ ...decisions, [line]: { ...d, phone } })
  }

  function acceptUnambiguous() {
    const next = { ...decisions }
    for (const r of rows) {
      if (r.match.kind !== 'proposal') continue
      if (r.match.candidates.length !== 1) continue // the ambiguous ones stay for a human
      next[r.line] = { line: r.line, memberId: r.match.candidates[0]!.memberId, skip: false }
    }
    onChange(next)
  }

  const shown = filter
    ? rows.filter((r) => foldTr(r.memberName).includes(foldTr(filter)))
    : rows

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="İsimde ara…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button variant="outline" onClick={acceptUnambiguous} className="min-h-11">
          Tek adayı olanları onayla
        </Button>
        {undecided > 0 ? (
          <span className="text-sm text-muted-foreground">{undecided} satır karar bekliyor</span>
        ) : (
          <span className="text-sm text-success">Hepsi karara bağlandı</span>
        )}
      </div>

      {ambiguous.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <strong>{ambiguous.length} satırda birden fazla aday var.</strong> Toplu onay bunlara
            dokunmaz; tek tek seçmeniz gerekiyor. Aynı adı taşıyan iki üye olabilir ve yanlış seçim,
            paketi başka birine yazar.
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Satır</th>
              <th className="px-3 py-2 text-left font-medium">Dosyadaki ad</th>
              <th className="px-3 py-2 text-left font-medium">Paket</th>
              <th className="px-3 py-2 text-left font-medium">Kime</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const d = decisions[r.line]
              const value: string = d === undefined ? '' : d.skip ? SKIP : (d.memberId ?? NEW)
              const isAmbiguous = r.match.kind === 'proposal' && r.match.candidates.length > 1
              const isCreating = d !== undefined && !d.skip && d.memberId === null
              return (
                <tr key={r.line} className={cn('border-t align-top', isAmbiguous && 'bg-warning/5')}>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.memberName}</div>
                    {r.phoneE164 ? <div className="text-xs text-muted-foreground">{r.phoneE164}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.productName}</td>
                  <td className="px-3 py-2">
                    <Select value={value} onValueChange={(v) => set(r.line, v ?? '')}>
                      <SelectTrigger className="min-h-11 w-full max-w-sm">
                        <SelectValue placeholder="Seçin…" />
                      </SelectTrigger>
                      <SelectContent>
                        {r.match.kind === 'proposal'
                          ? r.match.candidates.map((c) => (
                              <SelectItem key={c.memberId} value={c.memberId}>
                                {c.fullName} — {REASON_LABEL[c.reason] ?? c.reason}
                              </SelectItem>
                            ))
                          : null}
                        <SelectItem value={NEW}>
                          <span className="flex items-center gap-1.5">
                            <UserPlusIcon className="size-3.5" /> Yeni üye olarak ekle
                          </span>
                        </SelectItem>
                        <SelectItem value={SKIP}>Bu satırı atla</SelectItem>
                        {/* The full roster, for the case the proposals missed her — a married name,
                            a nickname, a typo in the old system. The operator knows; we do not.
                            Sorted A–Z in Turkish, and searchable: a hundred and twenty names is not
                            something anyone should scroll. */}
                        <div className="sticky top-0 z-10 bg-popover p-1">
                          <Input
                            autoFocus={false}
                            placeholder="Üye ara…"
                            value={rosterQuery[r.line] ?? ''}
                            onChange={(e) => setRosterQuery((q) => ({ ...q, [r.line]: e.target.value }))}
                            // Radix Select treats keystrokes as type-ahead and would swallow these.
                            onKeyDown={(e) => e.stopPropagation()}
                            className="min-h-9"
                          />
                        </div>
                        {sortedRoster
                          .filter((m) => {
                            const q = foldTr((rosterQuery[r.line] ?? '').trim())
                            return !q || foldTr(m.fullName).includes(q)
                          })
                          .slice(0, 60)
                          .map((m) => (
                            <SelectItem key={`all_${m.memberId}`} value={m.memberId}>
                              {m.fullName}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {r.match.kind === 'none' ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Eşleşen üye bulunamadı — yeni üye olarak eklenecek.
                      </p>
                    ) : null}
                    {/* The file gave no phone and this row is about to create a member. She knows
                        the number; the spreadsheet just did not carry it. Asking here beats
                        dropping the row and beats making her edit the file and start over. */}
                    {isCreating && r.needsPhoneToCreate ? (
                      <div className="mt-2 max-w-xs">
                        <Input
                          inputMode="tel"
                          placeholder="Telefon — 0532 123 45 67"
                          value={d?.phone ?? ''}
                          onChange={(e) => setPhone(r.line, e.target.value)}
                          className={cn('min-h-10', !phoneLooksOk(d?.phone) && 'border-danger')}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Yeni üye açmak için telefon şart — üyenin tekil kimliği bu. Girmezseniz bu
                          satır atlanır.
                        </p>
                      </div>
                    ) : null}
                    {isAmbiguous ? <Badge variant="outline" className="mt-1">birden fazla aday</Badge> : null}
                    {/* She already has something live. Usually this means the row is a duplicate —
                        but it is also what a renewal and a hybrid look like, so it is said, not
                        refused. */}
                    {d?.memberId && activePackages[d.memberId] ? (
                      <p className="mt-1 text-xs text-warning">
                        Bu üyenin zaten paketi var: {activePackages[d.memberId]}
                      </p>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
