'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, CreditCardIcon, Loader2Icon, SearchIcon, UserCheckIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { cancelCollectionAction, reconcileCollectionAction, type UnreconciledCollectionRow } from '@/server/actions/collections'
import type { ProductView } from '@/server/catalog-query'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
const todayISO = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10) // TR day
const addDays = (iso: string, days: number) => {
  const dt = new Date(`${iso}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

interface Member {
  id: string
  name: string
  phone: string
}

export function CollectionsScreen({
  collections,
  products,
  members,
}: {
  collections: readonly UnreconciledCollectionRow[]
  products: readonly ProductView[]
  members: readonly Member[]
}) {
  const [target, setTarget] = useState<UnreconciledCollectionRow | null>(null)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Eşleştirilecek Ödemeler"
        description="Paylaşılan linkten gelen PAYTR ödemeleri. Kim ödediğini bulun, üyeye paketini ekleyin."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/finance" />}>
            <ArrowLeftIcon />
            Kasa
          </Button>
        }
      />

      {collections.length === 0 ? (
        <EmptyState icon={CreditCardIcon} title="Bekleyen ödeme yok" description="Link ödemeleri geldikçe burada eşleştirmek için görünür." />
      ) : (
        <ul className="space-y-2">
          {collections.map((c) => (
            <li key={c.id} className="rounded-xl border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.buyerName} · <span className="tabular-nums">{tl(c.amountKurus)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {c.buyerPhone} · {d(c.paidAt)} · {c.installments > 1 ? `${c.installments} taksit` : 'tek çekim'}
                  </p>
                  {c.suggestedMember ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <UserCheckIcon className="size-3.5" /> Bu üye olabilir: {c.suggestedMember.name}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => setTarget(c)}>
                    Üyeye Bağla
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {target ? (
        <ReconcileDialog collection={target} products={products} members={members} onClose={() => setTarget(null)} />
      ) : null}
    </main>
  )
}

function ReconcileDialog({
  collection,
  products,
  members,
  onClose,
}: {
  collection: UnreconciledCollectionRow
  products: readonly ProductView[]
  members: readonly Member[]
  onClose: () => void
}) {
  const router = useRouter()
  const [memberId, setMemberId] = useState(collection.suggestedMember?.id ?? '')
  const [memberQuery, setMemberQuery] = useState('')
  const [productId, setProductId] = useState('')
  const [validFrom, setValidFrom] = useState(todayISO())
  const [busy, setBusy] = useState(false)

  const product = products.find((p) => p.id === productId) ?? null
  const validUntil = product && product.durationDays > 0 ? addDays(validFrom, product.durationDays) : null
  const selectedMember = members.find((m) => m.id === memberId) ?? null

  const matches = useMemo(() => {
    const q = memberQuery.trim().toLocaleLowerCase('tr')
    const digits = memberQuery.replace(/\D/g, '')
    if (!q && !digits) return []
    return members
      .filter((m) => m.name.toLocaleLowerCase('tr').includes(q) || (digits.length > 2 && m.phone.includes(digits)))
      .slice(0, 6)
  }, [members, memberQuery])

  async function reconcile() {
    if (!memberId) return void toast.error('Bir üye seçin.')
    if (!productId) return void toast.error('Bir paket seçin.')
    setBusy(true)
    try {
      const res = await reconcileCollectionAction({
        collectionId: collection.id,
        memberId,
        productId,
        validFrom,
        validUntil,
        priceAgreedKurus: collection.amountKurus,
        creditOverride: null,
      })
      if (res.ok) {
        toast.success('Ödeme üyeye eşleştirildi ve paketi eklendi.')
        router.refresh()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  async function cancel() {
    const reason = window.prompt('Bu ödemeyi neden kapatıyorsunuz? (ör. test ödemesi)')
    if (!reason || reason.trim().length === 0) return
    setBusy(true)
    try {
      const res = await cancelCollectionAction({ collectionId: collection.id, reason: reason.trim() })
      if (res.ok) {
        toast.success('Ödeme kapatıldı.')
        router.refresh()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Üyeye Bağla</DialogTitle>
          <DialogDescription>
            {collection.buyerName} · {tl(collection.amountKurus)} · {collection.buyerPhone}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Member */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Üye</label>
            {selectedMember ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{selectedMember.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setMemberId('')}>
                  Değiştir
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-8" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="İsim veya telefon ara…" />
                </div>
                {matches.length > 0 ? (
                  <ul className="max-h-40 overflow-y-auto rounded-lg border border-border">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setMemberId(m.id)
                            setMemberQuery('')
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span>{m.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{m.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs text-muted-foreground">Üye sistemde yoksa önce Üyeler’den ekleyin, sonra buraya dönün.</p>
              </>
            )}
          </div>

          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Paket</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-transparent px-3 text-sm"
            >
              <option value="">Paket seçin…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {tl(p.priceInKurus)}
                </option>
              ))}
            </select>
          </div>

          {/* Validity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Başlangıç</label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bitiş</label>
              <Input type="date" value={validUntil ?? ''} disabled readOnly />
            </div>
          </div>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Ödeme <span className="font-medium text-foreground">{tl(collection.amountKurus)}</span> kredi kartı (KK) olarak kasaya işlenir ve bu üyeyle eşleşir.
          </p>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={() => void cancel()} disabled={busy}>
            Bizim değil / iptal et
          </Button>
          <Button onClick={() => void reconcile()} disabled={busy || !memberId || !productId}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Bağla ve Paketi Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
