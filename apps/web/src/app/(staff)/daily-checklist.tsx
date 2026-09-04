'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SparklesIcon } from 'lucide-react'

import { Section } from '@/components/ui/section'
import type { InsightSeverity } from '@studio/core'
import type { AdvisorItem } from '@/server/advisor-query'
import { getChecklistDoneAction, narrateChecklistAction, recordLeadCallAction, setChecklistDoneAction } from '@/server/actions/checklist'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'

interface Row {
  id: string
  kind: string
  headline: string
  note: string
  severity: InsightSeverity
  href: string
  /** Grubun altına bir kez yazılan özet — satırın değil, grubun. */
  groupNote?: string
}

const ring = (s: InsightSeverity) =>
  s === 'urgent'
    ? 'border-danger/30 bg-danger/5 hover:bg-danger/10'
    : s === 'attention'
      ? 'border-warning/25 bg-warning/5 hover:bg-warning/10'
      : 'border-border bg-card hover:bg-muted/40'

// When several tasks are the SAME kind (five empty sessions, three overdue balances) they collapse into
// one titled line — "5 boş seans · doldur & pazarlama" — that expands on press. The desk sees one
// decision, not a wall of near-identical rows. A kind with a single task stays a plain row.
const GROUP_TITLE: Record<string, (n: number) => string> = {
  empty_session: (n) => `${n} boş seans · doldur & pazarlama`,
  outstanding_balance: (n) => `${n} açık bakiye · tahsilat`,
  expiring_soon: (n) => `${n} paket doluyor · yenileme`,
  expiring_with_credits: (n) => `${n} üyenin hakkı yanmak üzere · derse çağırın`,
  low_credit: (n) => `${n} üyenin ders hakkı azaldı`,
  dormant_member: (n) => `${n} üye uzaklaşıyor · bir arayın`,
  hot_lead: (n) => `${n} WhatsApp lead'i · dönüş yapın`,
  online_payment: (n) => `${n} sanal POS tahsilatı · bugün karttan geldi`,
}
const groupTitle = (kind: string, n: number) => (GROUP_TITLE[kind] ?? ((x: number) => `${x} iş`))(n)
const SEV_RANK: Record<InsightSeverity, number> = { urgent: 3, attention: 2, info: 1 }
const maxSeverity = (rows: readonly Row[]): InsightSeverity =>
  rows.reduce<InsightSeverity>((m, r) => (SEV_RANK[r.severity] > SEV_RANK[m] ? r.severity : m), 'info')

