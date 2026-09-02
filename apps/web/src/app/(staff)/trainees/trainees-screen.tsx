'use client'

import { foldTr } from '@/lib/fold-tr'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, SearchIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import type { TraineePackage, TraineeRow } from '@/server/trainee-query'

// The trainer's member list. She is on a phone, between two classes, looking for one name — so the
// screen is a search box and a column of tappable rows, and nothing else. No filters, no columns, no
// bulk actions: those belong to reception's day, and she does not have reception's day.

/** "Reformer 8 Ders · 5 ders" — what a lesson is planned against, in one glance. */
function PaketRozeti({ p }: { p: TraineePackage }) {
  const kalan = p.creditsAvailable === null ? `${p.remainingDays} gün` : `${p.creditsAvailable} ders`
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{p.name}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{kalan}</span>
    </span>
  )
}

export function TraineesScreen({ rows }: { rows: readonly TraineeRow[] }) {
  const [query, setQuery] = useState('')

  const gorunen = useMemo(() => {
    const q = foldTr(query.trim())
    if (q === '') return rows
    return rows.filter((r) => foldTr(r.fullName).includes(q))
  }, [rows, query])

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Üyeler"
        description="Üyenin antrenman programı, ölçümleri ve aktif paketi. Telefon, ödeme ve paket geçmişi bu ekranda yoktur."
      />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Üye ara"
          aria-label="Üye ara"
          className="h-11 pl-9"
          autoComplete="off"
        />
      </div>

      {gorunen.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={query.trim() === '' ? 'Üye yok' : 'Eşleşen üye yok'}
          description={query.trim() === '' ? 'Stüdyoda kayıtlı üye bulunamadı.' : `"${query.trim()}" için sonuç yok.`}
        />
      ) : (
        <div className="space-y-2">
          {gorunen.map((r) => (
            <Card key={r.id} className="transition-colors hover:border-primary/40">
              {/* The whole row is the target — a thumb does not aim at a link inside a card. */}
              <Link href={`/trainees/${r.id}`} className="block">
                <CardContent className="flex min-h-14 items-center gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="truncate font-medium text-foreground">{r.fullName}</div>
                    {r.packages.length === 0 ? (
                      <Badge className="bg-muted text-muted-foreground">Aktif paketi yok</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.packages.map((p) => (
                          <PaketRozeti key={`${p.name}-${p.validUntil}`} p={p} />
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {gorunen.length} üye{query.trim() === '' ? '' : ` (${rows.length} içinden)`}
      </p>
    </main>
  )
}
