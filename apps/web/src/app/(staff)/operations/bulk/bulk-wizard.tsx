'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

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
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { applyBulkAction, planBulkAction, previewBulkAction } from '@/server/actions/operations'

// D22 — bulk package operations.
//
// The preview is not a nicety: after the button there is no undo, only a compensating operation,
// which is a different and visible act. And there is no such thing as an unexplained bulk act —
// AD-39's reason + note are mandatory, and they are stamped on every single entitlement.

type Plan = Awaited<ReturnType<typeof previewBulkAction>>

const REASON_LABEL: Record<string, string> = {
  gift: 'Hediye',
  correction: 'Düzeltme',
  migration: 'Aktarım',
  support: 'Destek',
}
const SCOPE_LABEL: Record<string, string> = { studio: 'Tüm aktif üyeler', category: 'Kategori' }
const ACTION_LABEL: Record<string, string> = { extend_days: 'Süre uzat (gün)', add_credits: 'Kredi ekle' }

export function BulkWizard() {
  const router = useRouter()
  const [actionKind, setActionKind] = useState<'extend_days' | 'add_credits'>('extend_days')
  const [amount, setAmount] = useState(3)
  const [scopeKind, setScopeKind] = useState<'studio' | 'category'>('studio')
  const [categories, setCategories] = useState<string[]>([])
  const [reason, setReason] = useState('gift')
  const [note, setNote] = useState('')

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
      setPlan(await previewBulkAction({ scope: scope() }))
    } catch {
      toast.error('Önizleme oluşturulamadı.')
    }
    setBusy(false)
  }

  async function apply() {
    setBusy(true)
    try {
      const action =
        actionKind === 'extend_days'
          ? { kind: 'extend_days' as const, days: amount }
          : { kind: 'add_credits' as const, credits: amount }

      const planned = await planBulkAction({ action, scope: scope(), reason, note })
      if (!planned.ok) {
        toast.error(domainErrorMessage(planned.error))
        setBusy(false)
        return
      }
      const applied = await applyBulkAction({ bulkId: planned.value.bulkId })
      if (applied.ok) {
        toast.success(
          `${applied.value.entitlementsAffected} paket · ${applied.value.membersAffected} üye güncellendi.`,
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

  const canApply = plan !== null && note.trim().length > 0 && amount > 0

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Toplu Paket İşlemi"
        description="Önizleme hiçbir şeyi değiştirmez. Uygulama geri alınamaz."
      />

      <Section title="İşlem">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ne yapılacak">
              <Select value={actionKind} onValueChange={(v) => setActionKind((v as typeof actionKind) ?? 'extend_days')}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: unknown) => ACTION_LABEL[String(v)] ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="extend_days">Süre uzat (gün)</SelectItem>
                  <SelectItem value="add_credits">Kredi ekle</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={actionKind === 'extend_days' ? 'Gün' : 'Kredi'}>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kime">
              <Select value={scopeKind} onValueChange={(v) => setScopeKind((v as typeof scopeKind) ?? 'studio')}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: unknown) => SCOPE_LABEL[String(v)] ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="studio">Tüm aktif üyeler</SelectItem>
                  <SelectItem value="category">Kategori</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Gerekçe">
              <Select value={reason} onValueChange={(v) => setReason(v ?? 'gift')}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: unknown) => REASON_LABEL[String(v)] ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REASON_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  onClick={() => setCategories((c) => (c.includes(id!) ? c.filter((x) => x !== id) : [...c, id!]))}
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

          <Field label="Not (zorunlu — her pakete damgalanır)">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Temmuz kapanışı telafisi"
            />
          </Field>

          <Button className="min-h-11 w-full" variant="outline" onClick={runPreview} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Önizleme Oluştur
          </Button>
        </div>
      </Section>

      {plan ? (
        <>
          <MetricStrip>
            <Metric compact label="Etkilenecek paket" value={plan.toApply.length} />
            <Metric compact label="Üye" value={new Set(plan.toApply.map((e) => e.memberId)).size} />
            <Metric
              compact
              label="Dondurulmuş (işlenmez)"
              value={plan.skipped.filter((s) => s.reason === 'frozen').length}
              tone={plan.skipped.some((s) => s.reason === 'frozen') ? 'warning' : 'default'}
            />
            <Metric
              compact
              label="Aktif değil"
              value={plan.skipped.filter((s) => s.reason === 'not_active').length}
            />
          </MetricStrip>

          <Section title="Etkilenecek paketler" hint={`${plan.toApply.length}`}>
            {plan.toApply.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu kapsamda paket yok.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {plan.toApply.slice(0, 25).map((e) => (
                  <li key={e.entitlementId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{e.memberName}</p>
                      <p className="truncate text-xs text-muted-foreground">{e.productName}</p>
                    </div>
                  </li>
                ))}
                {plan.toApply.length > 25 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    +{plan.toApply.length - 25} paket daha
                  </li>
                ) : null}
              </ul>
            )}
          </Section>

          <Section title="İşlenmeyecekler" hint="hiçbir şey sessizce atlanmaz">
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
              {[
                ['frozen', 'Dondurulmuş — freeze aritmetiği toplu işleme karıştırılmaz'],
                ['not_active', 'Aktif değil (süresi dolmuş / iptal)'],
                ['out_of_scope', 'Kapsam dışı'],
              ].map(([key, label]) => {
                const items = plan.skipped.filter((s) => s.reason === key)
                if (items.length === 0) return null
                return (
                  <li key={key} className="px-3 py-2.5">
                    <p className="font-medium text-foreground">
                      {label} · {items.length}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {items.slice(0, 8).map((i) => i.memberName).join(' · ')}
                      {items.length > 8 ? ` +${items.length - 8}` : ''}
                    </p>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Button
            variant="destructive"
            className="min-h-11 w-full"
            onClick={() => setConfirm(true)}
            disabled={!canApply || busy}
          >
            Toplu İşlemi Uygula
          </Button>
        </>
      ) : null}

      <Dialog open={confirm} onOpenChange={(o) => (o ? null : setConfirm(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Toplu işlemi uygula?</DialogTitle>
            <DialogDescription>
              {plan?.toApply.length ?? 0} pakete{' '}
              {actionKind === 'extend_days' ? `+${amount} gün` : `+${amount} kredi`} uygulanacak. Bu
              işlem <span className="font-medium text-foreground">geri alınamaz</span> — geri almak
              yeni ve görünür bir telafi işlemi gerektirir. Yalnızca bir kez uygulanabilir.
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
