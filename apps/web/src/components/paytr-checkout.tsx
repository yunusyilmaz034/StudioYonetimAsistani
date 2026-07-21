'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CopyIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { openWhatsApp } from '@/lib/whatsapp'
import { listMemberPaymentIntentsAction } from '@/server/actions/payments'

export interface PaytrCheckout {
  readonly flow: 'pos' | 'link'
  readonly redirectUrl: string
  readonly intentId: string
}

// The shared PAYTR checkout surface, used by both the package sale (Sanal POS / Linkle Ödeme) and the
// wallet top-up. For `pos` it embeds the secure form (card + installment table + 3D) and polls the
// intent — the callback is the ONLY source of truth, so a browser return is never trusted. For `link`
// it shows the shareable URL. On a confirmed `paid` it refreshes so the new package/balance/debt shows.
export function PaytrCheckoutDialog({
  checkout,
  memberId,
  memberPhone,
  title = 'PAYTR Ödeme',
  onClose,
  onPaid,
}: {
  checkout: PaytrCheckout | null
  memberId: string
  memberPhone: string | null
  title?: string
  onClose: () => void
  onPaid?: () => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<'paid' | 'failed' | 'review' | null>(null)
  const open = !!checkout
  const isPos = checkout?.flow === 'pos'

  useEffect(() => {
    if (!checkout || checkout.flow !== 'pos' || result) return
    let alive = true
    const tick = async () => {
      try {
        const rows = await listMemberPaymentIntentsAction({ memberId })
        const row = rows.find((r) => r.id === checkout.intentId)
        if (!row || !alive) return
        if (row.status === 'paid') {
          setResult('paid')
          toast.success('Ödeme onaylandı.')
          onPaid?.()
          router.refresh()
        } else if (row.status === 'failed' || row.status === 'expired' || row.status === 'cancelled') {
          setResult('failed')
        } else if (row.status === 'manual_review') {
          setResult('review')
        }
      } catch {
        /* transient — keep polling */
      }
    }
    void tick()
    const iv = setInterval(() => void tick(), 3500)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [checkout, result, memberId, router, onPaid])

  function close() {
    setResult(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className={isPos ? 'max-w-2xl' : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {!checkout ? null : checkout.flow === 'link' ? (
          <div className="space-y-3">
            <p className="text-sm">Ödeme linki hazır. Üyeye gönderin:</p>
            <div className="flex items-center gap-2 rounded-lg border border-border p-2">
              <span className="min-w-0 flex-1 truncate text-sm">{checkout.redirectUrl}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(checkout.redirectUrl).then(() => toast.success('Kopyalandı.'))}>
                <CopyIcon /> Kopyala
              </Button>
              <Button variant="outline" size="sm" disabled={!memberPhone} onClick={() => openWhatsApp(memberPhone ?? '', `Ödeme linkiniz: ${checkout.redirectUrl}`)}>
                WhatsApp
              </Button>
              <Button variant="outline" size="sm" render={<Link href={`mailto:?subject=Ödeme&body=${encodeURIComponent(checkout.redirectUrl)}`} />}>
                E-posta
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Ödeme gelince otomatik işlenir; üyenin borcu kapanır ve kasaya düşer.</p>
            <DialogFooter>
              <Button onClick={close}>Kapat</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {result === 'paid' ? (
              <ResultCard icon="ok" title="Ödeme onaylandı" sub="İşlem tamamlandı." />
            ) : result === 'failed' ? (
              <ResultCard icon="fail" title="Ödeme tamamlanmadı" sub="İşlem başarısız oldu ya da iptal edildi. Tekrar deneyebilirsiniz." />
            ) : result === 'review' ? (
              <ResultCard icon="wait" title="İnceleme gerekiyor" sub="Ödeme otomatik doğrulanamadı; birazdan Cari Hesap'tan kontrol edin." />
            ) : (
              <>
                <iframe src={checkout.redirectUrl} title="PayTR Sanal POS" className="h-[68vh] w-full rounded-lg border border-border bg-white" />
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" /> Ödeme bekleniyor… onaylanınca otomatik işlenir.
                </p>
              </>
            )}
            <DialogFooter>
              <Button onClick={close}>{result === 'paid' ? 'Tamam' : 'Kapat'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResultCard({ icon, title, sub }: { icon: 'ok' | 'fail' | 'wait'; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      {icon === 'ok' ? (
        <CheckCircle2Icon className="size-12 text-emerald-600" />
      ) : icon === 'fail' ? (
        <XCircleIcon className="size-12 text-destructive" />
      ) : (
        <Loader2Icon className="size-10 text-amber-500" />
      )}
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}
