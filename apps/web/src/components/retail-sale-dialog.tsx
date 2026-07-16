'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2Icon, PackageIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import { listBookingMembersAction, type BookingMember } from '@/server/actions/booking'
import { sellRetailProductAction, type RetailProductRow } from '@/server/actions/retail'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

// The retail sale flow — pick a member, add quantities, choose a method, sell. The money goes through
// the finance sale and stock is decremented transactionally (no oversell; `retail_out_of_stock` is
// refused, never clamped). Selling lives on its own "Ürün Sat" screen; Ayarlar only manages the list.
export function RetailSaleDialog({
  products,
  onClose,
  onSold,
}: {
  products: readonly RetailProductRow[]
  onClose: () => void
  onSold: () => void
}) {
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [member, setMember] = useState<BookingMember | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'credit_card'>('cash')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listBookingMembersAction()
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [])

  const filtered = useMemo(() => {
    if (!members) return []
    const q = query.trim().toLocaleLowerCase('tr')
    return (q ? members.filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q)) : members).slice(0, 20)
  }, [members, query])

  const items = products.map((p) => ({ p, q: qty[p.id] ?? 0 })).filter((x) => x.q > 0)
  const total = items.reduce((s, x) => s + x.p.priceInKurus * x.q, 0)

  const submit = async () => {
    if (!member || items.length === 0) return
    setBusy(true)
    try {
      const res = await sellRetailProductAction({
        memberId: member.id,
        items: items.map((x) => ({ retailProductId: x.p.id, quantity: x.q })),
        method,
      })
      if (res.ok) {
        toast.success('Satış tamamlandı.')
        onSold()
      } else {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
      }
    } catch {
      toast.error('Satış tamamlanamadı.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ürün Sat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {member ? (
            <div className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
              <span className="font-medium">{member.fullName}</span>
              <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
                Değiştir
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Üye ara…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              </div>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {filtered.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="w-full p-2 text-left text-sm hover:bg-muted" onClick={() => setMember(m)}>
                      {m.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {member ? (
            <>
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <PackageIcon className="size-3.5" /> Ürünler
              </p>
              <ul className="space-y-1.5">
                {products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {p.name} · {tl(p.priceInKurus)}
                      {p.trackStock ? <span className="text-xs text-muted-foreground"> (stok {p.stock})</span> : null}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      className="w-16"
                      value={qty[p.id] ?? 0}
                      onChange={(e) => setQty((s) => ({ ...s, [p.id]: Math.max(0, Number(e.target.value) || 0) }))}
                    />
                  </li>
                ))}
              </ul>
              <Select value={method} onValueChange={(v) => setMethod((v as typeof method) ?? 'cash')}>
                <SelectTrigger>
                  <SelectValue>
                    {(v: unknown) => (v === 'cash' ? 'Nakit' : v === 'bank_transfer' ? 'Havale/EFT' : 'Kredi kartı')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Nakit</SelectItem>
                  <SelectItem value="bank_transfer">Havale/EFT</SelectItem>
                  <SelectItem value="credit_card">Kredi kartı</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-right text-sm font-semibold">Toplam: {tl(total)}</p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !member || items.length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Sat ({tl(total)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
