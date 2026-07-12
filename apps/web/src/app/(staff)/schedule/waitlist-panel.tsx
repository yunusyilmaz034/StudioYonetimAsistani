'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpIcon, HourglassIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import { listBookingMembersAction, type BookingMember } from '@/server/actions/booking'
import {
  joinWaitlistAction,
  leaveWaitlistAction,
  listWaitlistAction,
  promoteWaitlistAction,
  type WaitlistRow,
} from '@/server/actions/waitlist'

// D20 — the waiting list, inside the session workspace (UX-1). It appears when the class is full,
// because that is the only time waiting means anything.
//
// Promotion is MANUAL and deliberate (owner). The queue tells reception who is next; a human
// presses the button and tells the member. Nothing is auto-booked behind her back.

const STATUS: Record<string, { label: string; className: string }> = {
  waiting: { label: 'Bekliyor', className: 'bg-warning/10 text-warning' },
  promoted: { label: 'Rezerve edildi', className: 'bg-success/10 text-success' },
  left: { label: 'Ayrıldı', className: 'bg-muted text-muted-foreground' },
  expired: { label: 'Süresi doldu', className: 'bg-muted text-muted-foreground' },
}

export function WaitlistPanel({
  sessionId,
  full,
  onMutated,
}: {
  sessionId: string
  full: boolean
  onMutated: () => void
}) {
  const [rows, setRows] = useState<readonly WaitlistRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(await listWaitlistAction({ sessionId }))
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (adding && members === null) void listBookingMembersAction().then(setMembers)
  }, [adding, members])

  const waiting = (rows ?? []).filter((r) => r.status === 'waiting')
  const q = query.trim().toLocaleLowerCase('tr')
  const candidates = (members ?? []).filter(
    (m) => q === '' || m.fullName.toLocaleLowerCase('tr').includes(q) || m.phone.includes(q),
  )

  async function run(fn: () => Promise<{ ok: boolean; error?: unknown }>, done: string) {
    setBusy(true)
    try {
      const res = await fn()
      if (res.ok) {
        toast.success(done)
        await load()
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  // A queue on a class that is not full is noise: reception should just book her.
  if (!full && waiting.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HourglassIcon className="size-4 text-muted-foreground" />
          Bekleme listesi
          {waiting.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">{waiting.length} kişi</span>
          ) : null}
        </h3>
        {full ? (
          <Button variant="outline" size="sm" onClick={() => setAdding((a) => !a)}>
            <PlusIcon />
            Ekle
          </Button>
        ) : null}
      </div>

      {rows === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Seans dolu. Bekleyen üye yok — sıraya üye ekleyebilirsiniz.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          {rows.map((r) => (
            <li key={r.entryId} className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                {r.position ?? '—'}
              </span>
              <Link href={`/members/${r.memberId}`} className="min-w-0 flex-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <p className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
                  {r.memberName}
                </p>
                {/* OP-1 — the full timestamp, to the second. Two people joining the same queue in
                    the same minute is exactly the case FIFO has to answer. */}
                <p className="truncate text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(r.joinedAt)}
                </p>
              </Link>
              <Badge className={STATUS[r.status]?.className ?? ''}>{STATUS[r.status]?.label ?? r.status}</Badge>
              {r.status === 'waiting' ? (
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Rezervasyona çevir"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => promoteWaitlistAction({ entryId: r.entryId }),
                        `${r.memberName} rezerve edildi. Üyeyi bilgilendirin.`,
                      )
                    }
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Listeden çıkar"
                    disabled={busy}
                    onClick={() => void run(() => leaveWaitlistAction({ entryId: r.entryId }), 'Listeden çıkarıldı.')}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-xl border border-border p-2.5">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Üye ara (isim veya telefon)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {members === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {candidates.slice(0, 30).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary-soft/40"
                    onClick={() =>
                      void run(
                        () => joinWaitlistAction({ sessionId, memberId: m.id }),
                        `${m.fullName} bekleme listesine eklendi. Kredi ayrılmadı.`,
                      ).then(() => {
                        setAdding(false)
                        setQuery('')
                      })
                    }
                  >
                    <span className="truncate font-medium text-foreground">{m.fullName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{m.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Bekleme listesi kredi ayırmaz. Yer açıldığında rezervasyonu siz oluşturursunuz.
          </p>
        </div>
      ) : null}
    </section>
  )
}
