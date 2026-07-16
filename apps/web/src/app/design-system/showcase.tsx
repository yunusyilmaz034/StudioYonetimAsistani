'use client'

import type { ReactNode } from 'react'
import {
  BanIcon,
  CalendarIcon,
  CalendarX2Icon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DoorOpenIcon,
  Loader2Icon,
  LogInIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Section as HouseSection } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-0.5">
        <h2 className="font-heading text-h3 font-medium text-foreground">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

const COLORS = [
  ['Mulberry', 'bg-primary'],
  ['Mulberry koyu', 'bg-primary-hover'],
  ['Blush', 'bg-primary-soft'],
  ['Altın (gold)', 'bg-gold'],
  ['Altın soft', 'bg-gold-soft'],
  ['Porselen', 'bg-background'],
  ['Sıcak beyaz', 'bg-surface'],
  ['Greige', 'bg-muted'],
  ['Çizgi', 'bg-border'],
  ['Erik-siyah', 'bg-foreground'],
  ['Success', 'bg-success'],
  ['Warning', 'bg-warning'],
  ['Danger', 'bg-danger'],
  ['Info', 'bg-info'],
] as const

// Editorial serif for the display/heading rows (Doc 33); body stays sans.
const TYPE = [
  ['font-heading text-display font-medium', 'Display · Serif', 'Kontrollü Zarafet'],
  ['font-heading text-h1 font-medium', 'H1 · Serif', 'Genel Görünüm'],
  ['font-heading text-h2 font-medium', 'H2 · Serif', 'Bugünkü Dersler'],
  ['font-heading text-h3 font-medium', 'H3 · Serif', 'Reformer Pilates'],
  ['text-base', 'Body · Sans 16', 'Üye rezervasyonu başarıyla oluşturuldu.'],
  ['text-sm', 'Body S · Sans 14', 'Reception bu ekranı gün boyu kullanır.'],
  ['text-xs text-muted-foreground', 'Caption · 12', '30 Ağustos · son kullanım'],
] as const

const ELEVATION = [
  ['shadow-xs', 'XS'],
  ['shadow-sm', 'SM · kart'],
  ['shadow-md', 'MD · popover'],
  ['shadow-lg', 'LG · modal'],
] as const

const STATUS = [
  { label: 'Başarılı', className: 'bg-success/10 text-success' },
  { label: 'Uyarı', className: 'bg-warning/10 text-warning' },
  { label: 'Hata', className: 'bg-danger/10 text-danger' },
  { label: 'Bilgi', className: 'bg-info/10 text-info' },
]

const MEMBERS = [
  { id: 'm1', name: 'Ayşe Yıldırım', pkg: 'Pilates 8', remaining: '5' },
  { id: 'm2', name: 'Zeynep Koç', pkg: 'Fitness 3 Ay', remaining: '—' },
  { id: 'm3', name: 'Elif Demir', pkg: 'Pilates 16', remaining: '12' },
]

