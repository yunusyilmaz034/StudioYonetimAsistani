'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PackageIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import type { ProductView, ServiceOption } from '@/server/catalog-query'

import { CATEGORY_LABEL, ProductForm } from './product-form'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} TL`

export function PackagesScreen({
  products,
  services,
}: {
  products: readonly ProductView[]
  services: readonly ServiceOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProductView | null>(null)

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }
  const openEdit = (p: ProductView) => {
    setEditing(p)
    setOpen(true)
  }
  const onDone = () => {
    setOpen(false)
    setEditing(null)
    router.refresh()
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Toaster />
      <PageHeader
        title="Paketler"
        description={`${products.length} paket`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" render={<Link href="/" />}>
              Ana Sayfa
            </Button>
            <Button className="min-h-11 sm:min-h-0" onClick={openCreate}>
              <PlusIcon />
              Yeni Paket
            </Button>
          </div>
        }
      />

      {products.length === 0 ? (
        <EmptyState icon={PackageIcon} title="Henüz paket yok" description="İlk paketi oluşturun." action={<Button onClick={openCreate}><PlusIcon />Yeni Paket</Button>} />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2 md:hidden">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openEdit(p)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {CATEGORY_LABEL[p.category] ?? p.category} · {p.type === 'credit' ? `${p.creditCount} ders` : 'Sınırsız'} · {tl(p.priceInKurus)}
                  </p>
                </div>
                {p.active ? null : <Badge variant="outline">Pasif</Badge>}
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Paket</th>
                  <th className="py-2 pr-3 font-medium">Kategori</th>
                  <th className="py-2 pr-3 font-medium">İçerik</th>
                  <th className="py-2 pr-3 font-medium">Süre</th>
                  <th className="py-2 pr-3 font-medium">Fiyat</th>
                  <th className="py-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} onClick={() => openEdit(p)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="py-2.5 pr-3 font-medium">{p.name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{CATEGORY_LABEL[p.category] ?? p.category}</td>
                    <td className="py-2.5 pr-3">{p.type === 'credit' ? `${p.creditCount} ders` : 'Sınırsız'}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{p.durationDays} gün</td>
                    <td className="py-2.5 pr-3 tabular-nums">{tl(p.priceInKurus)}</td>
                    <td className="py-2.5">
                      {p.active ? <Badge className="bg-success/10 text-success">Aktif</Badge> : <Badge variant="outline">Pasif</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md">
          <SheetHeader className="p-0">
            <SheetTitle>{editing ? 'Paketi Düzenle' : 'Yeni Paket'}</SheetTitle>
          </SheetHeader>
          <ProductForm product={editing} services={services} onDone={onDone} />
        </SheetContent>
      </Sheet>
    </main>
  )
}
