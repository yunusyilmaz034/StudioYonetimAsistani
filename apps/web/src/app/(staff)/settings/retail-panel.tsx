'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2Icon, PackageIcon, PlusIcon, SearchIcon, ShoppingCartIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import { listBookingMembersAction, type BookingMember } from '@/server/actions/booking'
import {
  deactivateRetailProductAction,
  listRetailProductsAction,
  sellRetailProductAction,
  upsertRetailProductAction,
  type RetailProductRow,
} from '@/server/actions/retail'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

// Ürünler (Retail) — physical items sold alongside packages. Lightweight config; the money goes
// through the finance sale, and stock is decremented transactionally (no oversell).
export function RetailPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<readonly RetailProductRow[] | null>(null)
  const [editing, setEditing] = useState<RetailProductRow | 'new' | null>(null)
  const [selling, setSelling] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await listRetailProductsAction())
    } catch {
      setRows([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const toggleActive = async (r: RetailProductRow) => {
    const res = await deactivateRetailProductAction({ id: r.id, active: !r.active })
    if (res.ok) void load()
  }

  return (
    <Section
      title="Ürünler (Retail)"
      hint="Matara, çorap, havlu gibi fiziksel ürünler. Satış finans defterine işlenir; stok takibi açıksa stok düşülür."
      actions={
        <div className="flex gap-2">
          {rows && rows.some((r) => r.active) ? (
            <Button variant="outline" size="sm" onClick={() => setSelling(true)}>
              <ShoppingCartIcon />
              Ürün Sat
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
              <PlusIcon />
              Ürün ekle
            </Button>
          ) : null}
        </div>
      }
    >
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz ürün yok.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {r.name}
                  {r.active ? null : <Badge className="bg-muted text-muted-foreground">Pasif</Badge>}
                  {r.sku ? <span className="text-xs text-muted-foreground">· {r.sku}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tl(r.priceInKurus)}
                  {r.taxRatePercent ? ` · KDV %${r.taxRatePercent}` : ''}
                  {r.trackStock ? ` · Stok: ${r.stock}` : ''}
                </p>
              </div>
              {canManage ? (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                    Düzenle
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void toggleActive(r)}>
                    {r.active ? 'Kapat' : 'Aç'}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <RetailEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}
      {selling ? (
        <RetailSaleDialog
          products={(rows ?? []).filter((r) => r.active)}
          onClose={() => setSelling(false)}
          onSold={() => {
            setSelling(false)
            void load()
          }}
        />
      ) : null}
    </Section>
  )
}

function RetailEditor({ initial, onClose, onSaved }: { initial: RetailProductRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [priceTl, setPriceTl] = useState(initial ? String(initial.priceInKurus / 100) : '')
  const [tax, setTax] = useState(String(initial?.taxRatePercent ?? 0))
  const [trackStock, setTrackStock] = useState(initial?.trackStock ?? false)
  const [stock, setStock] = useState(String(initial?.stock ?? 0))
  const [category, setCategory] = useState(initial?.category ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await upsertRetailProductAction({
        ...(initial ? { id: initial.id } : {}),
        name: name.trim(),
        sku: sku.trim(),
        priceInKurus: Math.round((Number(priceTl) || 0) * 100),
        taxRatePercent: Number(tax) || 0,
        trackStock,
        stock: trackStock ? Math.max(0, Number(stock) || 0) : 0,
        active: initial?.active ?? true,
        category: category.trim(),
      })
      toast.success('Ürün kaydedildi.')
      onSaved()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Ürünü düzenle' : 'Ürün ekle'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Ad (ör. Matara)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="SKU (ops.)" value={sku} onChange={(e) => setSku(e.target.value)} />
            <Input placeholder="Kategori (ops.)" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Fiyat (TL)
              <Input type="number" min={0} step="0.01" value={priceTl} onChange={(e) => setPriceTl(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              KDV %
              <Input type="number" min={0} max={100} value={tax} onChange={(e) => setTax(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={trackStock} onCheckedChange={(v) => setTrackStock(v === true)} />
            Stok takibi
          </label>
          {trackStock ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Stok adedi
              <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={busy || name.trim().length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RetailSaleDialog({ products, onClose, onSold }: { products: readonly RetailProductRow[]; onClose: () => void; onSold: () => void }) {
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