export function DesignSystemShowcase() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Design System v2 — Owner UI"
        description="Foundation checkpoint. Tüm component'ler ve state'ler burada; hiçbir ekran henüz redesign edilmedi. 375 · 430 · 768 · 1280 px'de doğrulayın."
        actions={
          <Button>
            <PlusIcon />
            Birincil Aksiyon
          </Button>
        }
      />

      {/* ── Foundations ─────────────────────────────────────────────── */}
      <Section title="Renk token'ları" hint="Semantic token'lar; component'lerde hex yok (DS-1). Aksan (teal) az kullanılır.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map(([name, bg]) => (
            <div key={name} className="space-y-1.5">
              <div className={`h-14 rounded-lg border border-border ${bg}`} />
              <p className="text-xs text-muted-foreground">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografi" hint="Operasyonel 14px tabanı üzerinde kademeli hiyerarşi. Geist; başlıklarda sıkı tracking.">
        <div className="space-y-3">
          {TYPE.map(([cls, meta, sample]) => (
            <div key={meta} className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{meta}</span>
              <span className={`${cls} text-foreground`}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation" hint="Yumuşak, alçak gölgeler (Stripe/Linear). Hairline border + sessiz gölge; ağır drop-shadow yok.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {ELEVATION.map(([shadow, name]) => (
            <div key={shadow} className={`flex h-20 items-center justify-center rounded-xl border border-border bg-card ${shadow}`}>
              <span className="text-xs text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius & spacing" hint="Kontrol 8px (rounded-lg), kart 12px (rounded-xl); 4px ritmi, dengeli boşluk.">
        <div className="flex flex-wrap items-end gap-4">
          {[['rounded-md', 'sm'], ['rounded-lg', 'kontrol'], ['rounded-xl', 'kart'], ['rounded-2xl', 'overlay']].map(([r, n]) => (
            <div key={r} className="space-y-1.5 text-center">
              <div className={`size-16 border border-border bg-muted ${r}`} />
              <p className="text-xs text-muted-foreground">{n}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Components ──────────────────────────────────────────────── */}
      <Section title="Button — varyant, boyut, state">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Birincil</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">İkincil</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Tehlike</Button>
            <Button variant="link">Bağlantı</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Küçük</Button>
            <Button>Varsayılan</Button>
            <Button size="lg">Büyük</Button>
            <Button size="icon" aria-label="Ekle"><PlusIcon /></Button>
            <Button size="icon-sm" variant="outline" aria-label="Düzenle"><PencilIcon /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled>Devre dışı</Button>
            <Button disabled><Loader2Icon className="animate-spin" />Yükleniyor</Button>
            <Button variant="outline"><CheckIcon />İkonlu</Button>
          </div>
        </div>
      </Section>

      <Section title="Badge & durum" hint="Renk asla tek başına anlam taşımaz — her durum etiketli (Doc 09 §7).">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Aktif</Badge>
          <Badge variant="secondary">Taslak</Badge>
          <Badge variant="outline">Arşiv</Badge>
          <Badge variant="destructive">Pasif</Badge>
          {STATUS.map((s) => (
            <span key={s.label} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium ${s.className}`}>
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Form controls" hint="Tek sütun, büyük dokunma hedefleri; default / focus / hata / devre-dışı.">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <Field label="Ad Soyad">
              <Input placeholder="Ayşe Yılmaz" />
            </Field>
            <Field label="Telefon" error="Geçerli bir cep telefonu girin.">
              <Input aria-invalid defaultValue="0212" />
            </Field>
            <Field label="Devre dışı">
              <Input disabled defaultValue="Düzenlenemez" />
            </Field>
          </div>
          <div className="space-y-4">
            <Field label="Paket">
              <Select defaultValue="pilates-8">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pilates-8">Pilates 8</SelectItem>
                  <SelectItem value="pilates-16">Pilates 16</SelectItem>
                  <SelectItem value="pt">PT</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Not">
              <Textarea placeholder="Üye notu…" rows={3} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox defaultChecked />
              KVKK aydınlatma metnini onaylıyorum
            </label>
          </div>
        </div>
      </Section>

      <Section title="Tabs" hint="Workspace ekranlarının sekme sistemi (Session / Member Workspace).">
        <Tabs defaultValue="info" className="max-w-md">
          <TabsList className="w-full">
            <TabsTrigger value="info">Ders Bilgileri</TabsTrigger>
            <TabsTrigger value="res">Rezervasyonlar</TabsTrigger>
            <TabsTrigger value="att">Yoklama</TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
            Ders bilgileri sekmesi içeriği.
          </TabsContent>
          <TabsContent value="res" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
            Rezervasyon listesi + üye ekle.
          </TabsContent>
          <TabsContent value="att" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
            Tek dokunuş yoklama.
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        title="MetricStrip — bir ekranın manşet rakamları"
        hint="Tek yüzey, birkaç metrik — dört ayrı kutu değil. Rakam bloktaki en ağır öğedir; renk yalnızca sayı operasyonel bir anlam taşıyorsa (Dashboard, takvimler, Yoklama, Üye Detayı)."
      >
        <div className="space-y-3">
          <MetricStrip>
            <Metric label="Şu an içeride" value={14} icon={DoorOpenIcon} />
            <Metric label="Bugün giriş" value={38} icon={LogInIcon} />
            <Metric label="Bugünkü grup dersi" value={9} icon={CalendarIcon} />
            <Metric label="Bekleyen bakiye" value="4.250 TL" icon={WalletIcon} tone="danger" />
          </MetricStrip>
          {/* compact — yoğun ekranlarda (takvimler) şeridin işi aşağı itmemesi için */}
          <MetricStrip>
            <Metric compact label="Seans" value={12} icon={CalendarIcon} />
            <Metric compact label="Rezervasyon" value="86/120" icon={UsersIcon} />
            <Metric compact label="Bekleyen" value={7} icon={ClockIcon} tone="warning" />
            <Metric compact label="İptal" value={0} icon={BanIcon} />
          </MetricStrip>
        </div>
      </Section>

      <Section title="Section — ekranı anlamlı bölgelere ayırır" hint="Gruplama kutuyla değil, sessiz bir başlık + boşlukla taşınır: daha az çizgi, daha çok yapı.">
        <HouseSection
          title="Dikkat gerektirenler"
          hint="takip edilecek"
          actions={
            <Button size="sm" variant="outline">
              Tümünü gör
            </Button>
          }
        >
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Bölümün içeriği.
          </div>
        </HouseSection>
      </Section>

      <Section title="Card — elevated">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>8 Ders Pilates Paketi</CardTitle>
            <CardDescription>Kalan: 5 ders · Son kullanım: 30 Ağustos</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Hairline border + yumuşak gölge ile hafif elevation.
          </CardContent>
          <CardFooter>
            <Button variant="outline">Detayı Aç</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Liste — mobilde kart, md+ tablo (DS-7)">
        <div className="space-y-2 md:hidden">
          {MEMBERS.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{m.name}</p>
                <p className="truncate text-xs text-muted-foreground">{m.pkg}</p>
              </div>
              <span className="shrink-0 tabular-nums text-sm text-foreground">{m.remaining}</span>
            </div>
          ))}
        </div>
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
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-muted-foreground">{m.pkg}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.remaining}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Pattern'ler" hint="Sistemin nav öğesi, filtre çubuğu ve takvim hücresi gibi tekrar eden kalıpları.">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* nav item */}
          <div className="space-y-1 rounded-xl border border-border bg-surface p-2">
            <a className="flex items-center gap-3 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              <UsersIcon className="size-4" /> Üyeler
              <ChevronRightIcon className="ml-auto size-4 opacity-60" />
            </a>
            <a className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <CalendarX2Icon className="size-4" /> Ders Ajandası
            </a>
          </div>
          {/* calendar cell */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="mb-1 text-xs text-muted-foreground">Salı · 12</p>
            <div className="rounded border-l-2 border-primary bg-muted/40 px-1.5 py-1 text-[11px] leading-tight">
              <p className="font-medium text-foreground">10:30 Reformer <span className="text-muted-foreground">(5/8)</span></p>
              <p className="text-muted-foreground">Ayşe Yıldırım</p>
              <p className="text-muted-foreground">Zeynep Koç</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Filtre çubuğu">
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Üye ara…" />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="min-w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Kategori: Tümü</SelectItem>
              <SelectItem value="pilates_group">Pilates</SelectItem>
              <SelectItem value="fitness">Fitness</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost">Temizle</Button>
        </div>
      </Section>

      <Section title="Overlay'ler — Drawer & Modal">
        <div className="flex flex-wrap gap-2">
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Detay çekmecesi</SheetTrigger>
            <SheetContent side="right" className="gap-4 p-4">
              <SheetHeader className="p-0">
                <SheetTitle>Üye Detayı</SheetTitle>
                <SheetDescription>Mobilde tam genişlik Sheet, masaüstünde yan çekmece.</SheetDescription>
              </SheetHeader>
              <SheetFooter className="p-0">
                <SheetClose render={<Button className="min-h-11 w-full sm:min-h-0 sm:w-auto" />}>Kapat</SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Dialog>
            <DialogTrigger render={<Button variant="destructive" />}>Paketi Pasife Al</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Paketi pasife al?</DialogTitle>
                <DialogDescription>Bu paket artık satışta görünmeyecek. Mevcut üyelikler etkilenmez.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Vazgeç</DialogClose>
                <DialogClose render={<Button variant="destructive" />}>Pasife Al</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section title="Toast & boş durum">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => toast.success('Rezervasyon oluşturuldu')}><CheckIcon />Başarı</Button>
            <Button variant="outline" onClick={() => toast.error('Bağlantı yok')}><XIcon />Hata</Button>
            <Button variant="outline" onClick={() => toast.info('3 üye giriş yapmadı')}>Bilgi</Button>
          </div>
          <div className="w-full max-w-sm rounded-xl border border-border">
            <EmptyState
              icon={CalendarX2Icon}
              title="Bugün ders yok"
              description="Bu şube için bugüne planlanmış bir ders bulunmuyor."
              action={<Button><PlusIcon />Ders Ekle</Button>}
            />
          </div>
        </div>
      </Section>

      <Toaster />
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}
