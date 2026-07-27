'use client'

import { useCallback, useEffect, useState } from 'react'
import { CreditCardIcon, Loader2Icon, TicketIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  holdSeatAction,
  listSeatHoldsAction,
  releaseSeatAction,
  type SeatHoldView,
} from '@/server/actions/seat-hold'

// Seats held for people who are NOT members (owner, 2026-07-27).
//
// Multisport visitors write to the studio's WhatsApp asking whether there is room. They buy nothing,
// have no account, and must not be registered as members — so this sits beside the roster rather
// than in it. Same room, different kind of occupant, and the screen says so plainly.
//
// It lives in the session workspace next to the reservations because the question reception is
// actually answering is one question: "kaç kişi var, kaç yer kaldı?"

export function SeatHoldsPanel({
  sessionId,
  full,
  onMutated,
}: {
  sessionId: string
  full: boolean
  onMutated: () => void
}) {
  const [holds, setHolds] = useState<readonly SeatHoldView[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setHolds(await listSeatHoldsAction({ sessionId }))
    } catch {
      setHolds([])
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  async function hold() {
    setBusy(true)
    try {
      const res = await holdSeatAction({ sessionId, note, cardNumber: cardNumber.trim() || null })
      if (res.ok) {
        toast.success('Yer ayrıldı.')
        setAdding(false)
        setNote('')
        setCardNumber('')
        await load()
        onMutated() // the seat left the room — every capacity number on screen is now stale
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Yer ayrılamadı.')
    }
    setBusy(false)
  }

  async function release(h: SeatHoldView) {
    try {
      const res = await releaseSeatAction({ holdId: h.id })
      if (res.ok) {
        toast.success('Yer ayırma kaldırıldı.')
        await load()
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaldırılamadı.')
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TicketIcon className="size-4 text-muted-foreground" />
          Ayrılan yerler
          {holds && holds.length > 0 ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium tabular-nums text-warning">
              {holds.length}
            </span>
          ) : null}
        </h3>
        <Button variant="outline" size="sm" className="min-h-9" onClick={() => setAdding(true)} disabled={full}>
          Yer ayır
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Üye olmayan misafirler için (ör. Multisport). Kontenjandan düşer; üyeler yalnızca yerin dolu
        olduğunu görür, kime ayrıldığını görmez.
      </p>

      {holds === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : holds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {full ? 'Seans dolu, yer ayrılamaz.' : 'Ayrılmış yer yok.'}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-xs">
          {holds.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{h.note}</p>
                {h.cardNumber ? (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <CreditCardIcon className="size-3" /> {h.cardNumber}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground hover:text-danger"
                aria-label="Yer ayırmayı kaldır"
                onClick={() => void release(h)}
              >
                <XIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yer ayır</DialogTitle>
            <DialogDescription>
              Üye olmayan bir misafir için bu seanstan bir yer ayırın. Kontenjandan bir kişi düşer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="hold-note">
                Kime ayrıldı
              </label>
              <Input
                id="hold-note"
                placeholder="Ör. Multisport — Zeynep Y."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="hold-card">
                Kart no <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
              </label>
              <Input
                id="hold-card"
                placeholder="Multisport kart numarası"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => void hold()} disabled={busy || note.trim().length === 0}>
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : null} Yeri ayır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
