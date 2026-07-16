import Link from 'next/link'
import { ArrowRightIcon, LightbulbIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import type { InsightSeverity } from '@studio/core'

import type { AdvisorItem } from '@/server/advisor-query'

const SEVERITY: Record<InsightSeverity, { label: string; badge: 'destructive' | 'amber' | 'secondary' }> = {
  urgent: { label: 'Acil', badge: 'destructive' },
  attention: { label: 'Dikkat', badge: 'amber' },
  info: { label: 'Bilgi', badge: 'secondary' },
}
const ORDER: readonly InsightSeverity[] = ['urgent', 'attention', 'info']

function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const s = SEVERITY[severity]
  if (s.badge === 'amber') {
    return <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">{s.label}</Badge>
  }
  return <Badge variant={s.badge}>{s.label}</Badge>
}

export function AdvisorScreen({ items }: { items: readonly AdvisorItem[] }) {
  const groups = ORDER.map((sev) => ({ sev, rows: items.filter((i) => i.severity === sev) })).filter((g) => g.rows.length > 0)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Öneriler"
        description={
          items.length > 0
            ? `Bugün öne çıkan ${items.length} konu. Bunlar öneridir — kararı siz verirsiniz, hiçbir işlem otomatik yapılmaz.`
            : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={LightbulbIcon}
          title="Bugün öne çıkan bir şey yok"
          description="Süresi dolan paket, açık bakiye veya boş ders görünmüyor — her şey yolunda."
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.sev} className="space-y-3">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={group.sev} />
                <span className="text-sm text-muted-foreground">{group.rows.length} konu</span>
              </div>
              <ul className="space-y-2">
                {group.rows.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{item.title}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{item.detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        {item.actionLabel}
                        <ArrowRightIcon className="size-4" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
