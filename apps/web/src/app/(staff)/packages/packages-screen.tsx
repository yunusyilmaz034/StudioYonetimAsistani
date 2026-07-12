'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader
        title="Paketler"
        description={`${products.length} paket`}
        actions={
          <Button className="min-h-11 sm:min-h-0" onClick={openCreate}>
            <PlusIcon />
            Yeni Paket
          </Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState icon={PackageIcon} title="Henüz paket yok" description="İlk paketi oluşturun." action={<Button onClick={openCreate}><PlusIcon />Yeni Paket</Button>} />
      ) : (
        <>
          {/* Mobile: one card, rows inside — not a stack of boxes. */}
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm md:hidden">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openEdit(p)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-primary-soft/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {CATEGORY_LABEL[p.category] ?? p.category} · {p.type === 'credit' ? `${p.creditCount} ders` : 'Sınırsız'} ·{' '}
                    <span className="tabular-nums">{tl(p.priceInKurus)}</span>
                  </p>
                </div>
                <StatusCell active={p.active} />
              </button>
            ))}
          </div>

          {/* Desktop: the price list on one surface. Money is right-aligned and tabular so a
              column of prices can be scanned down, not read one by one. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <Th>Paket</Th>
                  <Th>Kategori</Th>
                  <Th>İçerik</Th>
                  <Th className="text-right">Süre</Th>
                  <Th className="text-right">Fiyat</Th>
                  <Th className="w-28">Durum</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => openEdit(p)}
                    className="cursor-pointer transition-colors hover:bg-primary-soft/40"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{CATEGORY_LABEL[p.category] ?? p.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.type === 'credit' ? `${p.creditCount} ders` : 'Sınırsız'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{p.durationDays} gün</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">{tl(p.priceInKurus)}</td>
                    <td className="w-28 px-4 py-3 whitespace-nowrap">
                      <StatusCell active={p.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md sm:p-5">
          <SheetHeader className="p-0">
            <SheetTitle className="text-h1">{editing ? 'Paketi Düzenle' : 'Yeni Paket'}</SheetTitle>
          </SheetHeader>
          <ProductForm product={editing} services={services} onDone={onDone} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide whitespace-nowrap uppercase text-muted-foreground ${className}`}
    >
      {children}
    </th>
  )
}

// Same rule as the member list: an active product is the norm and reads as a quiet caption;
// a passive one is a state someone may need to act on, so it gets a badge.
function StatusCell({ active }: { active: boolean }) {
  return active ? (
    <span className="text-xs text-muted-foreground">Aktif</span>
  ) : (
    <Badge className="bg-muted text-muted-foreground">Pasif</Badge>
  )
}
