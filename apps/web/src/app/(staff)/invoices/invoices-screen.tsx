'use client'

import { DownloadIcon, PencilIcon, SettingsIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { downloadCsv } from '@/lib/export/csv'
import { RANGES, resolveRange, type RangeId } from '@/lib/ranges'
import {
  invoicePdfUrlAction,
  loadInvoicesAction,
  markInvoiceIssuedAction,
  requestEArchiveAction,
  revertInvoiceAction,
  setNationalIdAction,
  type InvoiceList,
  type InvoiceRow,
  type InvoiceSetup,
} from '@/server/actions/invoices'

import { ReportPinGate } from '../reports/pin-gate'
import { InvoiceSettingsPanel } from './invoice-settings'

// FATURA TAKİBİ (owner, 2026-11-03) + FT-2 PARAŞÜT e-ARŞİV (owner, 2026-11-04 · OR-132).
// One row per payment. Which buttons a row offers comes from the studio's document rule (data):
//   kart/POS → "ÖKC · otomatik" (the device prints it; the row does not wait)
//   nakit    → "Fiş kesildi" (hand tick) or "e-Arşiv kes"
//   havale/online → "e-Arşiv kes"
// An e-Arşiv is ALWAYS a human's press, through one confirmation showing who, TC and amount.

const METHOD: Record<string, string> = {
  cash: 'Nakit',
  bank_transfer: 'Havale / EFT',
  credit_card: 'Kredi kartı',
  pos: 'POS',
  online: 'Online (PayTR)',
  gift_card: 'Hediye kartı',
  wallet: 'Cüzdan',
}
const DOCUMENT: Record<string, string> = { okc_receipt: 'ÖKC fişi', e_archive: 'e-Arşiv', e_invoice: 'e-Fatura' }
const DURUM = [
  { id: 'bekleyen', label: 'Kesilmedi' },
  { id: 'kesilen', label: 'Kesildi' },
  { id: 'otomatik', label: 'ÖKC otomatik' },
  { id: 'hepsi', label: 'Tümü' },
] as const
type DurumId = (typeof DURUM)[number]['id']

const DAY = 86_400_000
/** Havale/EFT: the invoice is due within 7 days of the money arriving (owner, 2026-11-03). */
function sonGun(r: InvoiceRow, now: number): { text: string; urgent: boolean } | null {
  if (r.method !== 'bank_transfer' || r.issued) return null
  const due = r.receivedAt + 7 * DAY
  const left = Math.floor((due - now) / DAY)
  if (left < 0) return { text: `Süre ${-left} gün geçti`, urgent: true }
  if (left === 0) return { text: 'Bugün son gün', urgent: true }
  return { text: `${left} gün kaldı`, urgent: left <= 3 }
}

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`
const gun = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const lira = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

const chip = (on: boolean) =>
  `min-h-10 rounded-lg border px-3 text-sm transition-colors ${
    on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  }`

/** The row's state, in one place, so the table, the cards and the filters agree. */
type State = 'issued' | 'auto' | 'pending' | 'failed' | 'open'
function stateOf(r: InvoiceRow): State {
  if (r.issued) return 'issued'
  if (r.eArchive?.status === 'pending' && !r.eArchive.stale) return 'pending'
  if (r.eArchive) return 'failed'
  if (r.rule === 'okc_auto') return 'auto'
  return 'open'
}
function badge(r: InvoiceRow): { text: string; cls: string } {
  switch (stateOf(r)) {
    case 'issued':
      return { text: r.document ? DOCUMENT[r.document]! : 'Elle işaretli', cls: 'bg-success/10 text-success' }
    case 'auto':
      return { text: 'ÖKC · otomatik', cls: 'bg-muted text-muted-foreground' }
    case 'pending':
      return { text: 'Kesiliyor…', cls: 'bg-primary-soft text-primary' }
    case 'failed':
      return { text: r.eArchive?.status === 'pending' ? 'Yanıt yok' : 'Kesilemedi', cls: 'bg-danger/10 text-danger' }
    default:
      return { text: 'Kesilmedi', cls: 'bg-warning/10 text-warning' }
  }
}

export function InvoicesScreen() {
  const [rangeId, setRangeId] = useState<RangeId>('last30')
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({})
  const [durum, setDurum] = useState<DurumId>('bekleyen')
  const [data, setData] = useState<InvoiceList | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<InvoiceRow[] | null>(null)
  const [settings, setSettings] = useState(false)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setBusy(true)
      try {
        const r = resolveRange(rangeId, Date.now(), custom)
        setData(await loadInvoicesAction({ fromMs: r.fromMs, toMs: r.toMs }))
      } catch {
        if (!quiet) toast.error('Liste okunamadı. Sayfayı yenileyin.')
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [rangeId, custom],
  )

  useEffect(() => {
    void load()
  }, [load])

  const all = useMemo(() => (data && !data.locked ? data.rows : []), [data])
  // While Paraşüt is working on something, look again every 10 s — the tick arrives by itself.
  const anyPending = all.some((r) => stateOf(r) === 'pending')
  useEffect(() => {
    if (!anyPending) return
    const t = setInterval(() => void load(true), 10_000)
    return () => clearInterval(t)
  }, [anyPending, load])

  const rows = useMemo(
    () =>
      all.filter((r) => {
        const s = stateOf(r)
        if (durum === 'hepsi') return true
        if (durum === 'kesilen') return s === 'issued'
        if (durum === 'otomatik') return s === 'auto'
        return s === 'open' || s === 'pending' || s === 'failed'
      }),
    [all, durum],
  )

  if (data?.locked) {
    // `onUnlocked` verilince kapı kendi sayfa boşluğunu koymuyor (Kasa onu bir diyaloğun içinde kullanıyor);
    // burada tam sayfa, o yüzden boşluk dışarıdan.
    return (
      <main className="mx-auto max-w-md p-6 sm:p-10">
        <ReportPinGate varsayilan={data.varsayilanPin} title="Fatura Takibi kilitli" onUnlocked={() => void load()} />
      </main>
    )
  }

  const placeholder = data && !data.locked ? data.placeholder : '11111111111'
  const setup: InvoiceSetup = data && !data.locked ? data.setup : { eArchiveReady: false, receiptLimitKurus: null, environment: 'staging' }
  const bekleyen = all.filter((r) => ['open', 'pending', 'failed'].includes(stateOf(r)))
  const otomatik = all.filter((r) => stateOf(r) === 'auto').length
  const kesilen = all.filter((r) => r.issued).length
  const eArsiv = all.filter((r) => r.byParasut).length
  const amountOf = (r: InvoiceRow) => amounts[r.paymentId] ?? String(r.amountKurus / 100).replace('.', ',')
  const selectable = (r: InvoiceRow) => setup.eArchiveReady && (stateOf(r) === 'open' || stateOf(r) === 'failed')
  const chosen = all.filter((r) => selected.has(r.paymentId) && selectable(r))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const actions: RowActions = {
    setup,
    placeholder,
    amountOf,
    setAmount: (id, v) => setAmounts((a) => ({ ...a, [id]: v })),
    selected,
    selectable,
    toggle,
    eArchive: (r) => setConfirm([r]),
    changed: () => void load(true),
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Fatura Takibi"
        description="Hangi tahsilatın belgesi kesildi, hangisi bekliyor?"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSettings((v) => !v)}>
              <SettingsIcon />
              Belge ayarları
            </Button>
            <Button
              variant="outline"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv({
                  name: 'fatura-takibi',
                  columns: ['Tarih', 'Ad Soyad', 'TC', 'Yöntem', 'Tutar (₺)', 'Belge', 'Kesilen tutar (₺)', 'Belge no', 'Not'],
                  rows: rows.map((r) => [
                    gun(r.receivedAt),
                    r.fullName,
                    r.nationalId ?? placeholder,
                    METHOD[r.method] ?? r.method,
                    r.amountKurus / 100,
                    badge(r).text,
                    r.invoicedKurus === null ? '' : r.invoicedKurus / 100,
                    r.documentNo ?? '',
                    r.note ?? '',
                  ]),
                })
              }
            >
              <DownloadIcon />
              CSV
            </Button>
          </div>
        }
      />

      {settings ? <InvoiceSettingsPanel onSaved={() => void load(true)} onClose={() => setSettings(false)} /> : null}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button key={r.id} type="button" onClick={() => setRangeId(r.id)} className={chip(r.id === rangeId)}>
              {r.label}
            </button>
          ))}
        </div>
        {rangeId === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-auto" value={custom.from ?? ''} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-sm text-muted-foreground">—</span>
            <Input type="date" className="w-auto" value={custom.to ?? ''} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {DURUM.map((d) => (
            <button key={d.id} type="button" onClick={() => setDurum(d.id)} className={chip(d.id === durum)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {data && !data.locked ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-medium">
            {all.length} tahsilat · {kesilen} belgelendi · {otomatik} ÖKC otomatik (kart) · {bekleyen.length} bekliyor (
            {tl(bekleyen.reduce((n, r) => n + r.amountKurus, 0))})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bu aralıkta Paraşüt’ten kesilen e-Arşiv: {eArsiv} ({eArsiv} kontör). Kart/POS fişini cihaz basar, listede beklemez. Nakit: fiş
            kestiyseniz tikleyin; müşteri isterse e-Arşiv kesin. Havale/EFT’de fatura 7 gün içinde kesilmeli — son 3 gününe girenler her sabah
            09:00’da e-postayla bildirilir. TC’si girilmemiş üyede {placeholder} yazar; kalem simgesiyle TC girebilirsiniz.
            {setup.eArchiveReady
              ? setup.environment === 'staging'
                ? ' Paraşüt TEST ortamına bağlı: kesilen faturalar gerçek değil.'
                : ''
              : ' e-Arşiv düğmesi, Belge ayarlarında KDV oranı girilip Paraşüt bağlanınca açılır.'}
          </p>
        </div>
      ) : null}

      {chosen.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary px-4 py-2.5 text-primary-foreground">
          <span className="text-sm font-medium">
            {chosen.length} tahsilat seçili · toplam {tl(chosen.reduce((n, r) => n + Math.round(lira(amountOf(r)) * 100 || 0), 0))}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" className="text-primary-foreground hover:bg-white/10" onClick={() => setSelected(new Set())}>
              Seçimi kaldır
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(chosen)}>
              {chosen.length} e-Arşiv kes…
            </Button>
          </div>
        </div>
      ) : null}

      {busy ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}

      {data && !data.locked && rows.length === 0 && !busy ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Bu seçimde tahsilat yok.</div>
      ) : null}

      {rows.length > 0 ? (
        <>
          {/* Telefon: kart listesi */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <Card key={r.paymentId} row={r} a={actions} />
            ))}
          </ul>
          {/* Masaüstü: tablo */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-3 py-2">
                    <span className="sr-only">Seç</span>
                  </th>
                  {['Belge', 'Tarih', 'Ad Soyad', 'TC', 'Yöntem', 'Tutar', 'Kesilen tutar', 'Belge no / not', 'İşlem'].map((c) => (
                    <th key={c} className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <Row key={r.paymentId} row={r} a={actions} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {confirm ? (
        <ConfirmEArchive
          rows={confirm}
          placeholder={placeholder}
          amountOf={amountOf}
          setAmount={actions.setAmount}
          staging={setup.environment === 'staging'}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null)
            setSelected(new Set())
            void load(true)
          }}
        />
      ) : null}
    </main>
  )
}

interface RowActions {
  readonly setup: InvoiceSetup
  readonly placeholder: string
  readonly amountOf: (r: InvoiceRow) => string
  readonly setAmount: (id: string, v: string) => void
  readonly selected: ReadonlySet<string>
  readonly selectable: (r: InvoiceRow) => boolean
  readonly toggle: (id: string) => void
  readonly eArchive: (r: InvoiceRow) => void
  readonly changed: () => void
}

/** The per-row controls — shared by the table row and the phone card. */
function useRowControls(row: InvoiceRow, a: RowActions) {
  const [note, setNote] = useState(row.note ?? '')
  const [saving, setSaving] = useState(false)
  const s = stateOf(row)

  async function tick() {
    const value = lira(a.amountOf(row))
    if (!Number.isFinite(value) || value <= 0) return void toast.error('Kesilen tutarı girin.')
    setSaving(true)
    try {
      // An e-Arşiv-rule row ticked by hand = cut elsewhere (the GİB portal); every other row = an ÖKC receipt.
      const document = row.rule === 'e_archive' ? 'e_archive' : 'okc_receipt'
      const r = await markInvoiceIssuedAction({ paymentId: row.paymentId, note: note.trim() || null, invoicedKurus: Math.round(value * 100), document })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      else toast.success(`${row.fullName} — ${document === 'okc_receipt' ? 'fiş kesildi' : 'elle işaretlendi'}.`)
      a.changed()
    } catch {
      toast.error('Kaydedilemedi. Bağlantınızı kontrol edin.')
    } finally {
      setSaving(false)
    }
  }

  async function untick() {
    const reason = window.prompt(row.byParasut ? 'Tik neden kaldırılıyor? (zorunlu) — e-Arşiv’i önce Paraşüt panelinden iptal edin.' : 'Tik neden kaldırılıyor? (zorunlu)')
    if (reason === null) return
    setSaving(true)
    try {
      const r = await revertInvoiceAction({ paymentId: row.paymentId, reason })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      a.changed()
    } catch {
      toast.error('Kaydedilemedi. Bağlantınızı kontrol edin.')
    } finally {
      setSaving(false)
    }
  }

  async function pdf() {
    const url = await invoicePdfUrlAction({ paymentId: row.paymentId })
    if (url) window.open(url, '_blank', 'noopener')
    else toast.error('PDF henüz hazır değil. Birkaç dakika sonra tekrar deneyin.')
  }

  async function editTc() {
    const v = window.prompt(`${row.fullName} — TC kimlik numarası (boş bırakırsanız silinir)`, row.nationalId ?? '')
    if (v === null) return
    try {
      const r = await setNationalIdAction({ memberId: row.memberId, nationalId: v.trim() === '' ? null : v.trim() })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      else a.changed()
    } catch {
      toast.error('Kaydedilemedi. Bağlantınızı kontrol edin.')
    }
  }

  const overLimit = a.setup.receiptLimitKurus !== null && row.rule !== 'e_archive' && !row.issued && row.amountKurus > a.setup.receiptLimitKurus
  const canTick = s === 'open' || s === 'failed' || s === 'auto'
  const buttons = (
    <div className="flex flex-wrap justify-end gap-1.5">
      {canTick && row.rule === 'okc_manual' ? (
        <Button variant="outline" size="lg" className="min-h-10" disabled={saving} onClick={() => void tick()}>
          Fiş kesildi
        </Button>
      ) : null}
      {(s === 'open' || s === 'auto') && a.setup.eArchiveReady ? (
        <Button size="lg" className="min-h-10" variant={s === 'auto' ? 'outline' : 'default'} disabled={saving} onClick={() => a.eArchive(row)}>
          e-Arşiv kes
        </Button>
      ) : null}
      {s === 'failed' && a.setup.eArchiveReady ? (
        <Button size="lg" variant="outline" className="min-h-10 border-danger text-danger" disabled={saving} onClick={() => a.eArchive(row)}>
          Tekrar dene
        </Button>
      ) : null}
      {canTick && row.rule === 'e_archive' ? (
        <Button variant="ghost" size="lg" className="min-h-10" disabled={saving} onClick={() => void tick()} title="Faturayı başka yerden kestiyseniz">
          Elle işaretle
        </Button>
      ) : null}
      {row.byParasut ? (
        <Button variant="outline" size="lg" className="min-h-10" onClick={() => void pdf()}>
          PDF
        </Button>
      ) : null}
      {s === 'issued' ? (
        <Button variant="ghost" size="lg" className="min-h-10" disabled={saving} onClick={() => void untick()}>
          Tiki kaldır
        </Button>
      ) : null}
    </div>
  )

  const noteCell =
    s === 'issued' ? (
      <span className="text-muted-foreground">{[row.documentNo, row.note].filter(Boolean).join(' · ') || '—'}</span>
    ) : s === 'pending' ? (
      <span className="text-muted-foreground">Paraşüt işliyor — sayfa kendiliğinden güncellenir.</span>
    ) : s === 'failed' ? (
      <span className="text-danger">{row.eArchive?.error ?? 'Paraşüt yanıt vermedi.'}</span>
    ) : s === 'auto' ? (
      <span className="text-muted-foreground">POS cihazı fişi basar.</span>
    ) : (
      <Input value={note} maxLength={300} placeholder="Fiş no / not" onChange={(e) => setNote(e.target.value)} className="h-9" />
    )

  const amountCell =
    s === 'issued' ? (
      row.invoicedKurus === null ? '—' : tl(row.invoicedKurus)
    ) : s === 'open' || s === 'auto' ? (
      <Input value={a.amountOf(row)} inputMode="decimal" onChange={(e) => a.setAmount(row.paymentId, e.target.value)} className="h-9 w-28 text-right" aria-label="Kesilen tutar" />
    ) : (
      '—'
    )

  const tc = (
    <button type="button" onClick={() => void editTc()} className="inline-flex min-h-9 items-center gap-1.5 hover:text-primary" title="TC düzenle">
      <span className={row.nationalId ? '' : 'text-muted-foreground'}>{row.nationalId ?? a.placeholder}</span>
      <PencilIcon className="size-3.5 opacity-60" />
    </button>
  )

  const check = a.selectable(row) ? (
    <label className="inline-flex min-h-10 items-center">
      <input type="checkbox" checked={a.selected.has(row.paymentId)} onChange={() => a.toggle(row.paymentId)} className="size-5 accent-primary" aria-label={`${row.fullName} seç`} />
    </label>
  ) : null

  return { s, buttons, noteCell, amountCell, tc, check, overLimit }
}

function Row({ row, a }: { row: InvoiceRow; a: RowActions }) {
  const c = useRowControls(row, a)
  const b = badge(row)
  const due = sonGun(row, Date.now())
  return (
    <tr className={c.s === 'issued' ? 'bg-success/5' : c.s === 'failed' ? 'bg-danger/5' : 'hover:bg-muted/30'}>
      <td className="px-3 py-2">{c.check}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{gun(row.receivedAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.fullName}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{c.tc}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {METHOD[row.method] ?? row.method}
        {due ? <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs ${due.urgent ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}`}>{due.text}</span> : null}
        {c.overLimit ? <span className="ml-2 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs text-warning">Fiş sınırı üstü</span> : null}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{tl(row.amountKurus)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{c.amountCell}</td>
      <td className="min-w-48 px-3 py-2">{c.noteCell}</td>
      <td className="px-3 py-2">{c.buttons}</td>
    </tr>
  )
}

