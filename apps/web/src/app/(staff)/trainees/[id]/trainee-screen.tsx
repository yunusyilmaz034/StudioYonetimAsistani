'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, PackageIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/ui/section'
import { TrainingPanel } from '@/app/(staff)/members/[id]/training-panel'
import type { TraineeRow } from '@/server/trainee-query'

const TZ = 'Europe/Istanbul'
const gun = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: TZ, day: 'numeric', month: 'long' })

export function TraineeScreen({ trainee, studioId }: { trainee: TraineeRow; studioId: string }) {
  const router = useRouter()

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push('/trainees')}
          className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Üyeler
        </button>
        <h1 className="truncate text-display font-semibold text-foreground">{trainee.fullName}</h1>
      </div>

      {/* AKTİF PAKET. Not a commercial record — a planning fact: how many classes are left, and until
          when. A trainer who cannot see this writes a six-week programme onto a package with two
          classes in it. Price, payment and history are absent by construction (they are never read). */}
      <Section title="Aktif Paket" hint={`${trainee.packages.length}`}>
        {trainee.packages.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <PackageIcon className="size-4 shrink-0" />
              Aktif paketi yok.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {trainee.packages.map((p) => (
              <Card key={`${p.name}-${p.validUntil}`}>
                <CardContent className="space-y-1.5 p-4">
                  <div className="font-medium text-foreground">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {p.creditsAvailable === null ? (
                      <Badge className="bg-primary/10 text-primary tabular-nums">{p.remainingDays} gün kaldı</Badge>
                    ) : (
                      <Badge className="bg-primary/10 text-primary tabular-nums">{p.creditsAvailable} ders kaldı</Badge>
                    )}
                    <span className="tabular-nums">{gun(p.validUntil)} tarihine kadar</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* The same panel the owner uses on the member card: programmes, measurements, photos. One
          component, so a change to how a programme is written reaches both screens at once. */}
      <TrainingPanel memberId={trainee.id} studioId={studioId} mode="full" />
    </main>
  )
}
