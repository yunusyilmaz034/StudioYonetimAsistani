'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon, Loader2Icon, PlusIcon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Timeline } from '@/components/activity/timeline'
import { packageTimelineAction } from '@/server/actions/activity'
import {
  freezeSubscriptionAction,
  unfreezeSubscriptionAction,
} from '@/server/actions/subscription'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import type { ProductView } from '@/server/catalog-query'
import {
  adjustSubscriptionCreditsAction,
  amendSubscriptionAction,
  assignSubscriptionAction,
  cancelSubscriptionAction,
  listMemberSubscriptionsAction,
  reactivateSubscriptionAction,
  type SubscriptionView,
} from '@/server/actions/subscription'

const METHOD_LABEL: Record<string, string> = { cash: 'Nakit', credit_card: 'Kredi Kartı', bank_transfer: 'Havale / EFT' }
const STATUS_LABEL: Record<string, string> = { active: 'Aktif', frozen: 'Dondurulmuş', expired: 'Süresi doldu', cancelled: 'İptal' }

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
const toKurus = (s: string) => Math.round((Number(s) || 0) * 100)
const dateLabel = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
const studioToday = () => new Date(Date.now() + 180 * 60_000).toISOString().slice(0, 10)
const addDays = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function SubscriptionsPanel({ memberId, products }: { memberId: string; products: readonly ProductView[] }) {
  const [subs, setSubs] = useState<readonly SubscriptionView[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setSubs(null)
    try {
      setSubs(await listMemberSubscriptionsAction({ memberId }))
    } catch {
      setSubs([])
      toast.error('Abonelikler yüklenemedi.')
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  const active = subs?.filter((s) => s.status === 'active' || s.status === 'frozen') ?? []
  const past = subs?.filter((s) => s.status === 'expired' || s.status === 'cancelled') ?? []
  const activeProducts = products.filter((p) => p.active)

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Abonelikler</h3>
        {!adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={activeProducts.length === 0}>
            <PlusIcon />
            Yeni
          </Button>
        ) : null}
      </div>

      {adding ? (
        <AssignForm
          memberId={memberId}
          products={activeProducts}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            void load()
          }}
        />
      ) : null}

      {subs === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : subs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz abonelik yok.</p>
      ) : (
        <div className="space-y-2">
          {active.map((s) => (
            <SubscriptionRow key={s.id} sub={s} onChanged={load} />
          ))}
          {past.length > 0 ? (
            <>
              <p className="pt-2 text-xs font-medium text-muted-foreground">Geçmiş</p>
              {past.map((s) => (
                <SubscriptionRow key={s.id} sub={s} onChanged={load} />
              ))}
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SubscriptionRow({ sub, onChanged }: { sub: SubscriptionView; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'amend' | 'credit' | 'status' | null>(null)
  const [busy, setBusy] = useState(false)

  // Freeze and unfreeze are one click. The refusal — an upcoming booking, an exhausted budget — comes
  // back as a Turkish sentence, and NOTHING is fixed behind her back (owner, 2026-07-13).
  const run = async (fn: () => Promise<{ ok: boolean; error?: unknown }>, done: string) => {
    setBusy(true)
    try {
      const res = await fn()
      if (res.ok) {
        toast.success(done)
        onChanged()
      } else {
        toast.error(domainErrorMessage(res.error as never))
      }
    } finally {
      setBusy(false)
    }
  }

  const expand = () => setOpen((o) => !o)

  const balance = sub.balanceDueKurus
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={expand} className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{sub.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {dateLabel(sub.validFrom)} – {dateLabel(sub.validUntil)}
            {sub.type === 'credit' ? ` · ${sub.creditsAvailable}/${sub.creditsGranted} kredi` : ' · sınırsız'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {balance > 0 ? <Badge className="bg-warning/10 text-warning">{tl(balance)} açık</Badge> : null}
          <Badge variant={sub.status === 'cancelled' ? 'destructive' : 'outline'}>{STATUS_LABEL[sub.status] ?? sub.status}</Badge>
          <ChevronDownIcon className={`size-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Paket tutarı" value={tl(sub.priceAgreedKurus)} />
            <Row label="Tahsil edilen" value={tl(sub.paidKurus)} />
            <Row label="Kalan bakiye" value={tl(balance)} />
            <Row label="Ödeme yöntemi" value={sub.method ? (METHOD_LABEL[sub.method] ?? sub.method) : '—'} />
            {sub.note ? <Row label="Açıklama" value={sub.note} /> : null}
            {/* v1.27 S3 — her freeze budget. Shown only where it exists: a Pilates package has none,
                and a row that says "0 gün" would read as a right she has and cannot use. */}
            {sub.freezeEntitledDays ? (
              <Row
                label="Dondurma hakkı"
                value={`${sub.freezeDaysRemaining} / ${sub.freezeEntitledDays} gün`}
              />
            ) : null}
            {sub.frozenSince ? (
              <Row label="Donduruldu" value={`${sub.frozenSince} tarihinden beri`} />
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('amend')}>
              Düzenle
            </Button>
            {sub.type === 'credit' ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('credit')}>
                Kredi
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setDialog('status')}>
              {sub.status === 'cancelled' ? 'Aktifleştir' : 'Pasife Al'}
            </Button>

            {/* v1.27 S3 — the slip reception hands the member. Opens in a new tab, because she is
                about to print it and reception's screen must not go with her. */}
            <a
              href={`/receipt/sale/${sub.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <PrinterIcon className="size-3.5" />
              Bilgi fişi
            </a>

            {/* FREEZE (v1.27 S3). The button appears only where the product actually grants the
                right — a Pilates package shows nothing, because it has nothing to offer. */}
            {sub.status === 'frozen' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(() => unfreezeSubscriptionAction({ entitlementId: sub.id }), 'Üyelik yeniden başladı.')}
              >
                Dondurmayı kaldır
              </Button>
            ) : sub.status === 'active' && (sub.freezeDaysRemaining ?? 0) > 0 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(() => freezeSubscriptionAction({ entitlementId: sub.id }), 'Üyelik donduruldu.')}
              >
                Dondur
              </Button>
            ) : null}
          </div>

          {sub.status === 'frozen' ? (
            <p className="rounded-md bg-info/5 p-2 text-sm text-info">
              Üyelik durdu. Kaldırdığında, durduğu gün sayısı kadar süresi uzayacak — hakkı{' '}
              <strong>{sub.freezeDaysRemaining} gün</strong> kaldı, dolduğunda sistem otomatik olarak
              devam ettirir.
            </p>
          ) : null}

          {/* The PACKAGE TIMELINE (v1.22): purchased → credit held → consumed → extended →
              frozen → expired, each with the credit balance it left behind, the staff member who
              did it, and the OperationId that binds a bulk act's 121 extensions into ONE act. */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Paket geçmişi</p>
            <Timeline
              key={sub.id}
              lifecycle
              load={() => packageTimelineAction({ entitlementId: sub.id })}
              emptyLabel="Bu paket için henüz hareket yok."
            />
          </div>
        </div>
      ) : null}

      {dialog === 'amend' ? <AmendDialog sub={sub} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
      {dialog === 'credit' ? <CreditDialog sub={sub} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
      {dialog === 'status' ? <StatusDialog sub={sub} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </>
  )
}

// ── Assign a new subscription (the 10-step flow, inline) ──
function AssignForm({
  memberId,
  products,
  onCancel,
  onDone,
}: {
  memberId: string
  products: readonly ProductView[]
  onCancel: () => void
  onDone: () => void
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const product = products.find((p) => p.id === productId)
  const [validFrom, setValidFrom] = useState(studioToday())
  const [validUntil, setValidUntil] = useState('')
  const [creditOverride, setCreditOverride] = useState<number | null>(null)
  const [priceTl, setPriceTl] = useState('')
  const [collectedTl, setCollectedTl] = useState('')
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Defaults follow the chosen product + start date.
  const autoUntil = useMemo(() => (product ? addDays(validFrom, product.durationDays) : ''), [product, validFrom])
  const effectiveUntil = validUntil || autoUntil
  const effectivePrice = priceTl !== '' ? priceTl : product ? (product.priceInKurus / 100).toString() : ''
  const effectiveCredit = creditOverride ?? product?.creditCount ?? null

  async function submit() {
    if (!product) return
    setBusy(true)
    setError(null)
    try {
      const res = await assignSubscriptionAction({
        memberId,
        productId,
        validFrom,
        validUntil: effectiveUntil || null,
        priceAgreedKurus: toKurus(effectivePrice),
        creditOverride: product.type === 'credit' ? effectiveCredit : null,
        collectedKurus: toKurus(collectedTl),
        method,
        note: note.trim(),
      })
      if (res.ok) {
        toast.success('Abonelik oluşturuldu.')
        onDone()
      } else {
        setError(domainErrorMessage(res.error))
      }
    } catch {
      setError('Kaydedilemedi. Lütfen tekrar deneyin.')
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <Labeled label="Paket">
        <Select value={productId} onValueChange={(v) => setProductId(v ?? '')}>
          <SelectTrigger>
            <SelectValue placeholder="Paket seç" />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {tl(p.priceInKurus)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Labeled>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Başlangıç">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Labeled>
        <Labeled label="Bitiş">
          <Input type="date" value={effectiveUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Labeled>
        {product?.type === 'credit' ? (
          <Labeled label="Kredi">
            <Input
              type="number"
              min={0}
              value={effectiveCredit ?? ''}
              onChange={(e) => setCreditOverride(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
            />
          </Labeled>
        ) : null}
        <Labeled label="Paket tutarı (TL)">
          <Input type="number" min={0} step="0.01" value={effectivePrice} onChange={(e) => setPriceTl(e.target.value)} />
        </Labeled>
        <Labeled label="Tahsilat (TL)">
          <Input type="number" min={0} step="0.01" value={collectedTl} onChange={(e) => setCollectedTl(e.target.value)} placeholder="0" />
        </Labeled>
        <Labeled label="Ödeme yöntemi">
          <Select value={method} onValueChange={(v) => setMethod(v ?? 'cash')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
      </div>

      <Labeled label="Açıklama">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. kredi/tarih override sebebi" />
      </Labeled>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button className="flex-1" onClick={submit} disabled={busy || !product}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Kaydet
        </Button>
      </div>
    </div>
  )
}

function ReasonDialogShell({
  title,
  description,
  children,
  reason,
  setReason,
  busy,
  onClose,
  onSubmit,
  submitLabel = 'Kaydet',
  destructive = false,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  reason: string
  setReason: (v: string) => void
  busy: boolean
  onClose: () => void
  onSubmit: () => void
  submitLabel?: string
  destructive?: boolean
}) {
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <Textarea placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onSubmit} disabled={busy || reason.trim().length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AmendDialog({ sub, onClose, onDone }: { sub: SubscriptionView; onClose: () => void; onDone: () => void }) {
  const [validFrom, setValidFrom] = useState(new Date(sub.validFrom).toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState(new Date(sub.validUntil).toISOString().slice(0, 10))
  const [priceTl, setPriceTl] = useState((sub.priceAgreedKurus / 100).toString())
  const [collectedTl, setCollectedTl] = useState((sub.paidKurus / 100).toString())
  const [method, setMethod] = useState(sub.method ?? 'cash')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = await amendSubscriptionAction({
        entitlementId: sub.id,
        reason: reason.trim(),
        validFrom,
        validUntil,
        priceAgreedKurus: toKurus(priceTl),
        payment: { collectedKurus: toKurus(collectedTl), method, note: sub.note ?? '' },
      })
      if (res.ok) {
        toast.success('Güncellendi.')
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
      }
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <ReasonDialogShell title="Aboneliği düzenle" reason={reason} setReason={setReason} busy={busy} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Başlangıç">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Labeled>
        <Labeled label="Bitiş">
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Labeled>
        <Labeled label="Paket tutarı (TL)">
          <Input type="number" min={0} step="0.01" value={priceTl} onChange={(e) => setPriceTl(e.target.value)} />
        </Labeled>
        <Labeled label="Tahsilat (TL)">
          <Input type="number" min={0} step="0.01" value={collectedTl} onChange={(e) => setCollectedTl(e.target.value)} />
        </Labeled>
        <Labeled label="Ödeme yöntemi">
          <Select value={method} onValueChange={(v) => setMethod(v ?? 'cash')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
      </div>
    </ReasonDialogShell>
  )
}

function CreditDialog({ sub, onClose, onDone }: { sub: SubscriptionView; onClose: () => void; onDone: () => void }) {
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (delta === 0) {
      toast.error('Sıfırdan farklı bir değişim girin.')
      return
    }
    setBusy(true)
    try {
      const res = await adjustSubscriptionCreditsAction({ entitlementId: sub.id, delta, note: reason.trim() })
      if (res.ok) {
        toast.success('Kredi güncellendi.')
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
      }
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <ReasonDialogShell
      title="Krediyi düzelt"
      description={`Kalan kredi: ${sub.creditsAvailable}. Ekleme +, düşme − girin.`}
      reason={reason}
      setReason={setReason}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <Input type="number" value={delta} onChange={(e) => setDelta(Math.trunc(Number(e.target.value) || 0))} placeholder="+2 / -1" />
    </ReasonDialogShell>
  )
}

function StatusDialog({ sub, onClose, onDone }: { sub: SubscriptionView; onClose: () => void; onDone: () => void }) {
  const reactivating = sub.status === 'cancelled'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = reactivating
        ? await reactivateSubscriptionAction({ entitlementId: sub.id, reason: reason.trim() })
        : await cancelSubscriptionAction({ entitlementId: sub.id, reason: reason.trim() })
      if (res.ok) {
        toast.success(reactivating ? 'Aktifleştirildi.' : 'Pasife alındı.')
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
      setBusy(false)
    }
  }

  return (
    <ReasonDialogShell
      title={reactivating ? 'Aboneliği aktifleştir' : 'Aboneliği pasife al'}
      reason={reason}
      setReason={setReason}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={reactivating ? 'Aktifleştir' : 'Pasife Al'}
      destructive={!reactivating}
    />
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  )
}
