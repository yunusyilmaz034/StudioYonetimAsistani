'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BanknoteIcon, CheckCircle2Icon, Loader2Icon, LockIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'

import type {
  AdjustmentKind,
  CompensationModel,
  CompensationPlan,
  CompensationRates,
  PayrollStatement,
  PayrollStatementDraft,
} from '@studio/core'

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
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  ADJUSTMENT_LABEL,
  ADJUSTMENT_SIGN,
  formatKurus,
  kurusToLira,
  liraToKurus,
  MODEL_LABEL,
} from '@/lib/payroll-labels'
import {
  finalizeStatementAction,
  listStatementsAction,
  payStatementAction,
  recordAdjustmentAction,
  setCompensationPlanAction,
  statementDraftAction,
} from '@/server/actions/payroll'
import { EarningsBreakdown, monthPeriod, PeriodPicker, StatusPill, type Period } from '@/components/payroll/shared'

interface Trainer {
  readonly id: string
  readonly displayName: string
  readonly role: string
}
interface StatementLoad {
  readonly plan: CompensationPlan | null
  readonly periodKey: string
  readonly draft: PayrollStatementDraft | null
  readonly existing: PayrollStatement | null
}

const MODELS: readonly CompensationModel[] = ['fixed', 'hourly', 'per_class', 'per_member', 'commission', 'mixed']
const isErr = (r: unknown): r is { ok: false; error: Parameters<typeof domainErrorMessage>[0] } =>
  typeof r === 'object' && r !== null && 'ok' in r && (r as { ok: boolean }).ok === false

export function PayrollScreen({ trainers, initialPlans }: { trainers: readonly Trainer[]; initialPlans: readonly CompensationPlan[] }) {
  const [period, setPeriod] = useState<Period>(() => monthPeriod())
  const [loads, setLoads] = useState<Record<string, StatementLoad>>({})
  const [loading, setLoading] = useState(false)
  const [planFor, setPlanFor] = useState<Trainer | null>(null)
  const nameOf = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.displayName])), [trainers])

  const reload = useCallback(
    async (p: Period) => {
      setLoading(true)
      const entries = await Promise.all(
        trainers.map(async (t) => [t.id, await statementDraftAction({ trainerId: t.id, periodStart: p.start, periodEnd: p.end })] as const),
      )
      setLoads(Object.fromEntries(entries))
      setLoading(false)
    },
    [trainers],
  )

  useEffect(() => {
    void reload(period)
  }, [period, reload])

  const planByTrainer = useMemo(() => {
    const m: Record<string, CompensationPlan> = {}
    for (const load of Object.values(loads)) if (load.plan) m[load.plan.trainerId] = load.plan
    for (const pl of initialPlans) if (!m[pl.trainerId]) m[pl.trainerId] = pl
    return m
  }, [loads, initialPlans])

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bordro"
        description="Eğitmen hakedişleri gerçekleşen derslerden ve ona ait satışlardan hesaplanır. Ücret planı belirleyin, düzeltme ekleyin, dönemi kesinleştirip ödeyin."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker onChange={setPeriod} />
        {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <Section title="Eğitmenler" hint={period.label}>
        {trainers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Aktif personel bulunamadı.
          </p>
        ) : (
          <ul className="space-y-2">
            {trainers.map((t) => (
              <TrainerRow
                key={t.id}
                trainer={t}
                load={loads[t.id]}
                onEditPlan={() => setPlanFor(t)}
                onChanged={() => reload(period)}
              />
            ))}
          </ul>
        )}
      </Section>

      <ReportsSection nameOf={nameOf} />

      {planFor ? (
        <PlanDialog
          trainer={planFor}
          current={planByTrainer[planFor.id] ?? null}
          onClose={() => setPlanFor(null)}
          onSaved={() => {
            setPlanFor(null)
            void reload(period)
          }}
        />
      ) : null}
    </main>
  )
}

