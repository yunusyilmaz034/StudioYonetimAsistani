'use client'

import Link from 'next/link'
import { CalendarOffIcon, LayersIcon, PackagePlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { formatDateTime } from '@/lib/datetime'

// The record of every destructive act the studio has taken. This screen exists because "what did
// we do in July?" is a question that gets asked — usually by a member who noticed.

const STATUS: Record<string, { label: string; className: string }> = {
  planned: { label: 'Planlandı', className: 'bg-muted text-muted-foreground' },
  applying: { label: 'Uygulanıyor', className: 'bg-warning/10 text-warning' },
  applied: { label: 'Uygulandı', className: 'bg-success/10 text-success' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
}
const REASON: Record<string, string> = {
  gift: 'Hediye',
  correction: 'Düzeltme',
  migration: 'Aktarım',
  support: 'Destek',
}
// OP-1 — the full timestamp, to the second.
const dt = formatDateTime

interface ClosureRow {
  id: string
  operationId: string
  dateFrom: string
  dateTo: string
  reason: string
  status: string
  extensionDays: number
  appliedAt: number | null
  summary: {
    sessionsCancelled: number
    reservationsReleased: number
    creditsReleased: number
    entitlementsExtended: number
    blockedSessions: number
  } | null
}
interface BulkRow {
  id: string
  operationId: string
  action: string
  amount: number
  reason: string
  note: string
  status: string
  appliedAt: number | null
  summary: { entitlementsAffected: number; membersAffected: number; skippedFrozen: number } | null
}

export function OperationsScreen({
  closures,
  bulk,
}: {
  closures: readonly ClosureRow[]
  bulk: readonly BulkRow[]
}) {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Operasyonlar"
        description="Kapanışlar ve toplu paket işlemleri"
        actions={
          <>
            <Button variant="outline" render={<Link href="/operations/bulk" />}>
              <PackagePlusIcon />
              <span className="hidden sm:inline">Toplu İşlem</span>
            </Button>
            <Button className="min-h-11 sm:min-h-0" render={<Link href="/operations/closures/new" />}>
              <CalendarOffIcon />
              Kapanış
            </Button>
          </>
        }
      />

      <Section title="Kapanış işlemleri">
        {closures.length === 0 ? (
          <EmptyState
            icon={CalendarOffIcon}
            title="Kapanış işlemi yok"
            description="Stüdyo Takvimi’nden bir kapanış günü işaretleyip etki analizi oluşturabilirsiniz."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {closures.map((c) => (
              <li key={c.id} className="px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>
                      {c.dateFrom} – {c.dateTo}
                    </span>
                    <Badge className={STATUS[c.status]?.className ?? ''}>{STATUS[c.status]?.label}</Badge>
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {c.appliedAt ? dt(c.appliedAt) : '—'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{c.reason}</p>
                {/* OP-2 — the operation id. Every event this closure wrote carries it; it is how
                    the Activity Center (v1.25) will answer "what else did this do?". */}
                <p className="font-mono text-[0.6875rem] text-muted-foreground/80">{c.operationId}</p>
                {c.summary ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.summary.sessionsCancelled} seans iptal · {c.summary.reservationsReleased}{' '}
                    rezervasyon · <span className="font-medium text-foreground">{c.summary.creditsReleased} kredi iade</span> ·{' '}
                    {c.summary.entitlementsExtended} paket +{c.extensionDays} gün
                    {c.summary.blockedSessions > 0 ? (
                      <span className="text-danger"> · {c.summary.blockedSessions} seans bloklandı</span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Toplu paket işlemleri">
        {bulk.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title="Toplu işlem yok"
            description="Süre uzatma veya kredi ekleme işlemleri burada görünür."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {bulk.map((b) => (
              <li key={b.id} className="px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>
                      {b.action === 'extend_days' ? `+${b.amount} gün` : `+${b.amount} kredi`}
                    </span>
                    <Badge className="bg-muted text-muted-foreground">{REASON[b.reason] ?? b.reason}</Badge>
                    <Badge className={STATUS[b.status]?.className ?? ''}>{STATUS[b.status]?.label}</Badge>
                  </p>
                  <span className="text-xs text-muted-foreground">{b.appliedAt ? dt(b.appliedAt) : '—'}</span>
                </div>
                <p className="text-xs text-muted-foreground">{b.note}</p>
                <p className="font-mono text-[0.6875rem] text-muted-foreground/80">{b.operationId}</p>
                {b.summary ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {b.summary.entitlementsAffected} paket · {b.summary.membersAffected} üye
                    {b.summary.skippedFrozen > 0 ? (
                      <span className="text-warning"> · {b.summary.skippedFrozen} dondurulmuş atlandı</span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  )
}
