'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, CheckCircle2Icon, CreditCardIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
  testPaymentProviderAction,
  updatePaymentProviderSettingsAction,
} from '@/server/actions/payments'

interface Config {
  provider: 'paytr'
  merchantId: string
  testMode: boolean
  callbackUrl: string
  successUrl: string
  failUrl: string
  posEnabled: boolean
  linkEnabled: boolean
  active: boolean
}

// Ödeme sağlayıcıları — provider-based (ileride başka sağlayıcılar eklenebilir; PAYTR ilk giriş).
export function IntegrationsScreen({ config, secretsPresent }: { config: Config; secretsPresent: boolean }) {
  const [c, setC] = useState<Config>(config)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC((p) => ({ ...p, [k]: v }))

  async function save() {
    setBusy(true)
    try {
      const res = await updatePaymentProviderSettingsAction({
        merchantId: c.merchantId,
        testMode: c.testMode,
        callbackUrl: c.callbackUrl,
        successUrl: c.successUrl,
        failUrl: c.failUrl,
        posEnabled: c.posEnabled,
        linkEnabled: c.linkEnabled,
        active: c.active,
      })
      toast[res.ok ? 'success' : 'error'](res.ok ? 'Kaydedildi.' : 'Kaydedilemedi.')
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    try {
      const res = await testPaymentProviderAction()
      toast[res.ok ? 'success' : 'error'](res.message)
    } catch {
      toast.error('Test tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Entegrasyonlar"
        description="Ödeme sağlayıcıları"
        actions={
          <Button variant="outline" size="sm" render={<Link href="/settings" />}>
            <ArrowLeftIcon />
            Ayarlar
          </Button>
        }
      />

      <Section
        title="PAYTR"
        hint="İş mantığı sağlayıcıya bağlı değildir; PAYTR bir adapter arkasında çalışır. İleride başka sağlayıcılar eklenebilir."
        actions={
          c.active && c.merchantId && secretsPresent ? (
            <Badge className="gap-1 bg-success/10 text-success">
              <CheckCircle2Icon className="size-3.5" /> Bağlı
            </Badge>
          ) : (
            <Badge className="gap-1 bg-warning/10 text-warning">
              <CreditCardIcon className="size-3.5" /> Yapılandırılmadı
            </Badge>
          )
        }
      >
        <div className="space-y-4">
          <label className="flex flex-col gap-1 text-sm">
            Merchant ID
            <Input value={c.merchantId} onChange={(e) => set('merchantId', e.target.value)} placeholder="PAYTR mağaza no" />
          </label>

          {/* Secrets live in Secret Manager — never entered or shown here. */}
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Merchant Key / Merchant Salt</p>
            <p className="mt-1 text-muted-foreground">Güvenlik için Secret Manager'da tutulur; burada gösterilmez.</p>
            <p className="mt-2 flex items-center gap-1.5">
              {secretsPresent ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2Icon className="size-4" /> Secret Manager'da yapılandırılmış
                </span>
              ) : (
                <span className="flex items-center gap-1 text-warning">
                  <XCircleIcon className="size-4" /> Yapılandırılmamış
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Callback URL
              <Input value={c.callbackUrl} onChange={(e) => set('callbackUrl', e.target.value)} placeholder="https://…/api/payments/paytr/callback" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Başarılı URL
              <Input value={c.successUrl} onChange={(e) => set('successUrl', e.target.value)} placeholder="https://…/payments/return?ok=1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Başarısız URL
              <Input value={c.failUrl} onChange={(e) => set('failUrl', e.target.value)} placeholder="https://…/payments/return?ok=0" />
            </label>
          </div>

          <div
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              !c.active
                ? 'border-muted-foreground/20 bg-muted text-muted-foreground'
                : c.testMode
                  ? 'border-amber-500/30 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
            }`}
          >
            {!c.active
              ? 'Sağlayıcı kapalı — bu mağazadan ödeme alınmaz.'
              : c.testMode
                ? 'TEST modu — gerçek para çekilmez. Test kartıyla akışı deneyebilirsiniz.'
                : 'CANLI — gerçek ödeme alınır, kartlardan para çekilir.'}
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={c.posEnabled} onCheckedChange={(v) => set('posEnabled', v === true)} /> Sanal POS aktif
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={c.linkEnabled} onCheckedChange={(v) => set('linkEnabled', v === true)} /> Link ile Ödeme aktif
            </label>
            <label className="flex flex-col gap-0.5 text-sm">
              <span className="flex items-center gap-2">
                <Checkbox checked={c.testMode} onCheckedChange={(v) => set('testMode', v === true)} /> Test modu
              </span>
              <span className="ml-6 text-xs text-muted-foreground">
                İşaretliyken gerçek para çekilmez — canlıya geçmek için bu tiki KALDIRIN.
              </span>
            </label>
            <label className="flex flex-col gap-0.5 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Checkbox checked={c.active} onCheckedChange={(v) => set('active', v === true)} /> Sağlayıcı aktif
              </span>
              <span className="ml-6 text-xs font-normal text-muted-foreground">
                Ödeme sağlayıcısı açık/kapalı. Açık olması "canlı" demek değildir — canlı/test kararı
                yukarıdaki "Test modu" tikidir.
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
            </Button>
            <Button variant="outline" onClick={() => void test()} disabled={busy}>
              Bağlantıyı Test Et
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Merchant Key/Salt yalnızca Secret Manager'da tanımlıysa canlı ödeme alınabilir; aksi halde ödeme akışı
            "yapılandırma gerekli" durumu gösterir ve sahte başarı üretmez.
          </p>
        </div>
      </Section>
    </main>
  )
}
