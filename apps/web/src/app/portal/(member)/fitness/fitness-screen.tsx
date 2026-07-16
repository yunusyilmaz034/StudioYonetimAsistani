'use client'

import { FlameIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { Section } from '@/components/ui/section'
import type { MemberFitness } from '@/server/fitness-query'

const TZ = 'Europe/Istanbul'
const DAY_MS = 86_400_000
const dayLabel = (epochDay: number) =>
  new Date(epochDay * DAY_MS).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const visitLabel = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })

// Her own coming-and-going. Encouraging, never a scoreboard against others: the streak celebrates
// consistency, and an empty history invites rather than scolds.
export function PortalFitnessScreen({ data }: { data: MemberFitness }) {
  const { stats, recent } = data
  const hasHistory = stats.totalVisitDays > 0

  return (
    <main className="mx-auto max-w-lg space-y-6 p-4 pb-8">
      <div>
        <h1 className="text-display font-semibold text-foreground">Katılımım</h1>
        <p className="text-sm text-muted-foreground">Stüdyoya gelişlerin ve serilerin.</p>
      </div>

      <MetricStrip>
        <Metric label="Bu hafta" value={stats.currentWeekVisits} />
        <Metric label="Toplam ziyaret" value={stats.totalVisitDays} />
        <Metric
          label="Güncel seri"
          value={`${stats.currentStreakWeeks} hf`}
          icon={FlameIcon}
          tone={stats.currentStreakWeeks > 0 ? 'success' : 'default'}
        />
        <Metric label="En uzun seri" value={`${stats.longestStreakWeeks} hf`} />
      </MetricStrip>

      {stats.lastVisitEpochDay != null ? (
        <p className="text-sm text-muted-foreground">
          Son ziyaretin: <span className="font-medium text-foreground">{dayLabel(stats.lastVisitEpochDay)}</span>
        </p>
      ) : null}

      <Section title="Son gelişlerim">
        {!hasHistory ? (
          <Card>
            <CardContent className="py-1 text-sm text-muted-foreground">
              Henüz bir giriş kaydın yok. İlk ziyaretinle serin başlar.
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
            {recent.map((ms, i) => (
              <li key={i} className="flex items-center gap-2 px-4 py-2.5">
                <span className="size-1.5 shrink-0 rounded-full bg-success" />
                <span className="capitalize text-foreground">{visitLabel(ms)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  )
}
