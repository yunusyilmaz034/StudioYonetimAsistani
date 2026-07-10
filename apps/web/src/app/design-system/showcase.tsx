'use client'

import type { ReactNode } from 'react'
import {
  CalendarX2Icon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'

// A labelled section wrapper — showcase furniture only.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  )
}

// Status must never be communicated by colour alone (Doc 09 §7): each carries a
// label. The colour is a token, never a hex value (DS-1).
const STATUS = [
  { label: 'Başarılı', className: 'bg-success/10 text-success' },
  { label: 'Uyarı', className: 'bg-warning/10 text-warning' },
  { label: 'Hata', className: 'bg-danger/10 text-danger' },
  { label: 'Bilgi', className: 'bg-info/10 text-info' },
]

// One dataset, rendered two ways below `md`: cards on mobile, a table on desktop
// (Doc 09 §9, DS-7). Never a wide table at 375px.
const MEMBERS = [
  { id: 'm1', name: 'Ayşe Y.', pkg: 'Pilates 8', remaining: '5' },
  { id: 'm2', name: 'Zeynep K.', pkg: 'Fitness 3 Ay', remaining: '—' },
  { id: 'm3', name: 'Elif D.', pkg: 'Pilates 16', remaining: '12' },
]

export function DesignSystemShowcase() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:space-y-10 sm:p-6 lg:p-8">
      <PageHeader
        title="Design System v1"
        description="Development-only showcase of the foundation components (Doc 09). Verify every section at 375 · 430 · 768 · 1280 px."
        actions={
          <Button className="min-h-11 sm:min-h-0">
            <PlusIcon />
            Yeni Rezervasyon
          </Button>
        }
      />

      <Section title="Button">
        <Button>Rezervasyonu Oluştur</Button>
        <Button variant="outline">Düzenle</Button>
        <Button variant="secondary">İkincil</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Paketi Pasife Al</Button>
        <Button variant="link">Bağlantı</Button>
        <Button disabled>
          <Loader2Icon className="animate-spin" />
          Yükleniyor
        </Button>
      </Section>

      <Section title="Badge">
        <Badge>Aktif</Badge>
        <Badge variant="secondary">Taslak</Badge>
        <Badge variant="outline">Arşiv</Badge>
        <Badge variant="destructive">Pasif</Badge>
        {STATUS.map((s) => (
          <span
            key={s.label}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium ${s.className}`}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </Section>

      <Section title="Form controls — single column (Doc 09 §9)">
        <div className="w-full max-w-sm space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="ds-name" className="text-sm font-medium text-foreground">
              Ad Soyad
            </label>
            <Input id="ds-name" placeholder="Ayşe Yılmaz" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ds-phone" className="text-sm font-medium text-foreground">
              Telefon
            </label>
            <Input id="ds-phone" aria-invalid defaultValue="0212" />
            <p className="text-xs text-danger">Geçerli bir cep telefonu girin.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ds-package" className="text-sm font-medium text-foreground">
              Paket
            </label>
            <Select defaultValue="pilates-8">
              <SelectTrigger id="ds-package" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pilates-8">Pilates 8</SelectItem>
                <SelectItem value="pilates-16">Pilates 16</SelectItem>
                <SelectItem value="pt">PT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ds-note" className="text-sm font-medium text-foreground">
              Not
            </label>
            <Textarea id="ds-note" placeholder="Üye notu…" />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox defaultChecked />
            KVKK aydınlatma metnini onaylıyorum
          </label>
        </div>
      </Section>

      <Section title="Card">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>8 Ders Pilates Paketi</CardTitle>
            <CardDescription>Kalan: 5 ders · Son kullanım: 30 Ağustos</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Structure is drawn with borders, not shadows (Doc 09 §5).
          </CardContent>
          <CardFooter>
            <Button variant="outline">Detayı Aç</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Responsive list — cards on mobile, table at md+ (DS-7)">
        <div className="w-full">
          {/* Mobile (< md): the same rows as cards. No horizontal scroll at 375px. */}
          <div className="space-y-2 md:hidden">
            {MEMBERS.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.pkg}</p>
                </div>
                <span className="shrink-0 tabular-nums text-sm text-foreground">
                  {m.remaining}
                </span>
              </div>
            ))}
          </div>

          {/* Desktop (md+): the table returns. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Üye</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead className="text-right">Kalan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MEMBERS.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>{m.pkg}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.remaining}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Section>

      <Section title="Search + filters — Sheet on mobile (Doc 09 §9)">
        <div className="flex w-full items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Üye ara…" />
          </div>
          <Sheet>
            <SheetTrigger
              render={<Button variant="outline" className="min-h-11 sm:min-h-0" />}
            >
              <SlidersHorizontalIcon />
              Filtreler
            </SheetTrigger>
            <SheetContent side="right" className="gap-4 p-4">
              <SheetHeader className="p-0">
                <SheetTitle>Filtreler</SheetTitle>
                <SheetDescription>
                  On mobile, filters open in a Sheet instead of eating vertical space.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3">
                <Select defaultValue="all">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm kategoriler</SelectItem>
                    <SelectItem value="pilates_group">Pilates</SelectItem>
                    <SelectItem value="fitness">Fitness</SelectItem>
                    <SelectItem value="private">PT</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox defaultChecked />
                  Sadece aktif üyeler
                </label>
              </div>
              <SheetFooter className="p-0">
                <SheetClose render={<Button className="min-h-11 w-full">Uygula</Button>} />
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </Section>

      <Section title="Sticky bottom action bar — thumb zone (Doc 09 §9)">
        <div className="w-full max-w-[375px] overflow-hidden rounded-xl border border-border">
          <div className="relative h-72 overflow-y-auto">
            <div className="space-y-3 p-4">
              <p className="text-sm font-medium text-foreground">Yeni Rezervasyon</p>
              <p className="text-sm text-muted-foreground">
                A mock 375px viewport. Scroll: the primary action stays pinned to the
                bottom, within thumb reach, while the form scrolls behind it.
              </p>
              {['Üye', 'Ders', 'Paket', 'Tarih', 'Saat', 'Not'].map((f) => (
                <div key={f} className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">{f}</label>
                  <Input placeholder={`${f}…`} />
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 border-t border-border bg-surface p-3">
              <Button className="min-h-11 w-full">Rezervasyonu Oluştur</Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Overlays — Drawer & Dialog">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Detay çekmecesi</SheetTrigger>
          <SheetContent side="right" className="gap-4 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Üye Detayı</SheetTitle>
              <SheetDescription>
                Detail/edit uses a full-width Sheet on mobile, a side drawer on desktop
                (Doc 09 §9).
              </SheetDescription>
            </SheetHeader>
            <SheetFooter className="p-0">
              <SheetClose render={<Button className="min-h-11 w-full sm:min-h-0 sm:w-auto" />}>
                Kapat
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Dialog>
          <DialogTrigger render={<Button variant="destructive" />}>
            Paketi Pasife Al
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Paketi pasife al?</DialogTitle>
              <DialogDescription>
                Bu paket artık satışta görünmeyecek. Mevcut üyelikler etkilenmez.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Vazgeç</DialogClose>
              <DialogClose render={<Button variant="destructive" />}>
                Paketi Pasife Al
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Toast — feedback states">
        <Button variant="outline" onClick={() => toast.success('Rezervasyon oluşturuldu')}>
          Başarı
        </Button>
        <Button variant="outline" onClick={() => toast.error('Bağlantı yok')}>
          Hata
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.loading('Kaydediliyor…', { duration: 1500 })}
        >
          Yükleniyor
        </Button>
        <Button variant="outline" onClick={() => toast.info('3 üye giriş yapmadı')}>
          Bilgi
        </Button>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={CalendarX2Icon}
          title="Bugün ders yok"
          description="Bu şube için bugüne planlanmış bir ders bulunmuyor."
          action={
            <Button>
              <PlusIcon />
              Ders Ekle
            </Button>
          }
        />
      </Section>

      <Toaster />
    </div>
  )
}
