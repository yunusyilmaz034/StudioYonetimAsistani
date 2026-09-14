'use client'

import { useCallback, useEffect, useState } from 'react'
import { CreditCardIcon, Loader2Icon, LogInIcon, LogOutIcon, TicketIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { timeLabel } from '@/components/calendar'
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
import { seatHoldTurnstilePassAction } from '@/server/actions/turnstile'

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
  /** `${holdId}:${yön}` — hangi düğmenin beklediği. Biri beklerken diğerleri de kilitli. */
  const [gecen, setGecen] = useState<string | null>(null)

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

  // OR-76 (owner, 2026-09-14) — misafirin telefonunda uygulama yok, QR okutamaz. Resepsiyon satırından
  // geçirir: girişte önce "geldi" yazılır, sonra kol döner; çıkışta yalnızca kol.
  async function gecir(h: SeatHoldView, yon: 'in' | 'out') {
    setGecen(`${h.id}:${yon}`)
    try {
      const res = await seatHoldTurnstilePassAction({ holdId: h.id, direction: yon })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
      } else {
        const kapi = yon === 'in' ? 'Giriş' : 'Çıkış'
        const kol =
          res.kol === 'dondu'
            ? `${kapi} kapısı açıldı.`
            : res.kol === 'cihaz_yok'
              ? `${kapi} turnikesi tanımlı değil, kol dönmedi.`
              : 'Kapı açılamadı — cihaz çevrimdışı olabilir.'
        const mesaj = res.arrivedNow ? `${kol} Misafir derse geldi olarak işaretlendi.` : kol
        if (res.kol === 'acilamadi') toast.error(mesaj)
        else toast.success(mesaj)
        if (res.arrivedNow) await load()
      }
    } catch {
      toast.error('Geçiş yapılamadı. Bağlantınızı kontrol edin.')
    }
    setGecen(null)
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
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{h.note}</p>
                  {h.arrivedAt !== null ? (
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium tabular-nums text-success">
                      Geldi {timeLabel(h.arrivedAt)}
                    </span>
                  ) : null}
                </div>
                {h.cardNumber ? (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <CreditCardIcon className="size-3" /> {h.cardNumber}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Yalnızca dersin günü: geçmiş bir dersin satırından bugün "geldi" yazılmasın. */}
                {h.today ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-9 border-success/40 text-success hover:bg-success/10 hover:text-success"
                      disabled={gecen !== null}
                      onClick={() => void gecir(h, 'in')}
                      aria-label={`${h.note} — turnike girişi`}
                    >
                      {gecen === `${h.id}:in` ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
                      Giriş
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-9 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                      disabled={gecen !== null}
                      onClick={() => void gecir(h, 'out')}
                      aria-label={`${h.note} — turnike çıkışı`}
                    >
                      {gecen === `${h.id}:out` ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
                      Çıkış
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 text-muted-foreground hover:text-danger"
                  aria-label="Yer ayırmayı kaldır"
                  onClick={() => void release(h)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
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

/**
 * Yoklama sekmesinde ayrılan yerlerdeki misafirler (owner, 2026-09-14 · OR-76).
 *
 * Üye listesine KARIŞMAZ ve "Katıldı / Gelmedi" düğmesi yok: misafir üye değil, gelişi bir işaret değil
 * bir gözlem — turnikeden geçirildiyse gelmiştir. Misafir yoksa bölüm hiç çizilmez.
 */
export function GuestArrivals({ sessionId }: { sessionId: string }) {
  const [holds, setHolds] = useState<readonly SeatHoldView[] | null>(null)

  useEffect(() => {
    let gecersiz = false
    listSeatHoldsAction({ sessionId })
      .then((h) => {
        if (!gecersiz) setHolds(h)
      })
      .catch(() => {
        if (!gecersiz) setHolds([])
      })
    return () => {
      gecersiz = true
    }
  }, [sessionId])

  if (!holds || holds.length === 0) return null
  const gelen = holds.filter((h) => h.arrivedAt !== null).length

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TicketIcon className="size-4 text-muted-foreground" />
        Misafirler
        <span className="text-xs font-normal tabular-nums text-muted-foreground">
          {gelen}/{holds.length} geldi
        </span>
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {holds.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{h.note}</p>
            {h.arrivedAt !== null ? (
              <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium tabular-nums text-success">
                Geldi {timeLabel(h.arrivedAt)}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">Girişi yok</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Rezervasyon sekmesinde ayrılan yerin satırından Giriş ile geçirilen misafir burada geldi görünür.
      </p>
    </section>
  )
}
