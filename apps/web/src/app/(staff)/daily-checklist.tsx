'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, SparklesIcon } from 'lucide-react'

import { Section } from '@/components/ui/section'
import type { InsightSeverity } from '@studio/core'
import type { AdvisorItem } from '@/server/advisor-query'
import { narrateChecklistAction } from '@/server/actions/checklist'

interface Row {
  id: string
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

// "Bugün İlgilenmen Gerekenler" — the dashboard's focal point. It renders the deterministic advisor list
// immediately (so it never blocks) and, once the AI narrator answers, swaps in the warmer, re-prioritised
// version with a one-line briefing. Each item is a checkable task the desk can tick off for the day.
export function DailyChecklist({ items }: { items: readonly AdvisorItem[] }) {
  const [intro, setIntro] = useState<string | null>(null)
  const [ai, setAi] = useState(false)
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((it) => ({ id: it.id, headline: it.title, note: it.detail, severity: it.severity, href: it.href })),
  )
  const [done, setDone] = useState<Set<string>>(new Set())

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
        const aiRows = res.items
          .filter((it) => currentIds.has(it.id))
          .map((it) => ({ id: it.id, headline: it.headline, note: it.note, severity: it.severity, href: it.href }))
        const aiIds = new Set(res.items.map((it) => it.id))
        const newRows = items
          .filter((it) => !aiIds.has(it.id))
          .map((it) => ({ id: it.id, headline: it.title, note: it.detail, severity: it.severity, href: it.href }))
        setRows([...aiRows, ...newRows])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [items])

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const visible = rows.filter((r) => !done.has(r.id))
  const doneCount = rows.length - visible.length

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
          {visible.map((r) => (
            <li key={r.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${ring(r.severity)}`}>
              <button
                type="button"
                onClick={() => toggle(r.id)}
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
          ))}
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
