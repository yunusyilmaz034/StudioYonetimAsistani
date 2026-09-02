'use client'

import { foldTr } from '@/lib/fold-tr'
import { useEffect, useMemo, useState } from 'react'
import { CheckIcon, Loader2Icon, PencilIcon, SearchIcon, Trash2Icon, UserPlusIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { saveErrorMessage } from '@/lib/stale-deployment'
import { SEGMENT_GROUPS, type SegmentKey } from '@/lib/segments'
import {
  audienceMembersAction,
  deleteEngagementGroupAction,
  listEngagementGroupsAction,
  pickableMembersAction,
  upsertEngagementGroupAction,
  type EngagementGroup,
  type SegmentInfo,
} from '@/server/actions/engagement'

// THE AUDIENCE, OPENED (owner, 2026-08-31).
//
// Two things were missing from this row, and they are the same complaint twice: the owner could see
// a NUMBER and could not see the PEOPLE.
//
//   1. "Sürekli iptal edenler (9)" — nine who? A count you cannot open is a count you cannot act on,
//      and she was being asked to send a message to a set she could not inspect.
//   2. No way to say "these eleven". Every audience here is COMPUTED from a rule, and some audiences
//      have no rule — the Tuesday 10:00 regulars, the ones who brought a friend. Those are picked by
//      hand or they do not exist.
//
// Groups sit in their own row, deliberately apart from the segments. A segment is a live question
// ("who has a fitness package?") re-answered on every load; a group is a frozen list. Mixing them
// would make the same chip mean two different things, and the day that matters is the day a group
// looks out of date: for a segment that is a bug, for a group it is simply a list to update.

export type Audience = { kind: 'segment'; key: SegmentKey } | { kind: 'group'; id: string }

function chipClass(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
  }`
}

export function AudiencePanel({
  segments,
  audience,
  onAudience,
  onLabel,
  canManage,
}: {
  segments: readonly SegmentInfo[]
  audience: Audience
  onAudience: (a: Audience) => void
  /** The selected audience's NAME, lifted up — the send preview has to title itself with it. */
  onLabel: (label: string) => void
  canManage: boolean
}) {
  const [groups, setGroups] = useState<readonly EngagementGroup[]>([])
  const [picker, setPicker] = useState<{ open: boolean; editing: EngagementGroup | null }>({ open: false, editing: null })
  const [showing, setShowing] = useState<{ title: string; audience: Audience } | null>(null)

  const refresh = () => {
    void listEngagementGroupsAction()
      .then(setGroups)
      .catch(() => setGroups([]))
  }
  useEffect(refresh, [])

  const label = (a: Audience): string =>
    a.kind === 'segment'
      ? (segments.find((s) => s.key === a.key)?.label ?? '')
      : (groups.find((g) => g.id === a.id)?.name ?? '')

  // Groups arrive after the first paint, so the label is reported whenever either input changes —
  // otherwise a group selected before the list loaded would title the preview with an empty string.
  const current = label(audience)
  useEffect(() => {
    onLabel(current)
  }, [current, onLabel])

  return (
    <section className="space-y-3">
      {/* Gruplanmış rozetler. Başlıklar süs değil: biri KİM OLDUĞUNA, biri NE SATIN ALDIĞINA, biri
          NE YAPTIĞINA bakar — farklı sorular, farklı raflar. */}
      {SEGMENT_GROUPS.map((grup) => {
        const uyeler = grup.keys.map((k) => segments.find((s) => s.key === k)).filter((s): s is SegmentInfo => Boolean(s))
        if (uyeler.length === 0) return null
        return (
          <div key={grup.label} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{grup.label}</p>
            <div className="flex flex-wrap gap-2">
              {uyeler.map((s) => {
                const active = audience.kind === 'segment' && audience.key === s.key
                return (
                  <span key={s.key} className={`${chipClass(active)} ${s.count === 0 ? 'opacity-50' : ''}`}>
                    <button type="button" onClick={() => onAudience({ kind: 'segment', key: s.key })} className="inline-flex items-center gap-1.5">
                      <UsersIcon className="size-3.5" /> {s.label}
                    </button>
                    {/* The COUNT is the button. Tapping the label picks the audience; tapping the
                        number asks who they are — which is the question the number provokes. */}
                    <button
                      type="button"
                      onClick={() => setShowing({ title: s.label, audience: { kind: 'segment', key: s.key } })}
                      disabled={s.count === 0}
                      title={s.count === 0 ? 'Bu kitlede üye yok' : 'Kimler?'}
                      className="tabular-nums underline decoration-dotted underline-offset-2 opacity-70 transition-opacity hover:opacity-100 disabled:no-underline disabled:opacity-40"
                    >
                      ({s.count})
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Kendi listelerim <span className="font-normal normal-case tracking-normal">(elle seçilir, kendiliğinden güncellenmez)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const active = audience.kind === 'group' && audience.id === g.id
            return (
              <span key={g.id} className={chipClass(active)}>
                <button type="button" onClick={() => onAudience({ kind: 'group', id: g.id })} className="inline-flex items-center gap-1.5">
                  <UsersIcon className="size-3.5" /> {g.name}
                </button>
                <button
                  type="button"
                  onClick={() => setShowing({ title: g.name, audience: { kind: 'group', id: g.id } })}
                  disabled={g.liveCount === 0}
                  className="tabular-nums underline decoration-dotted underline-offset-2 opacity-70 hover:opacity-100 disabled:no-underline disabled:opacity-40"
                >
                  ({g.liveCount})
                </button>
                {canManage ? (
                  <button type="button" onClick={() => setPicker({ open: true, editing: g })} title="Düzenle" className="opacity-60 hover:opacity-100">
                    <PencilIcon className="size-3.5" />
                  </button>
                ) : null}
              </span>
            )
          })}
          {canManage ? (
            <button type="button" onClick={() => setPicker({ open: true, editing: null })} className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
              <UserPlusIcon className="size-3.5" /> Üye seçerek liste oluştur
            </button>
          ) : null}
          {groups.length === 0 && !canManage ? <p className="text-sm text-muted-foreground">Henüz grup yok.</p> : null}
        </div>
      </div>

      <AudienceMembersSheet
        open={showing !== null}
        title={showing?.title ?? ''}
        audience={showing?.audience ?? null}
        onClose={() => setShowing(null)}
      />

      {picker.open ? (
        <MemberPickerDialog
          editing={picker.editing}
          onClose={() => setPicker({ open: false, editing: null })}
          onSaved={(id) => {
            setPicker({ open: false, editing: null })
            refresh()
            onAudience({ kind: 'group', id })
          }}
          onDeleted={() => {
            setPicker({ open: false, editing: null })
            refresh()
            onAudience({ kind: 'segment', key: 'all' })
          }}
        />
      ) : null}

    </section>
  )
}

/** "(9)" tapped: the nine names. */
function AudienceMembersSheet({
  open,
  title,
  audience,
  onClose,
}: {
  open: boolean
  title: string
  audience: Audience | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<readonly { id: string; name: string }[] | null>(null)

  useEffect(() => {
    if (!open || !audience) return
    setRows(null)
    const input = audience.kind === 'segment' ? { segment: audience.key } : { groupId: audience.id }
    void audienceMembersAction(input)
      .then(setRows)
      .catch(() => setRows([]))
  }, [open, audience])

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{rows ? `${rows.length} üye` : 'Yükleniyor…'}</SheetDescription>
        </SheetHeader>
        <div className="space-y-1 overflow-y-auto px-4 pb-6">
          {rows === null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Bu kitlede üye yok.</p>
          ) : (
            rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm odd:bg-muted/40">
                <span className="w-6 shrink-0 tabular-nums text-xs text-muted-foreground">{i + 1}</span>
                <span className="truncate">{r.name}</span>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Pick members by hand and give the list a name. */
function MemberPickerDialog({
  editing,
  onClose,
  onSaved,
  onDeleted,
}: {
  editing: EngagementGroup | null
  onClose: () => void
  onSaved: (groupId: string) => void
  onDeleted: () => void
}) {
  const [all, setAll] = useState<readonly { id: string; name: string }[] | null>(null)
  const [query, setQuery] = useState('')
  const [name, setName] = useState(editing?.name ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set(editing?.memberIds ?? []))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pickableMembersAction()
      .then(setAll)
      .catch(() => setAll([]))
  }, [])

  const shown = useMemo(() => {
    if (!all) return []
    const q = foldTr(query.trim())
    return q === '' ? all : all.filter((m) => foldTr(m.name).includes(q))
  }, [all, query])

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    if (!name.trim()) {
      toast.error('Gruba bir isim ver.')
      return
    }
    if (picked.size === 0) {
      toast.error('En az bir üye seç.')
      return
    }
    setBusy(true)
    try {
      const res = await upsertEngagementGroupAction({
        ...(editing ? { id: editing.id } : {}),
        name: name.trim(),
        memberIds: [...picked],
      })
      if (res.ok) {
        toast.success(`"${name.trim()}" kaydedildi — ${picked.size} üye.`)
        onSaved(res.value.id)
      } else toast.error('Kaydedilemedi.')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    if (!confirm(`"${editing.name}" grubu silinsin mi? Üyeler silinmez, sadece bu liste kaldırılır.`)) return
    setBusy(true)
    try {
      const res = await deleteEngagementGroupAction({ id: editing.id })
      if (res.ok) {
        toast.success('Grup silindi.')
        onDeleted()
      } else toast.error('Silinemedi.')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Grubu düzenle' : 'Üye seç'}</DialogTitle>
          <DialogDescription>
            Elle seçtiğin üyelerden bir kitle oluştur. Kitle bölümüne gelir, oradan gönderim yaparsın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Grup adı</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Salı 10:00 grubu" className="h-11" />
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Üye ara" className="h-11 pl-9" autoComplete="off" />
          </div>
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {all === null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Üyeler yükleniyor…
            </p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Eşleşen üye yok.</p>
          ) : (
            shown.map((m) => (
              <label key={m.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted/60">
                <Checkbox checked={picked.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                <span className="truncate">{m.name}</span>
              </label>
            ))
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary tabular-nums">{picked.size} seçili</Badge>
            {editing ? (
              <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} className="text-danger">
                <Trash2Icon className="size-4" /> Sil
              </Button>
            ) : null}
          </div>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
