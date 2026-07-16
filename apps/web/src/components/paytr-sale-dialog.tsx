'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import { openWhatsApp } from '@/lib/whatsapp'
import { createPackagePaymentAction } from '@/server/actions/payments'
import type { ProductView } from '@/server/catalog-query'

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(Date.now())
const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

// PAYTR ile paket satışı — Sanal POS (yeni sekmede ödeme) veya Ödeme Linki (paylaş). Paket ödeme
// DOĞRULANDIKTAN sonra atanır (callback); bu ekran yalnızca ödemeyi başlatır.
export function PaytrSaleDialog({
  memberId,
  memberPhone,
  products,
  surchargeKurus = 0,
  maxInstallments = 3,
  open,
  onClose,
}: {
  memberId: string
  memberPhone: string | null
  products: readonly ProductView[]
  surchargeKurus?: number
  maxInstallments?: number
  open: boolean
  onClose: () => void
}) {
  const active = products.filter((p) => p.active)
  const [productId, setProductId] = useState(active[0]?.id ?? '')
  const [flow, setFlow] = useState<'pos' | 'link'>('link')
  const [validFrom, setValidFrom] = useState(todayStr())
  const [installments, setInstallments] = useState(Math.max(1, maxInstallments))
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)

  const product = active.find((p) => p.id === productId)
  // Card/transfer price = catalogue price + the studio's surcharge. The member is only ever shown this
  // final total; the server recomputes it, so this display is informational.
  const total = product ? product.priceInKurus + surchargeKurus : 0
  const installmentOptions = Array.from({ length: Math.max(1, maxInstallments) }, (_, i) => i + 1)

  async function start() {
    if (!product) return
    setBusy(true)
    setLink(null)
    try {
      const res = await createPackagePaymentAction({
        memberId,
        productId,
        flow,
        priceAgreedKurus: null,
        validFrom,
        validUntil: null,
        creditOverride: null,
        note: '',
        installments,
      })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
        return
      }
      if (res.value.flow === 'pos') {
        window.open(res.value.redirectUrl, '_blank', 'noopener')
        toast.success('PAYTR ödeme sayfası açıldı. Ödeme onaylanınca paket atanır.')
        onClose()
      } else {
        setLink(res.value.redirectUrl)
        toast.success('Ödeme linki oluşturuldu.')
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PAYTR ile Paket Sat</DialogTitle>
          <DialogDescription>Ödeme onaylanınca paket otomatik atanır — tarayıcı dönüşü tek başına yeterli değildir.</DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <p className="text-sm">Ödeme linki hazır. Üyeye gönderin:</p>
            <div className="flex items-center gap-2 rounded-lg border border-border p-2">
              <span className="min-w-0 flex-1 truncate text-sm">{link}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Kopyalandı.'))}>
                <CopyIcon /> Kopyala
              </Button>
              <Button variant="outline" size="sm" disabled={!memberPhone} onClick={() => openWhatsApp(memberPhone ?? '', `Ödeme linkiniz: ${link}`)}>
                WhatsApp
              </Button>
              <Button variant="outline" size="sm" render={<Link href={`mailto:?subject=Ödeme&body=${encodeURIComponent(link)}`} />}>
                E-posta
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Kapat</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              Paket
              <Select value={productId} onValueChange={(v) => setProductId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue>{(v: unknown) => active.find((p) => p.id === v)?.name ?? 'Paket seç'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {tl(p.priceInKurus)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Yöntem
              <Select value={flow} onValueChange={(v) => setFlow((v as 'pos' | 'link') ?? 'link')}>
                <SelectTrigger>
                  <SelectValue>{(v: unknown) => (v === 'pos' ? 'Sanal POS' : 'Ödeme Linki')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="link">Ödeme Linki (paylaş)</SelectItem>
                  <SelectItem value="pos">Sanal POS (şimdi öde)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Başlangıç tarihi
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Taksit
              <Select value={String(installments)} onValueChange={(v) => setInstallments(Number(v ?? maxInstallments))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {installmentOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 1 ? 'Tek çekim' : `${n} taksit`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {product ? (
              <p className="text-sm text-muted-foreground">
                Tutar: <strong className="text-foreground">{tl(total)}</strong>
                {surchargeKurus > 0 ? <span className="ml-1 text-xs">(kart/havale farkı dahil)</span> : null}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Vazgeç
              </Button>
              <Button onClick={() => void start()} disabled={busy || !product}>
                {busy ? <Loader2Icon className="animate-spin" /> : <ExternalLinkIcon />}
                {flow === 'pos' ? 'Ödemeyi Başlat' : 'Link Oluştur'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
