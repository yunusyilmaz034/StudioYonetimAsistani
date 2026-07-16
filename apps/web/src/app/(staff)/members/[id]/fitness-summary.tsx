'use client'

import { useEffect, useState } from 'react'
import { CalendarCheckIcon, FlameIcon } from 'lucide-react'

import { Metric, MetricStrip } from '@/components/ui/metric'
import { Section } from '@/components/ui/section'
import { memberFitnessAction } from '@/server/actions/fitness'
import type { MemberFitness } from '@/server/fitness-query'

const DAY_MS = 86_400_000
// An epoch-day is a studio-local calendar day; rendering its UTC midnight with timeZone UTC gives
// back exactly that calendar date, with no offset drift.
const dayLabel = (epochDay: number) =>
  new Date(epochDay * DAY_MS).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })

// The member's consistency, on her card. Operational (did she keep coming?), not private training
// content — so it lives in the Check-in tab, for owner + reception. Lazy-loaded on mount.
export function MemberFitnessSummary({ memberId }: { memberId: string }) {
  const [data, setData] = useState<MemberFitness | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    memberFitnessAction({ memberId })
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [memberId])

  const s = data?.stats
  return (
    <Section title="Katılım özeti" hint="son 180 gün">
      <MetricStrip>
        <Metric label="Bu hafta" value={loading ? '…' : (s?.currentWeekVisits ?? 0)} />
        <Metric label="Toplam ziyaret" value={loading ? '…' : (s?.totalVisitDays ?? 0)} icon={CalendarCheckIcon} />
        <Metric
          label="Güncel seri"
          value={loading ? '…' : `${s?.currentStreakWeeks ?? 0} hf`}
          icon={FlameIcon}
          tone={(s?.currentStreakWeeks ?? 0) > 0 ? 'success' : 'default'}
        />
        <Metric
          label="Son ziyaret"
          value={loading ? '…' : s?.lastVisitEpochDay != null ? dayLabel(s.lastVisitEpochDay) : '—'}
        />
      </MetricStrip>
    </Section>
  )
}
