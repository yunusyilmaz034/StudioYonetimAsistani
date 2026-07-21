'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CopyIcon, ExternalLinkIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import { openWhatsApp } from '@/lib/whatsapp'
import { createPackagePaymentAction, listMemberPaymentIntentsAction } from '@/server/actions/payments'
import type { ProductView } from '@/server/catalog-query'

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(Date.now())
const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

// PAYTR ile paket satışı — Sanal POS (kart formu + taksit tablosu + 3D panelin İÇİNDE gömülü iframe'de)
// veya Ödeme Linki (paylaş). Paket ödeme DOĞRULANDIKTAN sonra callback ile atanır; bu ekran ödemeyi
// başlatır ve Sanal POS'ta sonucu intent durumundan izler.
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
  const router = useRouter()
  const active = products.filter((p) => p.active)
  const [productId, setProductId] = useState(active[0]?.id ?? '')
  const [flow, setFlow] = useState<'pos' | 'link'>('link')
  const [validFrom, setValidFrom] = useState(todayStr())
  const [installments, setInstallments] = useState(Math.max(1, maxInstallments))
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  // Sanal POS embedded-iframe state.
  const [posUrl, setPosUrl] = useState<string | null>(null)
  const [posIntentId, setPosIntentId] = useState<string | null>(null)
  const [posResult, setPosResult] = useState<'paid' | 'failed' | 'review' | null>(null)

  // While the PayTR iframe is open, poll the intent — the ONLY source of truth is the callback, which
  // flips the intent to `paid`. The browser returning is never enough (that's why we don't trust the
  // iframe's own redirect). Stops on a terminal status, on close, or on unmount.
  useEffect(() => {
    if (!posUrl || !posIntentId || posResult) return
    let alive = true
    const tick = async () => {
      try {
        const rows = await listMemberPaymentIntentsAction({ memberId })
        const row = rows.find((r) => r.id === posIntentId)
        if (!row || !alive) return
        if (row.status === 'paid') {
          setPosResult('paid')
          toast.success('Ödeme onaylandı — paket atandı.')
          router.refresh()
        } else if (row.status === 'failed' || row.status === 'expired' || row.status === 'cancelled') {
          setPosResult('failed')
        } else if (row.status === 'manual_review') {
          setPosResult('review')
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
  }, [posUrl, posIntentId, posResult, memberId, router])

  function close() {
    setLink(null)
    setPosUrl(null)
    setPosIntentId(null)
    setPosResult(null)
    onClose()
  }

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
        const detail = 'providerError' in res && res.providerError ? ` — PAYTR: ${res.providerError}` : ''
        toast.error(domainErrorMessage(res.error) + detail)
        setBusy(false)
        return
      }
      if (res.value.flow === 'pos') {
        // Embed the PayTR secure form (card + installment table + 3D) right here, and start polling.
        setPosIntentId(res.value.intentId)
        setPosUrl(res.value.redirectUrl)
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
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className={posUrl ? 'max-w-2xl' : undefined}>
        <DialogHeader>
          <DialogTitle>PAYTR ile Paket Sat</DialogTitle>
          <DialogDescription>Ödeme onaylanınca paket otomatik atanır — tarayıcı dönüşü tek başına yeterli değildir.</DialogDescription>
        </DialogHeader>

        {posUrl ? (
          <div className="space-y-3">
            {posResult === 'paid' ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <CheckCircle2Icon className="size-12 text-emerald-600" />
                <p className="text-base font-semibold">Ödeme onaylandı</p>
                <p className="text-sm text-muted-foreground">Paket üyeye atandı.</p>
              </div>
            ) : posResult === 'failed' ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <XCircleIcon className="size-12 text-destructive" />
                <p className="text-base font-semibold">Ödeme tamamlanmadı</p>
                <p className="text-sm text-muted-foreground">İşlem başarısız oldu ya da iptal edildi. Tekrar deneyebilirsiniz.</p>
              </div>
            ) : posResult === 'review' ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Loader2Icon className="size-10 text-amber-500" />
                <p className="text-base font-semibold">İnceleme gerekiyor</p>
                <p className="text-sm text-muted-foreground">Ödeme otomatik doğrulanamadı; birazdan Cari Hesap üzerinden kontrol edin.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Tutar</span>
                  <strong>{tl(total)}{surchargeKurus > 0 ? <span className="ml-1 text-xs font-normal text-muted-foreground">(kart farkı dahil)</span> : null}</strong>
                </div>
                <iframe
                  src={posUrl}
                  title="PayTR Sanal POS"
                  className="h-[68vh] w-full rounded-lg border border-border bg-white"
                />
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" /> Ödeme bekleniyor… onaylanınca paket otomatik atanır.
                </p>
              </>
            )}
            <DialogFooter>
              <Button onClick={close}>{posResult === 'paid' ? 'Tamam' : 'Kapat'}</Button>
            </DialogFooter>
          </div>
        ) : link ? (
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
              <Button onClick={close}>Kapat</Button>
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
              <Button variant="outline" onClick={close} disabled={busy}>
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
