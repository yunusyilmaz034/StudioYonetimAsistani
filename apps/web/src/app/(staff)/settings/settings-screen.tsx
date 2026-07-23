'use client'

import type { DayHours, StudioSettings, WorkingHours } from '@studio/core'
import { CalendarDaysIcon, CreditCardIcon, ShieldAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { DefinitionsPanel } from './definitions-panel'
import { MobilePanel } from './mobile-panel'
import { AiSettingsPanel } from './ai-settings-panel'
import { ThemeScreen } from './theme/theme-screen'
import { domainErrorMessage } from '@/lib/domain-error'
import type { StudioTheme } from '@/lib/theme/presets'
import { updateStudioSettingsAction } from '@/server/actions/settings'

// The settings screen. Plain on purpose: it is opened when a studio is set up, and then perhaps
// twice a year. What it owes the owner is not elegance — it is **being impossible to misread**.

const DAYS: readonly { key: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string }[] = [
  { key: 1, label: 'Pazartesi' },
  { key: 2, label: 'Salı' },
  { key: 3, label: 'Çarşamba' },
  { key: 4, label: 'Perşembe' },
  { key: 5, label: 'Cuma' },
  { key: 6, label: 'Cumartesi' },
  { key: 0, label: 'Pazar' },
]

const EMPTY_HOURS: WorkingHours = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))

