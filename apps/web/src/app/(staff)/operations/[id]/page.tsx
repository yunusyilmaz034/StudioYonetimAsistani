import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { ActivityList } from '@/components/activity/activity-row'
import { loadOperationEvents } from '@/server/activity-query'
import { getTenantContext } from '@/server/auth'

// The operation detail — the screen OP-2 exists for. One OperationId, and everything it did:
// the 54 sessions it cancelled, the 54 credits it released, the 121 packages it extended. One act,
// not 229 unrelated rows scattered across a log.
export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')

  const { id } = await params
  const events = await loadOperationEvents(ctx, id)
  const first = events[0]
  const last = events.at(-1)

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="İşlem detayı"
        description={`${events.length} hareket`}
        actions={
          <Button variant="outline" render={<Link href="/operations" />}>
            <ArrowLeftIcon />
            <span className="hidden sm:inline">Operasyonlar</span>
          </Button>
        }
      />

      <Section title="Özet">
        <dl className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2">
          <Fact label="İşlem No" value={<span className="font-mono text-xs">{id}</span>} />
          <Fact label="İşlemi yapan" value={first?.actorName ?? '—'} />
          <Fact label="Başlangıç" value={<Stamp ms={first?.occurredAt} />} />
          <Fact label="Bitiş" value={<Stamp ms={last?.occurredAt} />} />
        </dl>
      </Section>

      <Section title="Bu işlemin yaptığı her şey">
        {/* showOperation={false}: we are already inside the operation — repeating its id on every
            row would be noise. */}
        <ActivityList
          events={events}
          showOperation={false}
          emptyLabel="Bu işlem numarasına ait hareket bulunamadı."
        />
      </Section>
    </main>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}

function Stamp({ ms }: { ms: number | undefined }) {
  if (!ms) return <>—</>
  const d = new Date(ms)
  const date = d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return <span className="tabular-nums">{`${date} ${time}`}</span>
}
