'use client'

import { useCallback, useEffect, useState } from 'react'
import { DoorOpenIcon, Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  listActiveRoomNotesAction,
  resolveRoomNoteAction,
  type RoomNote,
} from '@/server/actions/room-notes'

const IST = 'Europe/Istanbul'
function windowLabel(n: RoomNote): string | null {
  if (n.startsAt === null && n.endsAt === null) return null
  const t = (ms: number) =>
    new Intl.DateTimeFormat('tr-TR', { timeZone: IST, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms)
  if (n.startsAt !== null && n.endsAt !== null) return `${t(n.startsAt)} – ${t(n.endsAt)}`
  return n.endsAt !== null ? `${t(n.endsAt)}'a kadar` : `${t(n.startsAt!)}'dan itibaren`
}

// Active room notes, above the calendar. An operational banner — never part of the calendar grid.
export function RoomNotesBanner({ branchId }: { branchId: string | null }) {
  const [notes, setNotes] = useState<readonly RoomNote[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setNotes(await listActiveRoomNotesAction(branchId ? { branchId } : {}))
    } catch {
      setNotes([])
    }
  }, [branchId])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(id: string) {
    setBusy(id)
    try {
      const res = await resolveRoomNoteAction({ noteId: id })
      if (res.ok) {
        setNotes((prev) => (prev ? prev.filter((n) => n.id !== id) : prev))
      } else {
        toast.error('Not kapatılamadı.')
      }
    } catch {
      toast.error('Not kapatılamadı.')
    }
    setBusy(null)
  }

  if (!notes || notes.length === 0) return null

  return (
    <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3" role="status">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-warning">
        <DoorOpenIcon className="size-3.5" />
        Salon Notları
      </p>
      <ul className="space-y-1.5">
        {notes.map((n) => {
          const w = windowLabel(n)
          return (
            <li key={n.id} className="flex items-start justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{n.roomName}</span>
                <span className="text-muted-foreground"> · {n.text}</span>
                {w ? <span className="ml-1 text-xs tabular-nums text-warning">({w})</span> : null}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Notu kapat"
                onClick={() => void resolve(n.id)}
                disabled={busy === n.id}
              >
                {busy === n.id ? <Loader2Icon className="animate-spin" /> : <XIcon />}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
