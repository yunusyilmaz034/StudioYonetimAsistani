'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { payCafeFromWalletAction } from '@/server/actions/cafe'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'

/** Kafe hesabını cüzdandan kapat. Tutar sunucuda hesaplanır; burada bir rakam TAŞINMAZ. */
export function CafePayButton({ walletKurus, dueKurus }: { walletKurus: number; dueKurus: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const yeterli = walletKurus >= dueKurus

  async function ode() {
    setBusy(true)
    try {
      const r = await payCafeFromWalletAction()
      if (r.ok) {
        toast.success('Kafe hesabın cüzdanından ödendi.')
        router.refresh()
      } else {
        toast.error(domainErrorMessage(r.error))
      }
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Ödeme yapılamadı.')
    }
    setBusy(false)
  }

  // Bakiye yetmiyorsa ödeme düğmesi HİÇ ÇIKMIYOR, yerine yükleme çıkıyor: basıldığında reddedilecek
  // bir düğme, olmayan bir düğmeden kötüdür.
  if (!yeterli) return null
  return (
    <Button size="sm" className="w-full" disabled={busy} onClick={() => void ode()}>
      {busy ? <Loader2Icon className="animate-spin" /> : null} Cüzdanımdan öde
    </Button>
  )
}
