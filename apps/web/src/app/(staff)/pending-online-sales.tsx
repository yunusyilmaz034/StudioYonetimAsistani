'use client'

// ── ONLINE SATIŞ: money in, nothing delivered (owner, 2026-08-05) ────────────────────────────
//
// The one card on this dashboard that is meant to be EMPTY. Every row is a person who has paid the
// studio and has nothing yet — no membership, no package, no way in. So it sits above the day's
// checklist when it has anything to say, and disappears entirely when it does not.
//
// The decision it asks for is deliberately small: is this buyer someone already on the books, or
// someone new? Reception answers that; the system then grants the package, attaches the payment and
// sends the invite in one go. It never guesses — a phone that matches an existing member is shown as
// a SUGGESTION with a name attached, because AD-40 reports a collision and never merges it.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangleIcon, CheckIcon, Loader2Icon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { domainErrorMessage } from '@/lib/domain-error'
import type { PendingOnlineSale } from '@/server/online-sale'
import { fulfilOnlineSaleAction, listPendingOnlineSalesAction } from '@/server/actions/payments'

const lira = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`
const day = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR') : '—')

// How long she has been waiting, in the words someone would actually use. A purchase from four days
// ago and one from four minutes ago need different levels of alarm.
function waited(sinceMs: number): { label: string; urgent: boolean } {
  const mins = Math.max(0, Math.round((Date.now() - sinceMs) / 60_000))
  if (mins < 60) return { label: `${mins} dk önce`, urgent: false }
  const hours = Math.round(mins / 60)
  if (hours < 24) return { label: `${hours} saat önce`, urgent: hours >= 3 }
  return { label: `${Math.round(hours / 24)} gün önce`, urgent: true }
}

export function PendingOnlineSales() {
  const [rows, setRows] = useState<readonly PendingOnlineSale[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listPendingOnlineSalesAction())
    } catch {
      setRows([]) // a failed read must not break the dashboard around it
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function fulfil(row: PendingOnlineSale, memberId: string | null) {
    setBusyId(row.intentId)
    try {
      const res = await fulfilOnlineSaleAction({ intentId: row.intentId, memberId })
      if (res.ok) {
        toast.success(
          res.value.created
            ? `${row.buyerName} üye olarak eklendi, paketi atandı ve davetiyesi gönderildi.`
            : `${row.buyerName} için paket atandı ve ödeme eşleştirildi.`,
        )
        await load()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusyId(null)
  }

  // Nothing waiting is the normal state, and it should take up no room at all.
  if (!rows || rows.length === 0) return null

  return (
    <Section
      title="Online satış — üyelik bekliyor"
      hint="Ödemesi alındı, üyeliği henüz oluşturulmadı. Bu listedeki herkes bekliyor."
    >
      <ul className="space-y-2">
        {rows.map((r) => {
          const w = waited(r.paidAt)
          const busy = busyId === r.intentId
          return (
            <li
              key={r.intentId}
              className={`space-y-3 rounded-xl border p-3 shadow-xs ${
                w.urgent ? 'border-warning/40 bg-warning/5' : 'border-border bg-card'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.buyerName}</p>
                  <p className="text-sm text-muted-foreground">
                    {r.buyerPhone}
                    {r.buyerEmail ? ` · ${r.buyerEmail}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-foreground">{lira(r.amountKurus)}</p>
                  <p className={`text-xs ${w.urgent ? 'text-warning' : 'text-muted-foreground'}`}>
                    {w.urgent ? <AlertTriangleIcon className="mr-1 inline size-3" /> : null}
                    {w.label}
                  </p>
                </div>
              </div>

              <p className="text-sm text-foreground">
                {r.productName}
                <span className="text-muted-foreground">
                  {' · '}
                  {day(r.validFrom)}
                  {r.validUntil ? ` – ${day(r.validUntil)}` : ''}
                </span>
              </p>

              {/* The suggestion, never the decision. A matching phone means the studio probably knows
                  her already — reception confirms it, and can still create a new record instead. */}
              {r.existingMemberId ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
                  <Badge className="bg-primary-soft text-primary">Bu telefon kayıtlı</Badge>
                  <span className="text-sm text-foreground">{r.existingMemberName}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {r.existingMemberId ? (
                  <Button size="sm" disabled={busy} onClick={() => void fulfil(r, r.existingMemberId)}>
                    {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon className="size-3.5" />}
                    {r.existingMemberName} üyesine ata
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={r.existingMemberId ? 'outline' : 'default'}
                  disabled={busy}
                  onClick={() => void fulfil(r, null)}
                >
                  {busy ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon className="size-3.5" />}
                  Yeni üye oluştur
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
