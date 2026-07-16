'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShoppingCartIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { RetailSaleDialog } from '@/components/retail-sale-dialog'
import { listRetailProductsAction, type RetailProductRow } from '@/server/actions/retail'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

export function RetailScreen() {
  const [rows, setRows] = useState<readonly RetailProductRow[] | null>(null)
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

  const sellable = (rows ?? []).filter((r) => r.active)

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ürün Sat"
        description="Matara, çorap, havlu gibi ürünleri üyeye sat. Ürünleri Ayarlar › Ürünler'den tanımlarsın."
        actions={
          sellable.length > 0 ? (
            <Button onClick={() => setSelling(true)}>
              <ShoppingCartIcon /> Ürün Sat
            </Button>
          ) : null
        }
      />

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : sellable.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Satılabilir ürün yok. Önce <span className="font-medium">Ayarlar › Ürünler</span>&apos;den ürün ekleyin.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {sellable.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.name}
                  {r.sku ? <span className="text-xs text-muted-foreground"> · {r.sku}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tl(r.priceInKurus)}
                  {r.taxRatePercent ? ` · KDV %${r.taxRatePercent}` : ''}
                  {r.trackStock ? ` · Stok: ${r.stock}` : ''}
                </p>
              </div>
              {r.trackStock ? <Badge className="bg-muted text-muted-foreground">Stok {r.stock}</Badge> : null}
            </li>
          ))}
        </ul>
      )}

      {selling ? (
        <RetailSaleDialog
          products={sellable}
          onClose={() => setSelling(false)}
          onSold={() => {
            setSelling(false)
            void load()
          }}
        />
      ) : null}
    </main>
  )
}