// ── One trainer's row: model + net + status, expanding to the full breakdown and its actions. ──
function TrainerRow({
  trainer,
  load,
  onEditPlan,
  onChanged,
}: {
  trainer: Trainer
  load: StatementLoad | undefined
  onEditPlan: () => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const shown = load?.existing ? load.existing.draft : load?.draft ?? null
  const status: 'draft' | 'finalized' | 'paid' = load?.existing ? load.existing.status : 'draft'

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{trainer.displayName}</p>
          <p className="text-xs text-muted-foreground">{load?.plan ? MODEL_LABEL[load.plan.model] : 'Ücret planı tanımlı değil'}</p>
        </div>
        <div className="flex items-center gap-3">
          {shown ? <span className="font-heading text-h2 font-medium tabular-nums text-foreground">{formatKurus(shown.netPayable.amount)}</span> : null}
          {load ? <StatusPill status={status} /> : <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {!load ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : !load.plan ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">Bu eğitmen için henüz bir ücret planı tanımlanmadı. Hakediş hesaplanabilmesi için önce planı belirleyin.</p>
              <Button size="sm" onClick={onEditPlan}>
                <SettingsIcon /> Plan Tanımla
              </Button>
            </div>
          ) : shown ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Plan: <span className="text-foreground">{MODEL_LABEL[load.plan.model]}</span> · v{load.plan.version}
                  {load.plan.payOnPresumed ? ' · varsayılan katılım ödenir' : ''}
                  {load.plan.payOnNoShow ? ' · no-show ödenir' : ''}
                </p>
                <Button variant="outline" size="sm" onClick={onEditPlan}>
                  <SettingsIcon /> Planı Düzenle
                </Button>
              </div>

              <EarningsBreakdown draft={shown} />

              {status === 'paid' ? (
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2Icon className="size-4" /> {formatKurus(shown.netPayable.amount)} ödendi
                  {load.existing?.paidNote ? ` · ${load.existing.paidNote}` : ''}
                </p>
              ) : (
                <StatementActions trainer={trainer} load={load} draft={shown} status={status} onChanged={onChanged} />
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

// The money decisions for one trainer/period: add an adjustment (draft only), finalize, then pay.
function StatementActions({
  trainer,
  load,
  draft,
  status,
  onChanged,
}: {
  trainer: Trainer
  load: StatementLoad
  draft: PayrollStatementDraft
  status: 'draft' | 'finalized' | 'paid'
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function finalize() {
    setBusy(true)
    const res = await finalizeStatementAction({ trainerId: trainer.id, periodStart: draft.periodStart, periodEnd: draft.periodEnd })
    setBusy(false)
    if (isErr(res)) { toast.error(domainErrorMessage(res.error)); return }
    toast.success('Dönem kesinleştirildi.')
    onChanged()
  }

  async function pay() {
    if (!load.existing) return
    setBusy(true)
    const res = await payStatementAction({ statementId: load.existing.id, amountKurus: draft.netPayable.amount, note: '' })
    setBusy(false)
    if (isErr(res)) { toast.error(domainErrorMessage(res.error)); return }
    toast.success('Ödendi olarak işaretlendi.')
    onChanged()
  }

  return (
    <div className="space-y-4">
      {status === 'draft' ? <AdjustmentForm trainerId={trainer.id} periodKey={load.periodKey} onSaved={onChanged} /> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {status === 'draft' ? (
          <Button size="sm" onClick={finalize} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <LockIcon />} Kesinleştir
          </Button>
        ) : (
          <Button size="sm" onClick={pay} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <BanknoteIcon />} Ödendi İşaretle ({formatKurus(draft.netPayable.amount)})
          </Button>
        )}
        {status === 'finalized' ? <span className="text-xs text-muted-foreground">Kesinleşen dönem yeniden hesaplanmaz.</span> : null}
      </div>
    </div>
  )
}

const ADJ_KINDS: readonly AdjustmentKind[] = ['bonus', 'deduction', 'correction', 'advance']

function AdjustmentForm({ trainerId, periodKey, onSaved }: { trainerId: string; periodKey: string; onSaved: () => void }) {
  const [kind, setKind] = useState<AdjustmentKind>('bonus')
  const [lira, setLira] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const magnitude = liraToKurus(lira)
  const signed = magnitude === null ? null : Math.abs(magnitude) * ADJUSTMENT_SIGN[kind]

  async function submit() {
    if (signed === null || signed === 0) { toast.error('Geçerli bir tutar girin.'); return }
    if (note.trim().length === 0) { toast.error('Açıklama zorunlu.'); return }
    setBusy(true)
    const res = await recordAdjustmentAction({ trainerId, periodKey, kind, amountKurus: signed, note })
    setBusy(false)
    if (isErr(res)) { toast.error(domainErrorMessage(res.error)); return }
    toast.success('Düzeltme eklendi.')
    setLira('')
    setNote('')
    onSaved()
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Düzeltme ekle</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind((v ?? 'bonus') as AdjustmentKind)}>
          <SelectTrigger className="w-32">
            <SelectValue>{ADJUSTMENT_LABEL[kind]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ADJ_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {ADJUSTMENT_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input inputMode="decimal" placeholder="Tutar ₺" value={lira} onChange={(e) => setLira(e.target.value)} className="w-28" />
        {signed !== null && signed !== 0 ? (
          <span className={`text-sm tabular-nums ${signed < 0 ? 'text-warning' : 'text-success'}`}>{formatKurus(signed)}</span>
        ) : null}
      </div>
      <Textarea placeholder="Açıklama (zorunlu)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <Button size="sm" variant="outline" onClick={submit} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Ekle
      </Button>
    </div>
  )
}

// ── The plan dialog: pick a model, fill only its rates, set the attendance-pay policy. ──
function PlanDialog({ trainer, current, onClose, onSaved }: { trainer: Trainer; current: CompensationPlan | null; onClose: () => void; onSaved: () => void }) {
  const [model, setModel] = useState<CompensationModel>(current?.model ?? 'per_class')
  const [base, setBase] = useState(current ? kurusToLira(current.rates.baseSalaryKurus) : '')
  const [hourly, setHourly] = useState(current ? kurusToLira(current.rates.hourlyRateKurus) : '')
  const [perClass, setPerClass] = useState(current ? kurusToLira(current.rates.perClassKurus) : '')
  const [perMember, setPerMember] = useState(current ? kurusToLira(current.rates.perMemberKurus) : '')
  const [commission, setCommission] = useState(current ? String(current.rates.commissionPercent) : '')
  const [payOnPresumed, setPayOnPresumed] = useState(current?.payOnPresumed ?? false)
  const [payOnNoShow, setPayOnNoShow] = useState(current?.payOnNoShow ?? false)
  const [note, setNote] = useState(current?.note ?? '')
  const [busy, setBusy] = useState(false)

  const show = (m: CompensationModel) => model === m || model === 'mixed'

  async function save() {
    const rates: CompensationRates = {
      baseSalaryKurus: liraToKurus(base) ?? 0,
      hourlyRateKurus: liraToKurus(hourly) ?? 0,
      perClassKurus: liraToKurus(perClass) ?? 0,
      perMemberKurus: liraToKurus(perMember) ?? 0,
      commissionPercent: Number(commission) || 0,
    }
    setBusy(true)
    const res = await setCompensationPlanAction({ trainerId: trainer.id, model, rates, payOnPresumed, payOnNoShow, note })
    setBusy(false)
    if (isErr(res)) { toast.error(domainErrorMessage(res.error)); return }
    toast.success('Ücret planı kaydedildi.')
    onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{trainer.displayName} — Ücret Planı</DialogTitle>
          <DialogDescription>Modeli seçin ve yalnızca o modelin gerektirdiği ücretleri girin. Karma modelde tüm alanlar toplanır.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Model">
            <Select value={model} onValueChange={(v) => setModel((v ?? 'per_class') as CompensationModel)}>
              <SelectTrigger>
                <SelectValue>{MODEL_LABEL[model]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODEL_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {show('fixed') ? <MoneyField label="Sabit maaş (aylık ₺)" value={base} onChange={setBase} /> : null}
          {show('hourly') ? <MoneyField label="Saatlik ücret (₺)" value={hourly} onChange={setHourly} /> : null}
          {show('per_class') ? <MoneyField label="Ders başı ücret (₺)" value={perClass} onChange={setPerClass} /> : null}
          {show('per_member') ? <MoneyField label="Üye başı ücret (₺)" value={perMember} onChange={setPerMember} /> : null}
          {show('commission') ? (
            <Field label="Komisyon (%)">
              <Input inputMode="decimal" placeholder="0–100" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </Field>
          ) : null}

          <label className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm">
            <input type="checkbox" checked={payOnPresumed} onChange={(e) => setPayOnPresumed(e.target.checked)} className="mt-0.5" />
            <span>
              Varsayılan (presumed) katılımı öde
              <span className="block text-xs text-muted-foreground">Eğitmen işaretlemese de sistemin katıldı saydığı üyeler üye-başı/ders hesabına dahil edilir.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm">
            <input type="checkbox" checked={payOnNoShow} onChange={(e) => setPayOnNoShow(e.target.checked)} className="mt-0.5" />
            <span>
              No-show’ları öde
              <span className="block text-xs text-muted-foreground">Gelmeyen üyeler de üye-başı hesabına dahil edilir.</span>
            </span>
          </label>

          <Field label="Not (isteğe bağlı)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input inputMode="decimal" placeholder="₺" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

// ── Reports: finalized/paid statements across trainers, with a commission column and totals. ──
function ReportsSection({ nameOf }: { nameOf: Record<string, string> }) {
  const [rows, setRows] = useState<readonly PayrollStatement[] | null>(null)

  useEffect(() => {
    void listStatementsAction({}).then((r) => setRows(r as readonly PayrollStatement[]))
  }, [])

  const totals = useMemo(() => {
    const list = rows ?? []
    const net = list.reduce((s, r) => s + r.draft.netPayable.amount, 0)
    const paid = list.filter((r) => r.status === 'paid').reduce((s, r) => s + r.draft.netPayable.amount, 0)
    return { net, paid }
  }, [rows])

  const commissionOf = (s: PayrollStatement) => s.draft.lines.find((l) => l.kind === 'commission')?.amount.amount ?? 0

  return (
    <Section title="Raporlar" hint="Kesinleşen ve ödenen hakedişler">
      {!rows ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Henüz kesinleşmiş hakediş yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eğitmen</TableHead>
                <TableHead>Dönem</TableHead>
                <TableHead className="text-right">Prim</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{nameOf[s.trainerId] ?? s.trainerId}</TableCell>
                  <TableCell className="text-muted-foreground">{s.periodKey}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKurus(commissionOf(s))}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatKurus(s.draft.netPayable.amount)}</TableCell>
                  <TableCell>
                    <StatusPill status={s.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rows && rows.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-6 text-sm">
          <span className="text-muted-foreground">
            Toplam hakediş: <span className="font-medium tabular-nums text-foreground">{formatKurus(totals.net)}</span>
          </span>
          <span className="text-muted-foreground">
            Toplam ödenen: <span className="font-medium tabular-nums text-success">{formatKurus(totals.paid)}</span>
          </span>
        </div>
      ) : null}
    </Section>
  )
}
