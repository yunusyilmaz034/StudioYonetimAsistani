'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import {
  deactivateRetailProductAction,
  listRetailProductsAction,
  upsertRetailProductAction,
  type RetailProductRow,
} from '@/server/actions/retail'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

// Ürünler (Retail) — physical items sold alongside packages. This panel only MANAGES the catalogue
// (add / edit / activate). SELLING lives on its own "Ürün Sat" screen in the nav (owner request,
// 2026-07-16) — Ayarlar is configuration, not a till.
export function RetailPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<readonly RetailProductRow[] | null>(null)
  const [editing, setEditing] = useState<RetailProductRow | 'new' | null>(null)

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
      hint="Matara, çorap, havlu gibi fiziksel ürünler. Burada tanımlanır; satış sol menüden “Ürün Sat” ekranından yapılır."
      actions={
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <PlusIcon />
            Ürün ekle
          </Button>
        ) : null
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
