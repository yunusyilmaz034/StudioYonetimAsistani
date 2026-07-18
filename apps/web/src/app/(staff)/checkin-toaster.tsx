'use client'

import { useEffect, useRef } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { BellRingIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { clientDb } from '@/lib/firebase-client'
import { checkInStatusAction, type CheckInStatus } from '@/server/actions/checkin-status'

// PF-36 — the moment a member walks in. Reception's screen listens to the studio's check-ins (she is
// signed in on the client SDK, so the rules let her READ `checkIns`); when a NEW one lands — whether
// from the wall kiosk or her own desk — it fetches the member's live status and throws a big toast:
// GREEN when her membership is live, RED when it is not. "Normal is quiet" does not apply here — the
// owner asked for this to be loud, because a lapsed member at the door is a conversation to have now.
//
// The check-in itself still flows through the command/QR paths untouched; this only READS and reacts.

const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

function StatusCard({ s }: { s: CheckInStatus }) {
  const creditText =
    s.credits !== null ? `${s.credits} ders hakkı` : s.hasPeriodPackage ? 'süreli üyelik' : null
  if (!s.active) {
    return (
      <div className="flex w-[22rem] max-w-[90vw] items-start gap-3 rounded-xl border-2 border-rose-500/60 bg-rose-500/10 p-4 shadow-lg">
        <XCircleIcon className="mt-0.5 size-6 shrink-0 text-rose-600" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-rose-700">{s.name} giriş yaptı</p>
          <p className="text-sm font-medium text-rose-600">Aktif üyelik yok — paket satışı için görüşün.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex w-[22rem] max-w-[90vw] items-start gap-3 rounded-xl border-2 border-emerald-500/60 bg-emerald-500/10 p-4 shadow-lg">
      <CheckCircle2Icon className="mt-0.5 size-6 shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-emerald-700">{s.name} giriş yaptı</p>
        <p className="truncate text-sm text-foreground">
          {s.packageName}
          {s.validUntil ? ` · bitiş ${d(s.validUntil)}` : ''}
          {creditText ? ` · ${creditText}` : ''}
        </p>
        {s.hasNotice ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-600">
            <BellRingIcon className="size-3.5" /> Aktif kısıtlı üyelik notu var
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function CheckInToaster({ studioId }: { studioId: string }) {
  const initialized = useRef(false)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    let mounted = true
    let unsub: (() => void) | undefined
    try {
      const q = query(
        collection(clientDb(), 'studios', studioId, 'checkIns'),
        orderBy('occurredAt', 'desc'),
        limit(8),
      )
      unsub = onSnapshot(
        q,
        (snap) => {
          // First delivery is the existing tail — baseline it, don't toast history.
          if (!initialized.current) {
            snap.docs.forEach((doc) => seen.current.add(doc.id))
            initialized.current = true
            return
          }
          for (const chg of snap.docChanges()) {
            if (chg.type !== 'added' || seen.current.has(chg.doc.id)) continue
            seen.current.add(chg.doc.id)
            const data = chg.doc.data()
            if (data.direction !== 'in') continue // a check-OUT is not a welcome
            const memberId = data.memberId as string | undefined
            if (memberId) void show(memberId)
          }
        },
        () => undefined, // permission/transient error — stay silent rather than nag
      )
    } catch {
      // Firebase client not configured (e.g. a misconfigured env) — the feature simply stays off.
    }

    async function show(memberId: string): Promise<void> {
      try {
        const s = await checkInStatusAction({ memberId })
        if (mounted && s) toast.custom(() => <StatusCard s={s} />, { duration: s.active ? 6000 : 10000 })
      } catch {
        // ignore — a failed status lookup should never break the desk
      }
    }

    return () => {
      mounted = false
      unsub?.()
    }
  }, [studioId])

  return null
}
