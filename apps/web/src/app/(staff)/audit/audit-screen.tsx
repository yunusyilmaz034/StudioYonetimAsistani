'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2Icon, ShieldIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { fieldLabel, present } from '@/lib/activity/present'
import { formatDateTime } from '@/lib/datetime'
import { auditAction } from '@/server/actions/activity'
import type { ActivityEvent, ActivityPage } from '@/server/activity-query'

// Kim · ne yaptı · ne zaman · eski değer → yeni değer · İşlem No.
//
// I-30 — a screen never invents a fact the log does not have. An event written before 2026-07-13
// carries no before/after: the previous value was never recorded, and no engineering produces one.
// Those rows say so, in one quiet line. A log that guesses is worse than a log with gaps, because
// you cannot tell which rows are guesses.

interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'açık' : 'kapalı'
  if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} kayıt`
  return String(v)
}

export function AuditScreen({ initial }: { initial: ActivityPage }) {
  const [entries, setEntries] = useState<readonly ActivityEvent[]>(initial.entries)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [pending, start] = useTransition()

  const more = () =>
    start(async () => {
      const page = await auditAction({ cursor })
      setEntries((prev) => [...prev, ...page.entries])
      setCursor(page.nextCursor)
    })

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Denetim Kaydı" description="Kim, neyi, ne zaman değiştirdi." />

      {entries.length === 0 ? (
        <EmptyState icon={ShieldIcon} title="Kayıt yok" description="Henüz denetlenecek bir değişiklik yapılmadı." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {entries.map((e) => {
            const p = present(e)
            const changes = (e.payload.changes as FieldChange[] | undefined) ?? []
            return (
              <article key={e.eventId} className="space-y-1.5 px-3 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-muted-foreground">
                  <span>{formatDateTime(e.occurredAt)}</span>
                  <span className="font-medium text-foreground">{e.actorName}</span>
                  <Link
                    href={`/operations/${e.operationId}`}
                    className="ml-auto rounded px-1 font-mono text-[0.6875rem] transition-colors hover:bg-muted hover:text-primary"
                  >
                    {e.operationId.slice(-6)}
                  </Link>
                </p>
                <p className="text-sm font-medium text-foreground">{p.title}</p>
                {p.detail ? <p className="text-xs text-muted-foreground">{p.detail}</p> : null}

                {changes.length > 0 ? (
                  <ul className="space-y-0.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
                    {changes.map((c) => (
                      <li key={c.field} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{fieldLabel(c.field)}:</span>{' '}
                        <span className="line-through">{show(c.from)}</span> → <span className="text-foreground">{show(c.to)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground/70">
                    Bu kayıt için eski/yeni değer bilgisi tutulmamış.
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}

      {cursor ? (
        <Button variant="outline" className="w-full" onClick={more} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          Daha eski kayıtlar
        </Button>
      ) : null}
    </main>
  )
}
