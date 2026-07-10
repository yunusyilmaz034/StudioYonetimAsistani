'use client'

import type { ReactNode } from 'react'
import { CalendarX2Icon, Loader2Icon, PlusIcon } from 'lucide-react'
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

export function DesignSystemShowcase() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 p-8">
      <PageHeader
        title="Design System v1"
        description="Development-only showcase of the foundation components (Doc 09)."
        actions={
          <Button>
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

      <Section title="Form controls">
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

      <Section title="Table">
        <div className="w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Üye</TableHead>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Kalan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Ayşe Y.</TableCell>
                <TableCell>Pilates 8</TableCell>
                <TableCell className="text-right tabular-nums">5</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Zeynep K.</TableCell>
                <TableCell>Fitness 3 Ay</TableCell>
                <TableCell className="text-right tabular-nums">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Overlays — Drawer & Dialog">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Detay çekmecesi</SheetTrigger>
          <SheetContent side="right" className="p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Üye Detayı</SheetTitle>
              <SheetDescription>
                Detail and edit workflows use a side drawer (Doc 09 §7).
              </SheetDescription>
            </SheetHeader>
            <SheetFooter className="p-0">
              <SheetClose render={<Button>Kapat</Button>} />
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
