'use client'

import { useEffect, useState } from 'react'
import { GaugeIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { OCCUPANCY_LABEL, OCCUPANCY_TONE } from '@/lib/fitness-labels'
import { occupancyLevelForMemberAction } from '@/server/actions/fitness'
import type { OccupancyLevel } from '@studio/core'

// The member's anonymous doluluk card. She is told a BAND ("Şu an: Orta"), never a headcount and
// never who is inside (§11 privacy). If the studio has not set a capacity, the level is null and the
// card simply does not render — better silent than a made-up "Sakin".
export function OccupancyCard() {
  const [level, setLevel] = useState<OccupancyLevel | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    occupancyLevelForMemberAction()
      .then((r) => alive && setLevel(r.level))
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  if (!loaded || !level) return null

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-1">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
            <GaugeIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Şu an stüdyo</p>
            <p className="text-xs text-muted-foreground">Ne zaman gelmek istersin?</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${OCCUPANCY_TONE[level]}`}>
          {OCCUPANCY_LABEL[level]}
        </span>
      </CardContent>
    </Card>
  )
}