// "Bugün İlgilenmen Gerekenler" — the dashboard's focal point. It renders the deterministic advisor list
// immediately (so it never blocks) and, once the AI narrator answers, swaps in the warmer, re-prioritised
// version with a one-line briefing. Each item is a checkable task the desk can tick off for the day.
export function DailyChecklist({ items, snoozedCount = 0 }: { items: readonly AdvisorItem[]; snoozedCount?: number }) {
  const [intro, setIntro] = useState<string | null>(null)
  const [ai, setAi] = useState(false)
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => ({
      id: it.id,
      kind: it.kind,
      headline: it.title,
      note: it.detail,
      severity: it.severity,
      href: it.href,
      ...(it.groupNote ? { groupNote: it.groupNote } : {}),
    })),
  )
  // itemId → who closed it. Server-held (owner, 2026-08-05): the desk ticks and everyone sees it,
  // including the owner on his phone. It used to be `localStorage`, which made it a private note on
  // one machine.
  const [done, setDone] = useState<Map<string, string>>(new Map())
  // itemId → tikle bırakılan kısa not ("Arandı, açmadı"). Bugünün ekranı için; kalıcı kayıt lead'in
  // `Interaction` geçmişinde (owner, 2026-09-04).
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  // Hangi lead satırı için arama sonucu soruluyor.
  const [calling, setCalling] = useState<Row | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const dayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })

  useEffect(() => {
    void getChecklistDoneAction(dayKey)
      .then((rows) => {
        setDone(new Map(rows.map((r) => [r.itemId, r.byName])))
        setNotes(new Map(rows.flatMap((r) => (r.note ? [[r.itemId, r.note] as const] : []))))
      })
      .catch(() => {
        /* the list still works; it just shows nothing ticked */
      })
  }, [dayKey])

  useEffect(() => {
    if (items.length === 0) return
    let alive = true
    void narrateChecklistAction(items)
      .then((res) => {
        if (!alive || !res) return
        setIntro(res.intro)
        setAi(res.aiGenerated)
        // The AI narration is cached per time-slot, so reconcile it with the FRESH deterministic items:
        // keep the AI's order/phrasing for items that still exist, drop ones resolved since generation,
        // and append any new items (deterministically phrased) so the list is never stale within a slot.
        const currentIds = new Set(items.map((i) => i.id))
        const kindOf = new Map(items.map((i) => [i.id, i.kind]))
        const aiRows = res.items
          .filter((it) => currentIds.has(it.id))
          .map((it) => ({ id: it.id, kind: kindOf.get(it.id) ?? 'info', headline: it.headline, note: it.note, severity: it.severity, href: it.href }))
        const aiIds = new Set(res.items.map((it) => it.id))
        const newRows = items
          .filter((it) => !aiIds.has(it.id))
          .map((it) => ({ id: it.id, kind: it.kind, headline: it.title, note: it.detail, severity: it.severity, href: it.href }))
        setRows([...aiRows, ...newRows])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [items])

  function markDone(ids: readonly string[], undo = false) {
    // Optimistic: the tick lands under her finger and the server catches up. A checklist mark is the
    // cheapest thing in the product to be wrong about for half a second.
    const willUndo = undo || ids.every((id) => done.has(id))
    setDone((prev) => {
      const next = new Map(prev)
      for (const id of ids) {
        if (willUndo) next.delete(id)
        else next.set(id, '…')
      }
      return next
    })
    // `kind` rides along because the server decides from it whether the tick lasts the day or the
    // week — a call made to a drifting member is not work again tomorrow (owner, 2026-09-03).
    const kindOf = new Map(rows.map((r) => [r.id, r.kind]))
    void setChecklistDoneAction({ dayKey, items: ids.map((id) => ({ id, kind: kindOf.get(id) ?? 'info' })), done: !willUndo })
      .then((rows) => {
        setDone(new Map(rows.map((r) => [r.itemId, r.byName])))
        setNotes(new Map(rows.flatMap((r) => (r.note ? [[r.itemId, r.note] as const] : []))))
      })
      .catch(() => {
        toast.error('İşaret kaydedilemedi.')
      })
  }
  // LEAD SATIRINDA TİK, ÖNCE "NE OLDU" DİYE SORAR (owner, 2026-09-04). Geri alma sormaz: tiki
  // kaldırmak bir arama değildir.
  const toggle = (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (row?.kind === 'hot_lead' && !done.has(id)) {
      setCalling(row)
      return
    }
    markDone([id])
  }
  const toggleGroup = (kind: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  // A TICKED TASK STAYS ON THE LIST (owner, 2026-08-05).
  //
  // It used to vanish the moment it was checked, which made the list unreadable as work: reception
  // ticked two things and they were simply gone, so she could not tell what she had closed from what
  // had never been there. *"Resepsiyon to-do list gibi yaptım desin, tiklesin, gün sonunda görsün ne
  // kadar iş kapatmış."* A tick means "I did this", not "this never existed".
  //
  // It still resets overnight, and that was already true: `done` is keyed by the studio's date, so a
  // new day starts with an empty set and the day's work is not carried into it.
  const doneCount = rows.filter((r) => done.has(r.id)).length
  const allDone = rows.length > 0 && doneCount === rows.length

  // Group by kind, preserving the (AI-)ranked order of first appearance. Done rows keep their PLACE —
  // sinking them to the bottom would move the list under her hand while she is working down it.
  const order: string[] = []
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const g = groups.get(r.kind)
    if (g) g.push(r)
    else {
      groups.set(r.kind, [r])
      order.push(r.kind)
    }
  }

  return (
    <Section title="Bugün İlgilenmen Gerekenler">
      {ai ? (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <SparklesIcon className="size-3.5 text-primary" />
          AI asistan
        </div>
      ) : null}

      {intro ? <p className="mb-3 text-sm text-foreground">{intro}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
          Bugün acil bir şey yok — her şey yolunda. 🎉
        </p>
      ) : (
        <ul className="space-y-1.5">
          {order.map((kind) => {
            const children = groups.get(kind) ?? []
            // A single task of its kind → a plain, directly-actionable row.
            if (children.length === 1) return <TaskRow key={kind} r={children[0]!} onCheck={toggle} doneBy={done.get(children[0]!.id) ?? null} note={notes.get(children[0]!.id) ?? null} />

            // Several of a kind → one titled, collapsible line.
            const isOpen = openGroups.has(kind)
            const gsev = maxSeverity(children)
            const groupDone = children.filter((c) => done.has(c.id)).length
            const allChildrenDone = groupDone === children.length
            return (
              <li key={kind} className={`overflow-hidden rounded-xl border transition-colors ${ring(gsev)}`}>
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => markDone(children.map((c) => c.id), allChildrenDone)}
                    aria-label={allChildrenDone ? 'Tümünü geri al' : 'Tümünü tamamlandı olarak işaretle'}
                    title={allChildrenDone ? 'Tümünü geri al' : 'Tümünü tamamlandı olarak işaretle'}
                    className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors ${
                      allChildrenDone
                        ? 'border-success bg-success text-white'
                        : 'border-muted-foreground/50 hover:border-primary hover:bg-primary/10'
                    }`}
                  >
                    {allChildrenDone ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                  </button>
                  <button type="button" onClick={() => toggleGroup(kind)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className={`min-w-0 flex-1 font-medium ${allChildrenDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {groupTitle(kind, children.length)}
                    </span>
                    {/* How much of this group she has closed — the number she looks for at the end of
                        the day, without having to expand it. */}
                    {groupDone > 0 && !allChildrenDone ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{groupDone}/{children.length} tamam</span>
                    ) : null}
                    <ChevronDownIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {isOpen ? (
                  <>
                    <ul className="divide-y divide-border/50 border-t border-border/50 bg-background/40">
                      {children.map((r) => (
                        <TaskRow key={r.id} r={r} onCheck={toggle} nested doneBy={done.get(r.id) ?? null} note={notes.get(r.id) ?? null} />
                      ))}
                    </ul>
                    {/* Grubun özeti — SATIRIN değil (owner, 2026-09-01). Günün toplamı bir satırın
                        sonunda dururken, o satırda o kadar para çekilmiş gibi okunuyordu. */}
                    {children[0]?.groupNote ? (
                      <p className="border-t border-border/50 bg-background/40 px-4 py-2.5 text-xs text-muted-foreground">
                        {children[0].groupNote}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {/* An item that leaves the list silently is the same lie as one that will not leave: the desk
          cannot tell "handled" from "gone missing". So the week-long cooldown says its own name.
          (owner, 2026-09-03) */}
      {snoozedCount > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {snoozedCount} iş bu hafta arandığı için listede değil — hâlâ gerekiyorsa bir hafta sonra geri gelir.
        </p>
      ) : null}

      {doneCount > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {allDone ? 'Hepsini hallettin 👏 · ' : ''}
          {doneCount}/{rows.length} iş tamamlandı ·{' '}
          <button type="button" className="underline" onClick={() => markDone(rows.map((r) => r.id), true)}>
            sıfırla
          </button>
        </p>
      ) : null}
      {calling ? (
        <LeadCallDialog
          row={calling}
          dayKey={dayKey}
          onClose={() => setCalling(null)}
          onDone={(entries) => {
            setCalling(null)
            setDone(new Map(entries.map((e) => [e.itemId, e.byName])))
            setNotes(new Map(entries.flatMap((e) => (e.note ? [[e.itemId, e.note] as const] : []))))
          }}
        />
      ) : null}
    </Section>
  )
}

// One task line — a checkbox to tick it off and a deep link to the tool that resolves it. `nested` drops
// its own border/rounding so it reads as a child inside an expanded group.
function TaskRow({ r, onCheck, nested, doneBy = null, note = null }: { r: Row; onCheck: (id: string) => void; nested?: boolean; doneBy?: string | null; note?: string | null }) {
  const done = doneBy !== null
  return (
    <li
      className={
        nested
          ? `flex items-start gap-2.5 px-3 py-2 text-sm ${done ? 'opacity-55' : ''}`
          : `flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${done ? 'border-border opacity-55' : ring(r.severity)}`
      }
    >
      {/* Done keeps its colour tone but loses its alarm: the border drops back to plain and the row
          dims. It is still there, still tappable to undo — a tick is reversible, a disappearance is not. */}
      <button
        type="button"
        onClick={() => onCheck(r.id)}
        aria-label={done ? 'Geri al' : 'Tamamlandı olarak işaretle'}
        title={done ? 'Geri al' : 'Tamamlandı olarak işaretle'}
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors ${
          done ? 'border-success bg-success text-white' : 'border-muted-foreground/50 hover:border-primary hover:bg-primary/10'
        }`}
      >
        {done ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
      </button>
      <Link href={r.href} className="flex min-w-0 flex-1 items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className={`font-medium ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{r.headline}</span>
          {r.note ? <span className="text-muted-foreground"> {r.note}</span> : null}
          {/* Who closed it — the point of moving these off one machine (owner, 2026-08-05). */}
          {done && doneBy ? <span className="ml-1 text-xs text-success">· {doneBy}</span> : null}
          {note ? <span className="ml-1 text-xs text-primary">· {note}</span> : null}
        </span>
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

// ── ARAMA SONUCU (owner, 2026-09-04) ────────────────────────────────────────────────────────
//
// *"Bunlara not ekleyebilsin: aradım açmadı, aradım gelecek gibi."*
//
// Üç düğme, çünkü resepsiyonun günde kırk kez yapacağı bir iş yazı işine dönüştürülemez. Not
// İSTEĞE BAĞLI: boş bırakılırsa sonucun kendisi yazılıyor ("Arandı, açmadı"). Zorunlu bir metin
// alanı, üç tıkla biten işi bir forma çevirir ve o form doldurulmadığı için kayıt hiç tutulmaz.
//
// Kalıcı kayıt lead'in `Interaction` geçmişine gidiyor (kind `call` + outcome) — bir hafta sonra
// satır geri geldiğinde "geçen sefer ne olmuştu" sorusunun cevabı orada.
function LeadCallDialog({
  row,
  dayKey,
  onClose,
  onDone,
}: {
  row: Row
  dayKey: string
  onClose: () => void
  onDone: (entries: readonly { itemId: string; byName: string; note?: string }[]) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Satır kimliği `wa:{telefon}` — lead kimliği burada yok, sunucu telefondan buluyor.
  const phone = row.id.startsWith('wa:') ? row.id.slice(3) : ''

  async function kaydet(outcome: 'reached' | 'no_answer' | 'callback') {
    setBusy(true)
    try {
      const entries = await recordLeadCallAction({ dayKey, itemId: row.id, phone, outcome, note })
      toast.success('Arama kaydedildi.')
      onDone(entries)
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Arama sonucu</DialogTitle>
          <DialogDescription className="truncate">{row.headline}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Not (isteğe bağlı)</label>
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ör. cumartesi gelecek · eşiyle konuşacak"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="outline" disabled={busy} onClick={() => void kaydet('no_answer')}>
            Açmadı
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void kaydet('callback')}>
            Gelecek
          </Button>
          <Button disabled={busy} onClick={() => void kaydet('reached')}>
            Görüşüldü
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Arama lead’in geçmişine kaydedilir. Satır bir hafta listede çıkmaz; hâlâ sessizse geri gelir.
        </p>
      </DialogContent>
    </Dialog>
  )
}