function Card({ row, a }: { row: InvoiceRow; a: RowActions }) {
  const c = useRowControls(row, a)
  const b = badge(row)
  const due = sonGun(row, Date.now())
  return (
    <li className={`space-y-2 rounded-xl border bg-card p-3 ${c.s === 'failed' ? 'border-danger/40' : 'border-border'}`}>
      <div className="flex items-start gap-2">
        {c.check}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{row.fullName}</span>
            <span className="font-semibold tabular-nums">{tl(row.amountKurus)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {METHOD[row.method] ?? row.method} · {gun(row.receivedAt)}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 font-semibold ${b.cls}`}>{b.text}</span>
            {due ? <span className={due.urgent ? 'text-danger' : ''}>{due.text}</span> : null}
            {c.overLimit ? <span className="text-warning">Fiş sınırı üstü</span> : null}
          </div>
          <div className="mt-1 text-xs">TC {c.tc}</div>
        </div>
      </div>
      <div className="text-sm">{c.noteCell}</div>
      {c.s === 'open' || c.s === 'auto' ? (
        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          Kesilen tutar {c.amountCell}
        </label>
      ) : null}
      {c.buttons}
    </li>
  )
}

/** One confirmation for the batch: who, TC, amount — then nothing can be taken back here. */
function ConfirmEArchive({
  rows,
  placeholder,
  amountOf,
  setAmount,
  staging,
  onClose,
  onDone,
}: {
  rows: InvoiceRow[]
  placeholder: string
  amountOf: (r: InvoiceRow) => string
  setAmount: (id: string, v: string) => void
  staging: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  // A retry keeps the first request's amount (the same invoice at Paraşüt): not editable.
  const retry = (r: InvoiceRow) => r.eArchive !== null
  const kurus = (r: InvoiceRow) => (r.eArchive ? r.eArchive.invoicedKurus : Math.round(lira(amountOf(r)) * 100))
  const total = rows.reduce((n, r) => n + (kurus(r) || 0), 0)

  async function go() {
    if (rows.some((r) => !Number.isInteger(kurus(r)) || kurus(r) <= 0)) return void toast.error('Her satırın kesilen tutarını girin.')
    setBusy(true)
    try {
      const res = await requestEArchiveAction({ items: rows.map((r) => ({ paymentId: r.paymentId, invoicedKurus: kurus(r) })) })
      const bad = res.filter((x) => !x.ok)
      if (bad.length === 0) toast.success(`${res.length} e-Arşiv Paraşüt’e gönderildi. Kesilince satırlar kendiliğinden tiklenecek.`)
      else toast.error(`${bad.length} satır gönderilemedi: ${bad[0]?.error ? domainErrorMessage(bad[0].error) : ''}`)
      onDone()
    } catch {
      toast.error('Gönderilemedi. Bağlantınızı kontrol edin.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rows.length === 1 ? 'e-Arşiv faturası kesilecek' : `${rows.length} e-Arşiv faturası kesilecek`}</DialogTitle>
          <DialogDescription>
            Paraşüt üzerinden GİB’e gider. Kesilen fatura buradan geri alınamaz; iptal Paraşüt panelinden yapılır.
            {staging ? ' TEST ortamı: gerçek fatura kesilmez.' : ''}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.paymentId} className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${r.nationalId ? 'border-border' : 'border-warning/50 bg-warning/5'}`}>
              <div>
                <p className="text-xs text-muted-foreground">Alıcı</p>
                <p className="font-semibold">{r.fullName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">TC</p>
                <p className={`tabular-nums ${r.nationalId ? '' : 'text-warning'}`}>{r.nationalId ?? `${placeholder} (girilmemiş)`}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {METHOD[r.method] ?? r.method} · {gun(r.receivedAt)} · tahsilat {tl(r.amountKurus)}
              </p>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Kesilen tutar (KDV dahil)
                {retry(r) ? (
                  <span className="text-sm font-medium text-foreground tabular-nums">{tl(kurus(r))} · ilk denemenin tutarı</span>
                ) : (
                  <Input value={amountOf(r)} inputMode="decimal" onChange={(e) => setAmount(r.paymentId, e.target.value)} className="h-10 text-right text-base" />
                )}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Toplam · {rows.length} kontör kullanılır</span>
          <span className="font-bold tabular-nums">{tl(total)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy} onClick={() => void go()}>
            {busy ? 'Gönderiliyor…' : rows.length === 1 ? 'e-Arşiv kes' : `${rows.length} e-Arşiv kes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