// A field that CHANGES A DECISION and is empty says so, loudly (UX-1, 2026-07-14).
//
// The owner filled in this screen, pressed Kaydet, saw "Ayarlar kaydedildi" — and three rule-affecting
// numbers were still null in the database. She had not typed them. She did not need to: the boxes
// already showed 6, 2 and 20, because those were the PLACEHOLDERS. A grey placeholder and a black
// value are one shade apart, and when the placeholder happens to BE the sensible answer, nothing is
// left to tell "empty" from "filled".
//
// The fix is not a better placeholder. It is: no placeholder on a rule-affecting field, an empty one
// admits it, and Kaydet refuses to call it saved.
function Field({
  label,
  hint,
  missing,
  children,
}: {
  label: string
  hint?: string
  missing?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={cn('block space-y-1.5', missing && '[&_input]:border-destructive')}>
      <span className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {missing ? (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive">
            Gerekli — boş
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="block text-sm text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function SettingsScreen({
  settings,
  theme,
  branchId,
  canManage = false,
}: {
  settings: StudioSettings | null
  theme: StudioTheme
  branchId: string | null
  canManage?: boolean
}) {
  const [pending, start] = useTransition()

  const [company, setCompany] = useState({
    legalName: settings?.company?.legalName ?? '',
    displayName: settings?.company?.displayName ?? '',
    taxOffice: settings?.company?.taxOffice ?? '',
    taxNumber: settings?.company?.taxNumber ?? '',
    phone: settings?.company?.phone ?? '',
    email: settings?.company?.email ?? '',
    website: settings?.company?.website ?? '',
    address: settings?.company?.address ?? '',
    mapsUrl: settings?.company?.mapsUrl ?? '',
  })
  const [hours, setHours] = useState<WorkingHours>(settings?.workingHours ?? EMPTY_HOURS)
  const [cancelHours, setCancelHours] = useState(
    settings?.defaultCancellationWindowHours?.toString() ?? '',
  )
  const [duration, setDuration] = useState(settings?.defaultSessionDurationMinutes?.toString() ?? '')
  const [lowCredit, setLowCredit] = useState(settings?.lowCreditThreshold?.toString() ?? '')
  const [ceiling, setCeiling] = useState(settings?.discountCeilingPercent?.toString() ?? '')
  const [showCancelled, setShowCancelled] = useState(Boolean(settings?.showCancelledSessions))
  const [ttl, setTtl] = useState(settings?.qr?.tokenTtlSeconds?.toString() ?? '60')
  const [dailyLimit, setDailyLimit] = useState(settings?.notifications?.dailyLimit?.toString() ?? '1000')
  const [quietFrom, setQuietFrom] = useState(settings?.notifications?.quietFromHour?.toString() ?? '22')
  const [quietTo, setQuietTo] = useState(settings?.notifications?.quietToHour?.toString() ?? '8')
  const [emailEnabled, setEmailEnabled] = useState(
    settings?.notifications?.enabledChannels?.includes('email') ?? true,
  )
  const [whatsappEnabled, setWhatsappEnabled] = useState(
    settings?.notifications?.enabledChannels?.includes('whatsapp') ?? false,
  )
  const [checkInWindow, setCheckInWindow] = useState(
    settings?.qr?.checkInWindowMinutes?.toString() ?? '30',
  )
  // Plus Phase 8 — occupancy: physical capacity + the bands (stored as fractions, edited as %).
  const [capacity, setCapacity] = useState(settings?.fitness?.capacity?.toString() ?? '')
  const [moderatePct, setModeratePct] = useState(((settings?.fitness?.moderateAt ?? 0.4) * 100).toString())
  const [busyPct, setBusyPct] = useState(((settings?.fitness?.busyAt ?? 0.7) * 100).toString())
  const [veryBusyPct, setVeryBusyPct] = useState(((settings?.fitness?.veryBusyAt ?? 0.9) * 100).toString())
  // Plus (pilot) — KK/havale farkı PER CATEGORY (percent or fixed ₺) + PAYTR max taksit. A category
  // absent from `byCategory` falls back to the legacy flat amount on first load.
  type SCat = 'pilates_group' | 'fitness' | 'private'
  type SRow = { mode: 'percent' | 'fixed'; value: string }
  const surchargeCats: { key: SCat; label: string }[] = [
    { key: 'pilates_group' as const, label: 'Pilates' },
    { key: 'fitness' as const, label: 'Fitness' },
    { key: 'private' as const, label: 'PT (Özel Ders)' },
  ]
  const legacySurchargeKurus = settings?.paymentSurcharge?.cardTransferSurchargeKurus ?? 0
  const initRule = (key: SCat): SRow => {
    const r = settings?.paymentSurcharge?.byCategory?.[key]
    if (r && 'percent' in r) return { mode: 'percent', value: String(r.percent) }
    if (r && 'fixedKurus' in r) return { mode: 'fixed', value: String(r.fixedKurus / 100) }
    return { mode: 'fixed', value: String(legacySurchargeKurus / 100) }
  }
  const [surcharge, setSurcharge] = useState<Record<SCat, SRow>>({
    pilates_group: initRule('pilates_group'),
    fitness: initRule('fitness'),
    private: initRule('private'),
  })
  const [maxInstallments, setMaxInstallments] = useState((settings?.paymentSurcharge?.maxInstallments ?? 3).toString())
  const [tab, setTab] = useState('genel')

  const setDay = (key: 0 | 1 | 2 | 3 | 4 | 5 | 6, value: DayHours | null) =>
    setHours((h) => ({ ...h, [key]: value }))

  // The four numbers that CHANGE A DECISION. A null here is never an intention — it is an omission,
  // and `defaultCancellationWindowHours: null` means a class cannot be created AT ALL (the domain
  // refuses rather than inventing a number). So the save refuses first, and names what is missing.
  const RULES = [
    { key: 'İptal penceresi', value: cancelHours },
    { key: 'Varsayılan ders süresi', value: duration },
    { key: 'Düşük kredi uyarısı', value: lowCredit },
    { key: 'İndirim tavanı', value: ceiling },
  ] as const
  const missing = RULES.filter((r) => r.value.trim() === '').map((r) => r.key)

  // A day marked OPEN with no hours in it is the same trap wearing a different hat: the boxes used to
  // show 10:00 and 21:00 as placeholders, so the day LOOKED set. It reaches AG-1 as an empty string,
  // which is not a time — and AG-1 is what decides whether a class may exist at all.
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
  const badDays = DAYS.filter(({ key }) => {
    const d = hours[key]
    return d !== null && (!HHMM.test(d.open) || !HHMM.test(d.close))
  }).map(({ label }) => label)

  const save = () => {
    if (missing.length > 0) {
      toast.error(`Kaydedilmedi — şu alanlar boş: ${missing.join(', ')}.`)
      return
    }
    if (badDays.length > 0) {
      toast.error(`Kaydedilmedi — açık gün, saati eksik veya hatalı (SS:DD): ${badDays.join(', ')}.`)
      return
    }
    // Occupancy bands must ascend: Orta ≤ Yoğun ≤ Çok yoğun. A misordered set would paint the studio
    // "Çok yoğun" while it is half empty.
    if (capacity.trim() !== '' && !(Number(moderatePct) <= Number(busyPct) && Number(busyPct) <= Number(veryBusyPct))) {
      toast.error('Kaydedilmedi — doluluk eşikleri artan olmalı: Orta ≤ Yoğun ≤ Çok yoğun.')
      return
    }
    start(async () => {
      const res = await updateStudioSettingsAction({
        company: company.legalName.trim()
          ? { ...company, website: company.website || null, mapsUrl: company.mapsUrl || null }
          : null,
        workingHours: hours,
        defaultCancellationWindowHours: num(cancelHours),
        defaultSessionDurationMinutes: num(duration),
        lowCreditThreshold: num(lowCredit),
        discountCeilingPercent: num(ceiling),
        showCancelledSessions: showCancelled,
        qr: { tokenTtlSeconds: Number(ttl), checkInWindowMinutes: Number(checkInWindow) },
        notifications: {
          dailyLimit: Number(dailyLimit),
          quietFromHour: Number(quietFrom),
          quietToHour: Number(quietTo),
          emailEnabled,
          whatsappEnabled,
        },
        fitness:
          capacity.trim() === ''
            ? null
            : {
                capacity: Number(capacity),
                moderateAt: Number(moderatePct) / 100,
                busyAt: Number(busyPct) / 100,
                veryBusyAt: Number(veryBusyPct) / 100,
              },
        paymentSurcharge: {
          // byCategory is authoritative; the flat field stays 0 as the fallback for any future category.
          cardTransferSurchargeKurus: 0,
          maxInstallments: Math.max(1, Math.min(12, Number(maxInstallments || '3'))),
          byCategory: Object.fromEntries(
            surchargeCats.map(({ key }) => {
              const r = surcharge[key]
              return [
                key,
                r.mode === 'percent'
                  ? { percent: Math.max(0, Math.min(100, Number(r.value || '0'))) }
                  : { fixedKurus: Math.max(0, Math.round(Number(r.value || '0') * 100)) },
              ]
            }),
          ),
        },
      })
      if (res.ok) toast.success('Ayarlar kaydedildi.')
      else toast.error(domainErrorMessage(res.error))
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Stüdyo Ayarları"
        description="Stüdyonun tek doğruluk kaynağı. Makbuz, e-posta ve WhatsApp buradan okur."
        actions={
          <Button onClick={save} disabled={pending}>
            Kaydet
          </Button>
        }
      />

      {/* Long config → tabs (PF-7): the form's sections are grouped so the page no longer scrolls forever.
          One Kaydet (below, always visible) still saves the whole form; links + definitions sit under it. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="genel" className="shrink-0">Genel</TabsTrigger>
          <TabsTrigger value="rezervasyon" className="shrink-0">Rezervasyon</TabsTrigger>
          <TabsTrigger value="odeme" className="shrink-0">Ödeme &amp; Bildirim</TabsTrigger>
          <TabsTrigger value="gorunum" className="shrink-0">Görünüm</TabsTrigger>
          <TabsTrigger value="tanimlar" className="shrink-0">Tanımlar</TabsTrigger>
          <TabsTrigger value="mobil" className="shrink-0">Mobil</TabsTrigger>
          <TabsTrigger value="ai" className="shrink-0">AI</TabsTrigger>
        </TabsList>

        <TabsContent value="genel" className="space-y-6">
          {/* ── Şirket ────────────────────────────────────────────────────────────────────────── */}
          <Section title="Şirket bilgileri" hint="Makbuzda, e-postada ve ileride e-faturada görünecek olanlar.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ticari unvan">
            <Input
              value={company.legalName}
              onChange={(e) => setCompany({ ...company, legalName: e.target.value })}
              placeholder="ör. Işıl Pilates ve Fitness Ltd. Şti."
            />
          </Field>
          <Field label="Görünen işletme adı" hint="Üyenin gördüğü ad.">
            <Input
              value={company.displayName}
              onChange={(e) => setCompany({ ...company, displayName: e.target.value })}
              placeholder="ör. Pilates Fitness by Işıl"
            />
          </Field>
          <Field label="Vergi dairesi">
            <Input
              value={company.taxOffice}
              onChange={(e) => setCompany({ ...company, taxOffice: e.target.value })}
            />
          </Field>
          <Field label="Vergi numarası">
            <Input
              value={company.taxNumber}
              onChange={(e) => setCompany({ ...company, taxNumber: e.target.value })}
            />
          </Field>
          <Field label="Telefon">
            <Input
              value={company.phone}
              onChange={(e) => setCompany({ ...company, phone: e.target.value })}
            />
          </Field>
          <Field label="E-posta">
            <Input
              value={company.email}
              onChange={(e) => setCompany({ ...company, email: e.target.value })}
            />
          </Field>
          <Field label="Web sitesi (opsiyonel)">
            <Input
              value={company.website}
              onChange={(e) => setCompany({ ...company, website: e.target.value })}
            />
          </Field>
          <Field label="Adres">
            <Input
              value={company.address}
              onChange={(e) => setCompany({ ...company, address: e.target.value })}
            />
          </Field>
          <Field
            label="Google Maps / Yol tarifi linki"
            hint="Üyeye giden e-postaların altındaki “Yol tarifi al” butonu buraya gider. Google Maps’te stüdyonu bul → Paylaş → linki yapıştır."
          >
            <Input
              value={company.mapsUrl}
              onChange={(e) => setCompany({ ...company, mapsUrl: e.target.value })}
              placeholder="https://maps.app.goo.gl/…"
            />
          </Field>
        </div>
      </Section>

      {/* ── Çalışma saatleri ──────────────────────────────────────────────────────────────── */}
      <Section
        title="Çalışma saatleri"
        hint="Her gün ayrı. Boş bırakılan gün kapalıdır."
      >
        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const d = hours[key]
            return (
              <div key={key} className="flex flex-wrap items-center gap-3">
                <span className="w-28 text-sm font-medium">{label}</span>
                {d ? (
                  <>
                    <Input
                      className="w-28"
                      value={d.open}
                      onChange={(e) => setDay(key, { ...d, open: e.target.value })}
                      aria-label={`${label} açılış`}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      className="w-28"
                      value={d.close}
                      onChange={(e) => setDay(key, { ...d, close: e.target.value })}
                      aria-label={`${label} kapanış`}
                    />
                    <Button variant="outline" size="sm" onClick={() => setDay(key, null)}>
                      Kapalı yap
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">Kapalı</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDay(key, { open: '10:00', close: '21:00' })}
                    >
                      Aç
                    </Button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* ── Tatiller: NOT duplicated here ─────────────────────────────────────────────────── */}
      <Section
        title="Tatiller ve kapanış günleri"
        hint="Tatil takvimi kendi ekranında yaşar — burada ikinci bir liste tutmuyoruz."
      >
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Resmî ve dinî tatiller, stüdyo kapanışları, bakım günleri ve özel çalışma günleri —
              hepsi Takvim ekranında, başlangıç · bitiş · açıklama ile.
            </p>
            <Link
              href="/calendar"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <CalendarDaysIcon className="size-4" />
              Takvimi aç
            </Link>
          </CardContent>
        </Card>
      </Section>

      {/* ── Saat dilimi: read-only, and honestly so. A studio-level fact, so it lives in Genel —
          it is not a payment setting (owner, 2026-07-17). ──────────────────────────────────── */}
      <Section
        title="Saat dilimi"
        hint="Alpha’da değiştirilemez — tek stüdyo, tek saat dilimi."
      >
        <Card>
          <CardContent className="p-4">
            <p className="font-medium tabular-nums">{settings?.timeZone ?? 'Europe/Istanbul'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sistem bunu kullanır ve UTC farkını buradan türetir — saklamaz. Değiştirilebilir hale
              gelmesi ikinci stüdyoyla birlikte gelecek; çalışmayan bir ayarı bugün göstermiyoruz.
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* ── KVKK / Gizlilik ───────────────────────────────────────────────────────────────────
          A legal/privacy action on the studio's own data — it belongs with the studio's legal
          identity (Genel), never under "Görünüm". Not on every member card (PF-9); the action
          enforces platform_admin. Self-contained screen, so it is not tied to the form Kaydet. */}
      <Section title="KVKK / Gizlilik" hint="Üye kaydını kalıcı olarak anonimleştirme (geri alınamaz, yetkili işlemi).">
        <Button variant="outline" render={<Link href="/settings/privacy" />}>
          <ShieldAlertIcon />
          Üye Kaydını Anonimleştir
        </Button>
      </Section>

        </TabsContent>

        <TabsContent value="rezervasyon" className="space-y-6">
          {/* ── Rezervasyon kuralları ─────────────────────────────────────────────────────────── */}
          <Section
            title="Rezervasyon kuralları"
        hint="Bunlar bir kararı değiştirir — o yüzden her değişiklik eski ve yeni değeriyle denetim kaydına yazılır."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="İptal penceresi (saat)"
            missing={cancelHours.trim() === ''}
            hint="Bu süreden sonra yapılan iptal krediyi yakar. Sadece BUNDAN SONRA oluşturulan dersleri etkiler — mevcut dersler kendi penceresini taşır."
          >
            <Input
              type="number"
              value={cancelHours}
              onChange={(e) => setCancelHours(e.target.value)}
            />
          </Field>
          <Field
            label="Varsayılan ders süresi (dk)"
            missing={duration.trim() === ''}
            hint="Ders oluşturma formu bununla açılır."
          >
            <Input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field
            label="Düşük kredi uyarısı"
            missing={lowCredit.trim() === ''}
            hint="Bu sayının altına düşen üye panoda görünür."
          >
            <Input
              type="number"
              value={lowCredit}
              onChange={(e) => setLowCredit(e.target.value)}
            />
          </Field>
          <Field
            label="İndirim tavanı (%)"
            missing={ceiling.trim() === ''}
            hint="Bu oranın üstündeki indirimi yalnızca sahip onaylayabilir."
          >
            <Input
              type="number"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
            />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-medium text-foreground">İptal edilen dersleri ajandada göster</span>
            <span className="block text-muted-foreground">
              Kapalıyken iptaller Ders Ajandası&apos;nda görünmez (varsayılan). Ajandadaki “İptalleri göster” kutusuyla o
              anlık açabilirsin; sayfaya tekrar girince bu ayara döner.
            </span>
          </span>
        </label>
      </Section>

      {/* ── QR ────────────────────────────────────────────────────────────────────────────── */}
      <Section title="QR check-in" hint="Üyenin telefonundaki QR kodunun kuralları.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Token ömrü (saniye)"
            hint="Kısa olması güvenliktir: ekran görüntüsü bu süre içinde ölür."
          >
            <Input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </Field>
          <Field
            label="Check-in penceresi (dk)"
            hint="Dersine bu kadar kalmış ama henüz gelmemiş üye, check-in ekranında “beklenen” olarak görünür."
          >
            <Input
              type="number"
              value={checkInWindow}
              onChange={(e) => setCheckInWindow(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {/* ── Doluluk & Kapasite (Plus Phase 8) ─────────────────────────────────────────────── */}
      <Section
        title="Doluluk & Kapasite"
        hint="Aynı anda kaç kişi olabilir, ve doluluk hangi orandan sonra “Yoğun” sayılır. Üye portalında yalnızca seviye (Sakin/Orta/Yoğun/Çok yoğun) görünür — asla kişi sayısı."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Stüdyo kapasitesi (kişi)"
            hint="Boş bırakılırsa doluluk seviyesi hesaplanmaz. Aynı anda içeride olabilecek üye sayısı."
          >
            <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Orta eşiği (%)" hint="Kapasitenin bu oranından sonra “Orta”.">
            <Input type="number" value={moderatePct} onChange={(e) => setModeratePct(e.target.value)} />
          </Field>
          <Field label="Yoğun eşiği (%)" hint="Bu orandan sonra “Yoğun”.">
            <Input type="number" value={busyPct} onChange={(e) => setBusyPct(e.target.value)} />
          </Field>
          <Field label="Çok yoğun eşiği (%)" hint="Bu orandan sonra “Çok yoğun”.">
            <Input type="number" value={veryBusyPct} onChange={(e) => setVeryBusyPct(e.target.value)} />
          </Field>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Eşikler artan olmalı: Orta ≤ Yoğun ≤ Çok yoğun.
        </p>
      </Section>

        </TabsContent>

        <TabsContent value="odeme" className="space-y-6">
          {/* ── Ödeme (PAYTR) ─────────────────────────────────────────────────────────────────── */}
          <Section
            title="Ödeme (PAYTR)"
        hint="Kredi kartı / havale ile ödemede paket fiyatına eklenecek fark ve izin verilen en fazla taksit. Üyeye kırılım gösterilmez — yalnızca son tutar."
      >
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              KK/Havale farkı (kategoriye göre)
            </p>
            {surchargeCats.map(({ key, label }) => {
              const r = surcharge[key]
              return (
                <div key={key} className="grid grid-cols-[1fr_auto_5.5rem] items-center gap-2">
                  <span className="text-sm text-foreground">{label}</span>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={r.mode}
                    onChange={(e) =>
                      setSurcharge((s) => ({ ...s, [key]: { ...s[key], mode: e.target.value as 'percent' | 'fixed' } }) as Record<SCat, SRow>)
                    }
                  >
                    <option value="percent">Yüzde %</option>
                    <option value="fixed">Sabit ₺</option>
                  </select>
                  <Input
                    type="number"
                    min={0}
                    value={r.value}
                    onChange={(e) => setSurcharge((s) => ({ ...s, [key]: { ...s[key], value: e.target.value } }) as Record<SCat, SRow>)}
                  />
                </div>
              )
            })}
            <p className="text-sm text-muted-foreground">
              Karta/havaleye ödemede paket fiyatına eklenir. Yüzde = fiyatın %’si, Sabit = ₺ tutar. 0 = fark yok.
              Zorunlu değil — resepsiyon satış sırasında tutarı değiştirebilir.
            </p>
          </div>
          <Field label="En fazla taksit" hint="Ödeme sırasında sunulacak en yüksek taksit sayısı (1 = tek çekim).">
            <Input type="number" min={1} max={12} value={maxInstallments} onChange={(e) => setMaxInstallments(e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* ── Ödeme sağlayıcısı bağlantısı ──────────────────────────────────────────────────────
          PAYTR bağlantısının kendisi (merchant bilgileri, test modu, bildirim URL'i) — bir ÖDEME
          entegrasyonu, o yüzden parayla birlikte burada yaşar, "Görünüm"ün altında değil (owner,
          2026-07-17). Kendi ekranında saklandığı için form Kaydet'ine bağlı değildir. */}
      <Section title="Ödeme sağlayıcısı (PAYTR)" hint="Bağlantı, merchant bilgileri, test modu ve bildirim URL'i.">
        <Button variant="outline" render={<Link href="/settings/integrations" />}>
          <CreditCardIcon />
          PAYTR Bağlantısı
        </Button>
      </Section>

      {/* PF-37 — sabit tutarlı, taksitli, paylaşılabilir ödeme linkleri (Instagram/WhatsApp). */}
      <Section title="Ödeme Linkleri" hint="Sabit tutarlı, taksitli link oluşturup paylaşın; ödeme kasaya düşer, üyeye siz eşleştirirsiniz.">
        <Button variant="outline" render={<Link href="/settings/payment-links" />}>
          <CreditCardIcon />
          Ödeme Linki Oluştur
        </Button>
      </Section>

      {/* ── Bildirimler (DEBT-024) ────────────────────────────────────────────────────────── */}
      <Section
        title="Bildirimler"
        hint="Üyeye ne zaman ve hangi kanaldan yazılacağı."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Sessiz saat başlangıcı"
            hint="Bu saatten sonra ACİL olmayan bildirim beklemeye alınır."
          >
            <Input type="number" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
          </Field>
          <Field label="Sessiz saat bitişi" hint="Bekleyen bildirimler bu saatte gönderilir.">
            <Input type="number" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
          </Field>
          <Field
            label="Günlük bildirim tavanı"
            hint="Bir hata yüzünden üyelere yüzlerce mesaj gitmesini engelleyen tavan."
          >
            <Input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          {/* in_app is NOT a switch. It is her RECORD of what happened to her account: she may say
              "not by e-mail"; she may not say "never tell me my class was cancelled" (v1.25). */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Uygulama içi bildirim</p>
              <p className="text-sm text-muted-foreground">
                Kapatılamaz — bu bir mesaj değil, üyenin hesabında olanların kaydı.
              </p>
            </div>
            <span className="text-sm font-medium text-success">Her zaman açık</span>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">E-posta</p>
              <p className="text-sm text-muted-foreground">Rezervasyon, iptal ve hatırlatmalar.</p>
            </div>
            <input
              type="checkbox"
              className="size-5"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
            />
          </label>

          {/* WhatsApp has a real transport since Plus Phase 5 (Meta Cloud API, approved templates).
              It only leaves the building once the owner provisions the Meta credentials; until then it
              is a mock, so enabling it is safe and readies the channel. SMS/push still have none. */}
          <label className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">WhatsApp</p>
              <p className="text-sm text-muted-foreground">
                Meta onaylı şablonlarla. Canlı gönderim için Meta hesabı bağlanmalı.
              </p>
            </div>
            <input
              type="checkbox"
              className="size-5"
              checked={whatsappEnabled}
              onChange={(e) => setWhatsappEnabled(e.target.checked)}
            />
          </label>

          <p className="text-sm text-muted-foreground">
            SMS henüz gönderim yapamıyor; hazır olduğunda burada görünecek.
          </p>
        </div>
      </Section>

        </TabsContent>

        <TabsContent value="gorunum" className="space-y-6">
          {/* Görünüm — tema (renk + yazı boyutu, PF-12) INLINE: sekmeye basınca kontroller doğrudan gelir,
              ikinci bir ekran açılmaz (owner, 2026-07-17). Ödeme sağlayıcısı "Ödeme & Bildirim"e, KVKK
              "Genel"e taşındı: bir ödeme entegrasyonu da yasal bir işlem de bir görünüm ayarı değildir. */}
          <ThemeScreen initial={theme} embedded />
        </TabsContent>

        <TabsContent value="tanimlar" className="space-y-6">
          {/* Ders türleri · salonlar · kasalar · oda notları — they save themselves. */}
          <DefinitionsPanel branchId={branchId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="mobil" className="space-y-6">
          {/* The member mobile app's owner-controlled settings (home-screen campaign banner, …). */}
          <MobilePanel canEdit={canManage} />
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          {/* The studio's AI "knowledge card" — persona + basics + policies + FAQ the AI reads as context. */}
          <AiSettingsPanel canEdit={canManage} />
        </TabsContent>
      </Tabs>

      {/* The whole-studio summary — the system's reading of ALL form settings (hours, rules, QR,
          notifications) — lives ONCE, on the overview tab (Genel). Repeating the same box under every
          form tab was noise the owner reads three times (owner, 2026-07-17). */}
      {tab === 'genel' ? (
        <Preview
          hours={hours}
          cancelHours={num(cancelHours)}
          duration={num(duration)}
          lowCredit={num(lowCredit)}
          ceiling={num(ceiling)}
          ttl={Number(ttl)}
          checkInWindow={Number(checkInWindow)}
          quietFrom={Number(quietFrom)}
          quietTo={Number(quietTo)}
        />
      ) : null}

      {/* One Kaydet, on the FORM tabs (Genel/Rezervasyon/Ödeme); the other tabs save themselves, so a
          form Kaydet under them would be misleading. */}
      {tab === 'genel' || tab === 'rezervasyon' || tab === 'odeme' ? (
        <div className="flex flex-col-reverse items-stretch gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Tüm form sekmelerindeki (Genel · Rezervasyon · Ödeme) stüdyo ayarlarını kaydeder.</p>
          <Button onClick={save} disabled={pending} className="sm:w-auto">
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * What the system will DO with these settings, in sentences (owner, 2026-07-13 · point 7).
 *
 * Deliberately small. A settings form shows you numbers; the question the owner actually has is
 * *"and what happens then?"* — and the gap between those two is where a misconfiguration lives.
 */
function Preview({
  hours,
  cancelHours,
  duration,
  lowCredit,
  ceiling,
  ttl,
  checkInWindow,
  quietFrom,
  quietTo,
}: {
  hours: WorkingHours
  cancelHours: number | null
  duration: number | null
  lowCredit: number | null
  ceiling: number | null
  ttl: number
  checkInWindow: number
  quietFrom: number
  quietTo: number
}) {
  const open = DAYS.filter(({ key }) => hours[key])
  const closed = DAYS.filter(({ key }) => !hours[key])

  return (
    <Section title="Bu ayarlarla ne olur?" hint="Kaydetmeden önce, sistemin okuduğu hâli.">
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <p>
            {open.length === 0 ? (
              <>Hiçbir gün açık değil — stüdyo tamamen kapalı görünür.</>
            ) : (
              <>
                Stüdyo{' '}
                <strong>
                  {open.map(({ key, label }) => `${label} ${hours[key]!.open}–${hours[key]!.close}`).join(', ')}
                </strong>{' '}
                açık.
                {closed.length > 0 ? ` ${closed.map((d) => d.label).join(', ')} kapalı.` : ''}
              </>
            )}
          </p>
          {cancelHours === null ? (
            <p className="rounded-md border border-destructive bg-destructive/10 p-3 font-medium text-destructive">
              <strong>İptal penceresi tanımsız — ders açılamaz.</strong> Sistem bir sayı uydurmaz:
              süre girilmeden oluşturulan dersi <strong>reddeder</strong>.
            </p>
          ) : (
            <p>
              Üye dersinden <strong>{cancelHours} saat</strong> öncesine kadar ücretsiz iptal
              edebilir. Sonrasında iptal ederse <strong>kredisi yanar</strong>.
            </p>
          )}
          {duration !== null ? <p>Yeni ders formu <strong>{duration} dakika</strong> ile açılır.</p> : null}
          {lowCredit !== null ? (
            <p>
              Kredisi <strong>{lowCredit}</strong>’in altına düşen üye panoda “kredisi azalan” olarak
              görünür.
            </p>
          ) : null}
          {ceiling !== null ? (
            <p>
              Resepsiyon <strong>%{ceiling}</strong>’e kadar indirim yapabilir; üstünü yalnızca sahip
              onaylar.
            </p>
          ) : null}
          <p>
            Üyenin QR kodu <strong>{ttl} saniye</strong> geçerlidir ve bir kez kullanılır. Dersine{' '}
            <strong>{checkInWindow} dakika</strong> kalmış ama henüz gelmemiş üyeler check-in ekranında
            “beklenen” listesinde görünür.
          </p>
          {/* Said plainly, because the alternative is a setting that quietly does nothing. */}
          <p>
            Acil olmayan bildirimler <strong>{quietFrom}:00–{quietTo}:00</strong> arasında beklemeye
            alınır ve sabah gönderilir. “Dersiniz iptal edildi” <strong>beklemez</strong> — gece 02:00’de
            bile gider.
          </p>
          <p className="pt-1 text-muted-foreground">
            Çalışma saatleri <strong>uygulanır</strong>: kapalı saatte ders oluşturulamaz ve
            rezervasyon alınamaz. Takvimde “özel çalışma günü” işaretlediğiniz tarihlerde bu kural
            uygulanmaz — o gün açık olduğunuzu siz söylemişsinizdir.
          </p>
        </CardContent>
      </Card>
    </Section>
  )
}
