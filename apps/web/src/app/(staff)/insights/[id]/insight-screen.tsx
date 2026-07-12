'use client'

import Link from 'next/link'
import { ArrowLeftIcon, DownloadIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { downloadCsv } from '@/lib/export/csv'
import type { ExportableTable } from '@/lib/widgets/contract'
import { InboxIcon } from 'lucide-react'

// Generic, because a report IS columns and rows. Excel and PDF will be writers over the same
// `ExportableTable` — not a second screen (owner, v1.23).
export function InsightScreen({
  title,
  headline,
  detail,
  table,
}: {
  title: string
  headline: string
  detail: string | null
  table: ExportableTable
}) {
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={title}
        description={detail ? `${headline} ${detail}` : headline}
        actions={
          <>
            <Button variant="outline" render={<Link href="/" />}>
              <ArrowLeftIcon />
              <span className="hidden sm:inline">Genel Görünüm</span>
            </Button>
            <Button
              variant="outline"
              disabled={table.rows.length === 0}
              onClick={() => downloadCsv(table)}
            >
              <DownloadIcon />
              CSV
            </Button>
          </>
        }
      />

      {table.rows.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Kayıt yok" description="Bu listede şu an kayıt yok." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.rows.map((row, i) => (
                <tr key={i} className="transition-colors hover:bg-primary-soft/30">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2.5 ${j === 0 ? 'font-medium text-foreground' : 'tabular-nums text-muted-foreground'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
