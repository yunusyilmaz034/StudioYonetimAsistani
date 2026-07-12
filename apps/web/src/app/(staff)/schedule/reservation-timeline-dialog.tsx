'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Timeline } from '@/components/activity/timeline'
import { reservationTimelineAction } from '@/server/actions/activity'

// The RESERVATION TIMELINE (v1.22). One booking's whole story — booked, moved, moved again,
// cancelled — and, when it began in a queue, the waitlist entry that produced it. A move reads as
// a move, because D19 refused to record it as a cancellation.
export function ReservationTimelineDialog({
  open,
  reservationId,
  memberName,
  onClose,
}: {
  open: boolean
  reservationId: string | null
  memberName: string
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rezervasyon geçmişi</DialogTitle>
          <DialogDescription>{memberName}</DialogDescription>
        </DialogHeader>
        {reservationId ? (
          <Timeline
            key={reservationId}
            load={() => reservationTimelineAction({ reservationId })}
            emptyLabel="Bu rezervasyon için kayıt yok."
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
