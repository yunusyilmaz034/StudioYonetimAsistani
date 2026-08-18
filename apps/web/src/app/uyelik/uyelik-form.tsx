'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createPublicMembershipCheckoutAction } from '@/server/actions/payments'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="font-medium text-primary underline">
      {children}
    </a>
  )
}

function Consent({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
      {/* min-h/w 16px + the 10px gap keeps the tap target usable on a 375px phone. */}
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

const REASON_TR: Record<string, string> = {
  invalid_phone: 'Geçerli bir cep telefonu girin (05xx xxx xx xx).',
  kvkk_required: 'Devam etmek için KVKK aydınlatma metnini onaylayın.',
  sales_contract_required: 'Devam etmek için Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi\'ni onaylayın.',
  early_start_required: 'Üyeliğiniz ödeme sonrası hemen başladığı için ilgili onayı vermeniz gerekiyor.',
  not_configured: 'Ödeme sistemi şu an kullanılamıyor. Lütfen stüdyoyla iletişime geçin.',
  unavailable: 'Bu paket şu anda satışta değil.',
  checkout_failed: 'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
  rate_limited: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
}

export interface UyelikItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly durationDays: number
  readonly totalKurus: number
  // Equal to totalKurus when the package has one price; the card then shows a single figure.
  readonly cashKurus?: number
}

export function UyelikForm({
  studioId,
  items,
  initialProductId,
}: {
  studioId: string
  items: readonly UyelikItem[]
  // The marketing site links straight to a package (`?p=`). An unknown id falls back to the first —
  // a stale link from an old post must still land on a working page, never on an empty one.
  initialProductId?: string
}) {
  const [productId, setProductId] = useState(
    (initialProductId && items.some((i) => i.id === initialProductId) ? initialProductId : items[0]?.id) ?? '',
  )
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [kvkk, setKvkk] = useState(false)
  const [contract, setContract] = useState(false)
  const [earlyStart, setEarlyStart] = useState(false)
  // Ticari elektronik ileti izni. Ayrı, isteğe bağlı ve ÖNCEDEN İŞARETLİ DEĞİL — bu üçü birlikte
  // olmazsa verilen şey hukuken izin sayılmaz.
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = items.find((i) => i.id === productId) ?? items[0]
  // The contract and the pre-information form are rendered FOR THE SELECTED PACKAGE, so what she
  // reads names the package, the duration and the price she is about to pay — not a generic text.
  const docHref = (path: string) => `${path}?s=${encodeURIComponent(studioId)}${selected ? `&p=${encodeURIComponent(selected.id)}` : ''}`

  async function pay() {
    if (!selected) return
    if (name.trim().length < 2) return void toast.error('Ad soyad girin.')
    if (!kvkk) return void toast.error('KVKK aydınlatma metnini onaylayın.')
    if (!contract) return void toast.error('Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi\'ni onaylayın.')
    if (!earlyStart) return void toast.error('Üyeliğin hemen başlamasına ilişkin onayı verin.')
    setBusy(true)
    try {
      const res = await createPublicMembershipCheckoutAction({
        studioId,
        productId: selected.id,
        buyerName: name.trim(),
        buyerPhone: phone,
        buyerEmail: email.trim(),
        kvkkConsent: kvkk,
        salesContractConsent: contract,
        earlyStartConsent: earlyStart,
        marketingConsent: marketing,
      })
      if (res.ok) {
        window.location.href = res.redirectUrl // → PAYTR
      } else {
        toast.error(REASON_TR[res.reason] ?? 'Ödeme başlatılamadı.')
        setBusy(false)
      }
    } catch {
      toast.error('Bir hata oluştu. Lütfen tekrar deneyin.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Package picker — a tappable list; the selected one is highlighted. */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Paketini seç</p>
        {items.map((it) => {
          const active = it.id === productId
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setProductId(it.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                active ? 'border-primary bg-primary-soft/50' : 'border-border hover:bg-muted/50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{it.name}</span>
                {it.description ? <span className="block truncate text-xs text-muted-foreground">{it.description}</span> : null}
                <span className="block text-xs text-muted-foreground">{it.durationDays} gün geçerli</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-base font-semibold tabular-nums text-foreground">{tl(it.totalKurus)}</span>
                {it.cashKurus != null && it.cashKurus !== it.totalKurus ? (
                  <span className="block text-[11px] text-muted-foreground">stüdyoda nakit {tl(it.cashKurus)}</span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {/* Buyer details */}
      <div className="space-y-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" autoComplete="name" />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefon (05xx xxx xx xx)"
          inputMode="tel"
          autoComplete="tel"
        />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-posta (opsiyonel)" inputMode="email" autoComplete="email" />
      </div>

      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Hizmetlerimizin tamamı <span className="font-medium text-foreground">kadınlara özeldir</span> ve
        stüdyomuzda yüz yüze sunulur.
      </p>

      {/* ZORUNLU ONAYLAR. Every link opens in a new tab (`target="_blank"`) so reading a contract never
          costs the buyer the name and phone she already typed — a form that empties itself when
          somebody does the thing the law wants her to do is a form that teaches her not to. */}
      <div className="space-y-2.5 rounded-xl border border-border p-3">
        <Consent checked={kvkk} onChange={setKvkk}>
          <DocLink href="/kvkk">KVKK Aydınlatma Metni</DocLink>'ni okudum, kişisel verilerimin üyelik
          işlemleri için işlenmesini onaylıyorum.
        </Consent>
        <Consent checked={contract} onChange={setContract}>
          <DocLink href={docHref('/on-bilgilendirme')}>Ön Bilgilendirme Formu</DocLink>'nu ve{' '}
          <DocLink href={docHref('/mesafeli-satis')}>Mesafeli Satış Sözleşmesi</DocLink>'ni okudum ve
          kabul ediyorum.
        </Consent>
        <Consent checked={earlyStart} onChange={setEarlyStart}>
          14 günlük cayma süresi sona ermeden hizmetten yararlanmak istiyorum ve hizmetin ifasına
          başlanmasını onaylıyorum. Hizmetin bu onayım doğrultusunda cayma süresi sona ermeden tamamen
          ifa edilmesi hâlinde cayma hakkımı kaybedebileceğim konusunda bilgilendirildim.
        </Consent>
      </div>

      {/* İSTEĞE BAĞLI — deliberately outside the required box, quieter, and labelled. Same visual
          weight as the mandatory ones would make it read as a fourth requirement. */}
      <Consent checked={marketing} onChange={setMarketing}>
        <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          İsteğe bağlı
        </span>
        {selected ? 'Pilates Fitness by Işıl' : 'Stüdyo'}&apos;ın kampanya, indirim, yeni hizmet ve
        duyurularından SMS, e-posta ve WhatsApp yoluyla haberdar olmak istiyorum.
      </Consent>

      <Button className="min-h-12 w-full text-base" onClick={() => void pay()} disabled={busy || !selected}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {selected ? `${tl(selected.totalKurus)} Öde ve Üyeliği Satın Al` : 'Öde'}
      </Button>
      {/* Buying here is buying by card, so the figure above is the card price. Some packages carry a
          different cash price (owner, 2026-08-18) — the card names it rather than letting her find
          out at the desk. The vade farkı is the payment institution's; the studio sets no rate. */}
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Buradan yapılan ödemeler kredi kartıyla alınır; gösterilen tutar kredi kartı tutarıdır. Taksit
        seçeneğine göre vade farkı oluşabilir, net tutarı ödeme ekranında görürsünüz.
        <br />
        Ödeme sonrası üyeliğin hemen aktif olur; giriş bağlantısını WhatsApp&apos;tan göndeririz.
      </p>
    </div>
  )
}
