'use client'

import { useEffect, useRef } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { BanknoteIcon } from 'lucide-react'
import { toast } from 'sonner'

import { clientDb } from '@/lib/firebase-client'
import { checkInStatusAction } from '@/server/actions/checkin-status'

// The moment a PAYTR payment lands. Reception's screen listens to the studio's `payments` (she is signed
// in on the client SDK, so the rules let her READ it — payments is not serverOnly); when a NEW online
// payment appears — a Sanal POS charge, or a shared LINK paid minutes later while she wasn't watching —
// it looks up the member's name and throws a green toast. This is what tells her a link was paid and the
// member's debt just cleared, without her polling the Cari Hesap. Read-only; the settlement is untouched.

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

function PaidCard({ name, amount }: { name: string; amount: number }) {
  return (
    <div className="flex w-[22rem] max-w-[90vw] items-start gap-3 rounded-xl border-2 border-emerald-500/60 bg-emerald-500/10 p-4 shadow-lg">
      <BanknoteIcon className="mt-0.5 size-6 shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-emerald-700">Ödeme alındı · {tl(amount)}</p>
        <p className="truncate text-sm text-foreground">{name} — online ödeme işlendi, borç/bakiye güncellendi.</p>
      </div>
    </div>
  )
}

export function PaymentToaster({ studioId }: { studioId: string }) {
  const initialized = useRef(false)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    let mounted = true
    let unsub: (() => void) | undefined
    try {
      const q = query(collection(clientDb(), 'studios', studioId, 'payments'), orderBy('receivedAt', 'desc'), limit(8))
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
            if (data.method !== 'online') continue // only PAYTR settlements arrive out of band
            const memberId = data.memberId as string | undefined
            const amount = (data.amount as { amount?: number } | undefined)?.amount ?? 0
            if (memberId) void show(memberId, amount)
          }
        },
        () => undefined, // permission/transient error — stay silent rather than nag
      )
    } catch {
      // Firebase client not configured — the feature simply stays off.
    }

    async function show(memberId: string, amountKurus: number): Promise<void> {
      let name = 'Üye'
      try {
        const s = await checkInStatusAction({ memberId })
        if (s?.name) name = s.name
      } catch {
        // a failed name lookup should never break the desk — fall back to "Üye"
      }
      if (mounted) toast.custom(() => <PaidCard name={name} amount={amountKurus} />, { duration: 8000 })
    }

    return () => {
      mounted = false
      unsub?.()
    }
  }, [studioId])

  return null
}
