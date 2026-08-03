'use client'

import { useEffect, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { bookPastAttendedAction } from '@/server/actions/reservations'
import { searchMembersAction, type MemberHit } from '@/server/actions/search'
import type { CalendarSession } from '@/server/schedule-query'

// ── SONRADAN ÜYE EKLEME (owner, 2026-08-02) ──────────────────────────────────────────────────
//
// *"Üye bugün kimseye sormadan çıkmış gelmiş, biz derste yer vardı aldık ama sistemin bundan haberi
// yok."* The class is over, she was in it, and her credit was never taken — the studio gave away a
// class it was owed. Reception is already on this screen taking attendance, so the repair belongs
// here rather than in a separate corrections tool nobody would find.
//
// It is offered ONLY for a class that has started and only inside the studio's 30-day window; older
// than that the honest instrument is a credit adjustment with a reason, not a rewritten past. The
// server refuses either way — this only decides whether the button is drawn, and a button that
// cannot work is worse than no button.
const BACKDATE_DAYS = 30

export function AddPastMember({ session, onAdded }: { session: CalendarSession; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly MemberHit[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const started = session.startsAt <= Date.now()
  const withinWindow = session.startsAt >= Date.now() - BACKDATE_DAYS * 86_400_000
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    // Debounced: reception types a name, not a keystroke per query.
    const t = setTimeout(() => {
      void searchMembersAction(q).then(setHits).catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open])

  if (!started || !withinWindow || session.status !== 'scheduled') return null

  async function add(m: MemberHit) {
    setBusy(m.id)
    try {
      const res = await bookPastAttendedAction({ memberId: m.id, sessionId: session.sessionId })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        return
      }
      toast.success(`${m.fullName} derse eklendi, kredisi düşüldü.`)
      setOpen(false)
      setQuery('')
      setHits([])
      onAdded()
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon /> Sonradan üye ekle
      </Button>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sonradan üye ekle</DialogTitle>
          <DialogDescription>
            Üye bu derse katılmış sayılır ve kredisi <strong>hemen düşer</strong>. Ders zaten bittiği
            için bu işlem geri alınamaz — yanlışsa yoklamadan “Düzelt” ile düzeltilir.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="İsim veya telefon ara…"
        />

        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {hits.length === 0 ? (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              {query.trim().length < 2 ? 'Aramak için en az iki harf yazın.' : 'Eşleşen üye yok.'}
            </li>
          ) : (
            hits.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.packageLabel}
                    {m.warn ? ` · ${m.warn}` : ''}
                  </p>
                </div>
                <Button size="sm" disabled={busy !== null} onClick={() => add(m)}>
                  {busy === m.id ? 'Ekleniyor…' : 'Ekle'}
                </Button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
