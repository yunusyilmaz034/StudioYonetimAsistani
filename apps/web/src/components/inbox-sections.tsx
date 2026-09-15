'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { HistoryIcon, Loader2Icon } from 'lucide-react'

import { listOlderConversationsAction, type Inbox, type InboxItem } from '@/server/actions/conversations'

// REKLAM DÖNEMİ AYRAÇLARI (owner, 2026-09-15) — Sohbetler ekranı ve WP Hattı aynı bölümleri çizer.
// Bkz. `listInboxAction`.

/** "15 Eylül reklamı" → "15 Eylül reklamından gelenler". Başka bir adda sade bir kalıp. */
export function periodTitle(label: string): string {
  const l = label.trim()
  return /reklamı$/i.test(l) ? `${l.slice(0, -1)}ından gelenler` : `${l} döneminde gelenler`
}

/** Eski konuşmalar yalnızca istenince yüklenir; mevcut listeye yeniden düşen (yeni yazan) çıkarılır. */
export function useOlderConversations(period: Inbox['period']) {
  const [older, setOlder] = useState<readonly InboxItem[] | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    if (!period) return
    setBusy(true)
    try {
      const before = older && older.length > 0 ? older[older.length - 1]!.lastAt : period.startedAt
      const page = await listOlderConversationsAction({ before })
      setOlder([...(older ?? []), ...page])
      if (page.length < 50) setDone(true)
    } catch {
      /* düğme yerinde kalır; tekrar denenebilir */
    }
    setBusy(false)
  }
  return { older, done, busy, load }
}

type Section = { key: string; title: string | null; rows: readonly InboxItem[] }

export function inboxSections(items: readonly InboxItem[], older: readonly InboxItem[] | null, period: Inbox['period']): Section[] {
  if (!period) return [{ key: 'all', title: null, rows: items }]
  const mevcut = new Set(items.map((c) => c.phone))
  return [
    { key: 'new', title: periodTitle(period.label), rows: items.filter((c) => c.group === 'new') },
    { key: 'known', title: 'Önceden tanıdıklarımız — bu dönemde yazanlar', rows: items.filter((c) => c.group === 'known') },
    { key: 'older', title: 'Önceki konuşmalar', rows: (older ?? []).filter((c) => !mevcut.has(c.phone)) },
  ]
}

/** Bölümleri `<li>` olarak çizer (başlık + satırlar). Boş bölüm çizilmez. */
export function InboxSectionList({
  sections,
  filter = () => true,
  renderRow,
}: {
  sections: readonly Section[]
  filter?: (c: InboxItem) => boolean
  renderRow: (c: InboxItem) => ReactNode
}) {
  return (
    <>
      {sections.map((s) => {
        const rows = s.rows.filter(filter)
        if (rows.length === 0) return null
        return (
          <Fragment key={s.key}>
            {s.title ? (
              <li className="sticky top-0 z-10 border-b border-border bg-muted/90 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">
                {s.title} <span className="tabular-nums">· {rows.length}</span>
              </li>
            ) : null}
            {rows.map((c) => renderRow(c))}
          </Fragment>
        )
      })}
    </>
  )
}

export function OlderConversationsButton({ state }: { state: ReturnType<typeof useOlderConversations> }) {
  if (state.done) return <p className="px-3 py-3 text-center text-xs text-muted-foreground">Daha eski konuşma yok.</p>
  return (
    <div className="px-3 py-3 text-center">
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void state.load()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:opacity-60"
      >
        {state.busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <HistoryIcon className="size-3.5" />}
        {state.older === null ? 'Eski konuşmaları getir' : 'Daha eski konuşmaları getir'}
      </button>
    </div>
  )
}
