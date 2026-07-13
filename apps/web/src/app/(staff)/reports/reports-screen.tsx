'use client'

import { DownloadIcon, PrinterIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { downloadCsv } from '@/lib/export/csv'
import { REPORTS, TIME_NOTE, type ReportId } from '@/lib/reports/catalog'
import { RANGES, resolveRange, type RangeId } from '@/lib/ranges'
import { loadReportAction, type ReportResult } from '@/server/actions/reports'

// THE REPORTS SCREEN (v1.27 S6) — one screen, seven reports, one range, one export.
//
// The summary sentence is the point of the page. A report is a wall of rows; the sentence above it is
// what the owner actually reads — "23 satış · 41.500 ₺ anlaşıldı · 12.000 ₺ bekliyor" — and the rows
// are there for when she does not believe it.
//
// Printing is `window.print()` and a stylesheet, not a PDF writer. She prints the day-end and puts it
// in the drawer; that is the whole requirement, and a PDF library to satisfy it would be a dependency
// bought for nothing.

export function ReportsScreen() {
  const [id, setId] = useState<ReportId>('dayend')
  const [rangeId, setRangeId] = useState<RangeId>('today')
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({})
  const [result, setResult] = useState<ReportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spec = REPORTS.find((r) => r.id === id)!

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setBusy(true)
      setError(null)
      try {
        const range = resolveRange(rangeId, Date.now(), custom)
        const res = await loadReportAction({ id, fromMs: range.fromMs, toMs: range.toMs })
        if (!cancelled) setResult(res)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Rapor yüklenemedi.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id, rangeId, custom])

  const table = result?.table

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="print:hidden">
        <PageHeader
          title="Raporlar"
          description={spec.question}
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()} disabled={!table}>
                <PrinterIcon />
                <span className="hidden sm:inline">Yazdır</span>
              </Button>
              <Button
                variant="outline"
                disabled={!table || table.rows.length === 0}
                onClick={() => table && downloadCsv(table)}
              >
                <DownloadIcon />
                CSV
              </Button>
            </>
          }
        />
      </div>

      {/* The report picker. Seven buttons, not a dropdown: she is choosing between things she can see. */}
      <div className="flex flex-wrap gap-2 print:hidden">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setId(r.id)}
            className={`min-h-11 rounded-lg border px-3 text-sm transition-colors ${
              r.id === id
                ? 'border-primary bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* The range. It is DISABLED for the report that ignores it — a date picker that silently does
          nothing makes the reader believe a number is about a period when it is about today. */}
      <div className="space-y-2 print:hidden">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={spec.time === 'state'}
              onClick={() => setRangeId(r.id)}
              className={`min-h-10 rounded-lg border px-3 text-sm transition-colors disabled:opacity-40 ${
                r.id === rangeId && spec.time !== 'state'
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeId === 'custom' && spec.time !== 'state' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-auto"
              value={custom.from ?? ''}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">—</span>
            <Input
              type="date"
              className="w-auto"
              value={custom.to ?? ''}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{TIME_NOTE[spec.time]}</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* The sentence. This is what she reads; the table is what she checks it against. */}
      {result ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground print:text-sm">{spec.label}</p>
          <p className="mt-1 text-base font-medium">{result.summary}</p>
        </div>
      ) : null}

      {busy ? <p className="text-sm text-muted-foreground print:hidden">Yükleniyor…</p> : null}

      {table && table.rows.length === 0 && !busy ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Bu aralıkta kayıt yok.
        </div>
      ) : null}

      {table && table.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2 whitespace-nowrap ${
                        typeof cell === 'number' ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {typeof cell === 'number'
                        ? cell.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
                        : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}
