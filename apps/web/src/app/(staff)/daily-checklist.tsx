'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon, SparklesIcon } from 'lucide-react'

import { Section } from '@/components/ui/section'
import type { InsightSeverity } from '@studio/core'
import type { AdvisorItem } from '@/server/advisor-query'
import { narrateChecklistAction } from '@/server/actions/checklist'

interface Row {
  id: string
  kind: string
  headline: string
  note: string
  severity: InsightSeverity
  href: string
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
  low_credit: (n) => `${n} üyenin ders hakkı azaldı`,
  dormant_member: (n) => `${n} üye uzaklaşıyor · bir arayın`,
  hot_lead: (n) => `${n} sıcak WhatsApp lead'i · dönüş yapın`,
}
const groupTitle = (kind: string, n: number) => (GROUP_TITLE[kind] ?? ((x: number) => `${x} iş`))(n)
const SEV_RANK: Record<InsightSeverity, number> = { urgent: 3, attention: 2, info: 1 }
const maxSeverity = (rows: readonly Row[]): InsightSeverity =>
  rows.reduce<InsightSeverity>((m, r) => (SEV_RANK[r.severity] > SEV_RANK[m] ? r.severity : m), 'info')

// "Bugün İlgilenmen Gerekenler" — the dashboard's focal point. It renders the deterministic advisor list
// immediately (so it never blocks) and, once the AI narrator answers, swaps in the warmer, re-prioritised
// version with a one-line briefing. Each item is a checkable task the desk can tick off for the day.
export function DailyChecklist({ items }: { items: readonly AdvisorItem[] }) {
  const [intro, setIntro] = useState<string | null>(null)
  const [ai, setAi] = useState(false)
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => ({ id: it.id, kind: it.kind, headline: it.title, note: it.detail, severity: it.severity, href: it.href })),
  )
  const [done, setDone] = useState<Set<string>>(new Set())
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const dayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
  const storeKey = `checklist-done:${dayKey}`

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) setDone(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* localStorage unavailable — dismissals just won't persist */
    }
  }, [storeKey])

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
    setDone((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (undo) next.delete(id)
        else if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const toggle = (id: string) => markDone([id])
  const toggleGroup = (kind: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  const visible = rows.filter((r) => !done.has(r.id))
  const doneCount = rows.length - visible.length

  // Group the remaining tasks by kind, preserving the (AI-)ranked order of first appearance.
  const order: string[] = []
  const groups = new Map<string, Row[]>()
  for (const r of visible) {
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
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
          Hepsini hallettin. 👏{' '}
          <button type="button" className="underline" onClick={() => setDone(new Set())}>
            Listeyi geri getir
          </button>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {order.map((kind) => {
            const children = groups.get(kind) ?? []
            // A single task of its kind → a plain, directly-actionable row.
            if (children.length === 1) return <TaskRow key={kind} r={children[0]!} onCheck={toggle} />

            // Several of a kind → one titled, collapsible line.
            const isOpen = openGroups.has(kind)
            const gsev = maxSeverity(children)
            return (
              <li key={kind} className={`overflow-hidden rounded-xl border transition-colors ${ring(gsev)}`}>
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => markDone(children.map((c) => c.id))}
                    aria-label="Tümünü tamamlandı olarak işaretle"
                    title="Tümünü tamamlandı olarak işaretle"
                    className="size-4 shrink-0 rounded-[5px] border-2 border-muted-foreground/50 transition-colors hover:border-primary hover:bg-primary/10"
                  />
                  <button type="button" onClick={() => toggleGroup(kind)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="min-w-0 flex-1 font-medium text-foreground">{groupTitle(kind, children.length)}</span>
                    <ChevronDownIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {isOpen ? (
                  <ul className="divide-y divide-border/50 border-t border-border/50 bg-background/40">
                    {children.map((r) => (
                      <TaskRow key={r.id} r={r} onCheck={toggle} nested />
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {doneCount > 0 && visible.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {doneCount} iş tamamlandı ·{' '}
          <button type="button" className="underline" onClick={() => setDone(new Set())}>
            sıfırla
          </button>
        </p>
      ) : null}
    </Section>
  )
}

// One task line — a checkbox to tick it off and a deep link to the tool that resolves it. `nested` drops
// its own border/rounding so it reads as a child inside an expanded group.
function TaskRow({ r, onCheck, nested }: { r: Row; onCheck: (id: string) => void; nested?: boolean }) {
  return (
    <li className={nested ? 'flex items-start gap-2.5 px-3 py-2 text-sm' : `flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${ring(r.severity)}`}>
      <button
        type="button"
        onClick={() => onCheck(r.id)}
        aria-label="Tamamlandı olarak işaretle"
        title="Tamamlandı olarak işaretle"
        className="mt-0.5 size-4 shrink-0 rounded-[5px] border-2 border-muted-foreground/50 transition-colors hover:border-primary hover:bg-primary/10"
      />
      <Link href={r.href} className="flex min-w-0 flex-1 items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{r.headline}</span>
          {r.note ? <span className="text-muted-foreground"> {r.note}</span> : null}
        </span>
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}
