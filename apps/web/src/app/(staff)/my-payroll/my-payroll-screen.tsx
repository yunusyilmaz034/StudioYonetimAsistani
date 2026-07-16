'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import type { CompensationPlan, PayrollStatement, PayrollStatementDraft } from '@studio/core'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { EarningsBreakdown, monthPeriod, PeriodPicker, StatusPill, type Period } from '@/components/payroll/shared'
import { MODEL_LABEL } from '@/lib/payroll-labels'
import { myStatementAction } from '@/server/actions/payroll'

interface StatementLoad {
  readonly plan: CompensationPlan | null
  readonly periodKey: string
  readonly draft: PayrollStatementDraft | null
  readonly existing: PayrollStatement | null
}

export function MyPayrollScreen() {
  const [period, setPeriod] = useState<Period>(() => monthPeriod())
  const [load, setLoad] = useState<StatementLoad | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void myStatementAction({ periodStart: period.start, periodEnd: period.end }).then((r) => {
      if (alive) {
        setLoad(r as StatementLoad)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [period])

  const shown = load?.existing ? load.existing.draft : load?.draft ?? null
  const status: 'draft' | 'finalized' | 'paid' = load?.existing ? load.existing.status : 'draft'

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Hakedişim" description="Gerçekleşen derslerinden ve sana ait satışlardan hesaplanan hakedişin. Sadece kendi bilgilerini görürsün." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker onChange={setPeriod} />
        {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <Section
        title={period.label}
        {...(load?.plan ? { hint: MODEL_LABEL[load.plan.model] } : {})}
        {...(load ? { actions: <StatusPill status={status} /> } : {})}
      >
        {!load ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !load.plan ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Henüz bir ücret planın tanımlanmadı. Stüdyo yöneticisiyle görüşebilirsin.
          </p>
        ) : shown ? (
          <EarningsBreakdown draft={shown} />
        ) : (
          <p className="text-sm text-muted-foreground">Bu dönemde hesaplanan hakediş yok.</p>
        )}
      </Section>
    </main>
  )
}
