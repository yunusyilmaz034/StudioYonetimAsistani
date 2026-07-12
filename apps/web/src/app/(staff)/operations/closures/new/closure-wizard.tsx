'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  applyClosureAction,
  planClosureAction,
  previewClosureAction,
} from '@/server/actions/operations'

// D21 — the most dangerous screen in the product.
//
// Its whole job is to make sure the owner sees what she is about to do BEFORE she does it, and
// that nothing happens until she says so. Preview writes nothing. Apply re-derives. I-28 refuses
// a second run.

type Plan = Awaited<ReturnType<typeof previewClosureAction>>

const SCOPE_LABEL: Record<string, string> = {
  studio: 'Tüm stüdyo',
  category: 'Kategori',
}

const dt = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' })
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

export function ClosureWizard({
  initialFrom,
  initialTo,
  initialReason,
  calendarDayId,
}: {
  initialFrom: string
  initialTo: string
  initialReason: string
  calendarDayId: string | null
}) {
  const router = useRouter()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [reason, setReason] = useState(initialReason)
  const [scopeKind, setScopeKind] = useState<'studio' | 'category'>('studio')
  const [categories, setCategories] = useState<string[]>([])
  const [extensionDays, setExtensionDays] = useState(0)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const scope = () =>
    scopeKind === 'studio'
      ? { kind: 'studio' as const }
      : { kind: 'category' as const, categories: categories as never[] }

  async function runPreview() {
    setBusy(true)
    try {
      const p = await previewClosureAction({
        dateFrom: from,
        dateTo: to,
        reason,
        scope: scope(),
        extensionDays,
      })
      setPlan(p)
    } catch {
      toast.error('Önizleme oluşturulamadı.')
    }
    setBusy(false)
  }

  async function apply() {
    setBusy(true)
    try {
      const planned = await planClosureAction({
        dateFrom: from,
        dateTo: to,
        reason,
        scope: scope(),
        extensionDays,
        calendarDayIds: calendarDayId ? [calendarDayId] : [],
      })
      if (!planned.ok) {
        toast.error(domainErrorMessage(planned.error))
        setBusy(false)
        return
      }
      const applied = await applyClosureAction({ closureId: planned.value.closureId })
      if (applied.ok) {
        toast.success(
          `${applied.value.sessionsCancelled} seans iptal · ${applied.value.creditsReleased} kredi iade · ${applied.value.entitlementsExtended} paket uzatıldı.`,
        )
        setConfirm(false)
        router.push('/operations')
      } else {
        toast.error(domainErrorMessage(applied.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  const blocked = plan?.blockedSessions.filter((b) => b.reason === 'already_resolved') ?? []
  const canApply = plan !== null && reason.trim().length > 0

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader
        title="Kapanış / Tatil İşlemi"
        description="Önizleme hiçbir şeyi değiştirmez. Uygulama geri alınamaz."
      />

      <Section title="Kapsam">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Başlangıç">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Bitiş">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          <Field label="Sebep (zorunlu — event log’a yazılır)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Yıllık bakım kapanışı" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kapsam">
              <Select value={scopeKind} onValueChange={(v) => setScopeKind((v as 'studio' | 'category') ?? 'studio')}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: unknown) => SCOPE_LABEL[String(v)] ?? 'Tüm stüdyo'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="studio">Tüm stüdyo</SelectItem>
                  <SelectItem value="category">Kategori</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Paket uzatma (gün) — sizin kararınız">
              <Input
                type="number"
                min={0}
                value={extensionDays}
                onChange={(e) => setExtensionDays(Math.max(0, Number(e.target.value) || 0))}
              />
            </Field>
          </div>

          {scopeKind === 'category' ? (
            <div className="flex flex-wrap gap-2">
              {[
                ['pilates_group', 'Grup Pilates'],
                ['fitness', 'Fitness'],
                ['private', 'PT'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setCategories((c) => (c.includes(id!) ? c.filter((x) => x !== id) : [...c, id!]))
                  }
                  className={`rounded-lg border px-3 py-1 text-sm transition-colors ${
                    categories.includes(id!)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Uzatma gün sayısı kapanış süresinden otomatik türetilmez — 5 gün kapalıysanız +5, +7 veya
            hiç uzatmamayı seçebilirsiniz. Yalnızca geçerlilik süresi kapanış aralığıyla kesişen
            paketler uzatılır; dondurulmuş paketler işlenmez.
          </p>

          <Button className="min-h-11 w-full" variant="outline" onClick={runPreview} disabled={busy || !from || !to}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Etki Analizi Oluştur
          </Button>
        </div>
      </Section>

      {plan ? (
        <>
          <MetricStrip>
            <Metric compact label="İptal edilecek seans" value={plan.sessionsToCancel.length} />
            <Metric compact label="Rezervasyon" value={plan.reservationsToRelease} />
            <Metric
              compact
              label="İade edilecek kredi"
              value={plan.creditsToRelease}
              tone={plan.creditsToRelease > 0 ? 'warning' : 'default'}
            />
            <Metric compact label="Uzatılacak paket" value={plan.entitlementsToExtend.length} />
          </MetricStrip>

          {blocked.length > 0 ? (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertTriangleIcon className="size-4" />
                {blocked.length} seans BLOKLANDI — işleme alınmayacak
              </p>
              <p className="mt-1 text-xs text-danger/90">
                Bu seanslarda zaten “katıldı/gelmedi” olarak sonuçlanmış rezervasyonlar var. Sistem
                geçmişi sessizce değiştirmez ve kaybolmuş bir krediyi kendiliğinden üretmez. Önce
                Yoklama ekranındaki <span className="font-medium">Düzelt</span> akışıyla, sebep
                yazarak düzeltin; ardından bu işlemi yeniden çalıştırın.
              </p>
              <ul className="mt-2 space-y-1">
                {blocked.map((b) => (
                  <li key={b.sessionId} className="text-xs text-danger/90">
                    · {b.serviceName} — {dt(b.startsAt)} — {b.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Section title="İptal edilecek seanslar" hint={`${plan.sessionsToCancel.length}`}>
            {plan.sessionsToCancel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu aralıkta iptal edilecek seans yok.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {plan.sessionsToCancel.map((s) => (
                  <li key={s.sessionId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{s.serviceName}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{dt(s.startsAt)}</p>
                    </div>
                    <Badge className="bg-muted text-muted-foreground">{s.bookedCount} rezervasyon</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Uzatılacak paketler"
            hint={extensionDays > 0 ? `+${extensionDays} gün` : 'uzatma seçilmedi'}
          >
            {plan.entitlementsToExtend.length === 0 ? (
              <p className="text-sm text-muted-foreground">Uzatılacak paket yok.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {plan.entitlementsToExtend.slice(0, 20).map((e) => (
                  <li key={e.entitlementId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{e.memberName}</p>
                      <p className="truncate text-xs text-muted-foreground">{e.productName}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {d(e.validUntil)} → {d(e.validUntil + extensionDays * 86_400_000)}
                    </span>
                  </li>
                ))}
                {plan.entitlementsToExtend.length > 20 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    +{plan.entitlementsToExtend.length - 20} paket daha
                  </li>
                ) : null}
              </ul>
            )}
          </Section>

          {/* Nothing is skipped silently. Every skipped package is named, with the reason. */}
          <Section title="İşlenmeyecekler" hint="hiçbir şey sessizce atlanmaz">
            <SkipGroup
              label="Dondurulmuş (freeze aritmetiği toplu işleme karıştırılmaz)"
              items={plan.skippedEntitlements.filter((s) => s.reason === 'frozen')}
              tone="warning"
            />
            <SkipGroup
              label="Kapanış aralığıyla kesişmiyor"
              items={plan.skippedEntitlements.filter((s) => s.reason === 'not_overlapping')}
            />
            <SkipGroup
              label="Aktif değil (süresi dolmuş / iptal)"
              items={plan.skippedEntitlements.filter((s) => s.reason === 'not_active')}
            />
            <SkipGroup
              label="Kapsam dışı"
              items={plan.skippedEntitlements.filter((s) => s.reason === 'out_of_scope')}
            />
          </Section>

          <Button
            variant="destructive"
            className="min-h-11 w-full"
            onClick={() => setConfirm(true)}
            disabled={!canApply || busy}
          >
            Kapanışı Uygula
          </Button>
        </>
      ) : null}

      <Dialog open={confirm} onOpenChange={(o) => (o ? null : setConfirm(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kapanışı uygula?</DialogTitle>
            <DialogDescription>
              Bu işlem <span className="font-medium text-foreground">geri alınamaz</span>. Seanslar
              iptal edilecek, krediler iade edilecek ve seçtiyseniz paketler uzatılacak. İşlem
              uygulandığı anki duruma göre yeniden hesaplanır ve yalnızca bir kez uygulanabilir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={apply} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function SkipGroup({
  label,
  items,
  tone,
}: {
  label: string
  items: readonly { entitlementId: string; memberName: string; productName: string }[]
  tone?: 'warning'
}) {
  if (items.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
      <p className={`text-sm font-medium ${tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
        {label} · {items.length}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {items.slice(0, 6).map((i) => i.memberName).join(' · ')}
        {items.length > 6 ? ` +${items.length - 6}` : ''}
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
