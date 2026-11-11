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
// Ödeme yöntemi süzgeci (owner, 2026-11-05): fiziksel kart = kredi kartı + POS, ikisi de ÖKC'den.
const YONTEM = [
  { id: 'hepsi', label: 'Tüm yöntemler', methods: null },
  { id: 'havale', label: 'Havale / EFT', methods: ['bank_transfer'] },
  { id: 'kart', label: 'Fiziksel KK', methods: ['credit_card', 'pos'] },
  { id: 'online', label: 'Online (PayTR)', methods: ['online'] },
  { id: 'nakit', label: 'Nakit', methods: ['cash'] },
] as const
type YontemId = (typeof YONTEM)[number]['id']

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
  const [yontem, setYontem] = useState<YontemId>('hepsi')
  const [data, setData] = useState<InvoiceList | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<InvoiceRow[] | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

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
        const methods = YONTEM.find((y) => y.id === yontem)?.methods
        if (methods && !(methods as readonly string[]).includes(r.method)) return false
        const s = stateOf(r)
        if (durum === 'hepsi') return true
        if (durum === 'kesilen') return s === 'issued'
        if (durum === 'otomatik') return s === 'auto'
        return s === 'open' || s === 'pending' || s === 'failed'
      }),
    [all, durum, yontem],
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
  const setup: InvoiceSetup = data && !data.locked ? data.setup : { eArchiveReady: false, receiptLimitKurus: null, environment: 'staging', memberEmail: false }
  const bekleyen = all.filter((r) => ['open', 'pending', 'failed'].includes(stateOf(r)))
  const otomatik = all.filter((r) => stateOf(r) === 'auto').length
  const kesilen = all.filter((r) => r.issued).length
  const eArsiv = all.filter((r) => r.byParasut).length
  // Online: the invoice is cut for what the card was charged, commission included (owner, 2026-11-05).
  const amountOf = (r: InvoiceRow) => amounts[r.paymentId] ?? String((r.chargedKurus ?? r.amountKurus) / 100).replace('.', ',')
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
    open: (r) => setOpened(r.paymentId),
    changed: () => void load(true),
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Fatura Takibi"
        description="Hangi tahsilatın belgesi kesildi, hangisi bekliyor?"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<a href="/settings?tab=fatura" />}>
              <SettingsIcon />
              Fatura ayarları
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
        <div className="flex flex-wrap gap-2">
          {YONTEM.map((y) => (
            <button key={y.id} type="button" onClick={() => setYontem(y.id)} className={chip(y.id === yontem)}>
              {y.label}
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
              : ' e-Arşiv düğmesi, Ayarlar → Fatura’da Paraşüt bağlanınca açılır.'}
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
          {/* Süzülen satırların toplamı (owner, 2026-11-05). */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm">
            <span>
              Listede <strong>{rows.length}</strong> tahsilat · toplam <strong className="tabular-nums">{tl(rows.reduce((n, r) => n + r.amountKurus, 0))}</strong>
              {rows.some((r) => r.chargedKurus !== null && r.chargedKurus !== r.amountKurus) ? (
                <span className="text-muted-foreground"> · kartlardan çekilen {tl(rows.reduce((n, r) => n + (r.chargedKurus ?? r.amountKurus), 0))}</span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">Bir satıra tıklayın: e-Arşiv kes, fiş kesildi, tutar, not.</span>
          </div>
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
                  {['Belge', 'Tarih', 'Ad Soyad', 'TC', 'Yöntem', 'Tutar', 'Belge no / not', ''].map((c) => (
                    <th key={c || 'ac'} className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
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

      {opened && all.find((r) => r.paymentId === opened) ? (
        <RowDialog row={all.find((r) => r.paymentId === opened)!} a={actions} onClose={() => setOpened(null)} />
      ) : null}

      {confirm ? (
        <ConfirmEArchive
          rows={confirm}
          placeholder={placeholder}
          amountOf={amountOf}
          setAmount={actions.setAmount}
          staging={setup.environment === 'staging'}
          mailAllowed={setup.memberEmail}
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
  readonly open: (r: InvoiceRow) => void
  readonly changed: () => void
}

const overLimitOf = (r: InvoiceRow, a: RowActions) =>
  a.setup.receiptLimitKurus !== null && r.rule !== 'e_archive' && !r.issued && r.amountKurus > a.setup.receiptLimitKurus

function Check({ row, a }: { row: InvoiceRow; a: RowActions }) {
  if (!a.selectable(row)) return null
  return (
    <label className="inline-flex min-h-10 items-center" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={a.selected.has(row.paymentId)} onChange={() => a.toggle(row.paymentId)} className="size-5 accent-primary" aria-label={`${row.fullName} seç`} />
    </label>
  )
}

function shortNote(row: InvoiceRow): { text: string; cls: string } {
  switch (stateOf(row)) {
    case 'issued':
      return { text: [row.documentNo, row.note].filter(Boolean).join(' · ') || '—', cls: 'text-muted-foreground' }
    case 'pending':
      return { text: 'Paraşüt işliyor…', cls: 'text-muted-foreground' }
    case 'failed':
      return { text: row.eArchive?.error ?? 'Paraşüt yanıt vermedi.', cls: 'text-danger' }
    case 'auto':
      return { text: 'POS cihazı fişi basar.', cls: 'text-muted-foreground' }
    default:
      return { text: '—', cls: 'text-muted-foreground' }
  }
}

/** Ödeme satırı (masaüstü). Satırın tamamı tıklanır → işlem penceresi (owner, 2026-11-05). */
function Row({ row, a }: { row: InvoiceRow; a: RowActions }) {
  const b = badge(row)
  const due = sonGun(row, Date.now())
  const n = shortNote(row)
  const s = stateOf(row)
  return (
    <tr
      className={`cursor-pointer ${s === 'issued' ? 'bg-success/5' : s === 'failed' ? 'bg-danger/5' : ''} hover:bg-muted/40`}
      onClick={() => a.open(row)}
    >
      <td className="px-3 py-2">
        <Check row={row} a={a} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{gun(row.receivedAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={(e) => (e.stopPropagation(), a.open(row))}>
          {row.fullName}
        </button>
      </td>
      <td className={`px-3 py-2 whitespace-nowrap tabular-nums ${row.nationalId ? '' : 'text-muted-foreground'}`}>{row.nationalId ?? a.placeholder}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {METHOD[row.method] ?? row.method}
        {due ? <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs ${due.urgent ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}`}>{due.text}</span> : null}
        {overLimitOf(row, a) ? <span className="ml-2 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs text-warning">Fiş sınırı üstü</span> : null}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
        {tl(row.amountKurus)}
        {row.chargedKurus !== null && row.chargedKurus !== row.amountKurus ? (
          <span className="block text-xs text-muted-foreground">kartta {tl(row.chargedKurus)}</span>
        ) : null}
      </td>
      <td className={`max-w-56 truncate px-3 py-2 ${n.cls}`} title={n.text}>
        {n.text}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className="text-sm font-medium text-primary">Aç ›</span>
      </td>
    </tr>
  )
}

function Card({ row, a }: { row: InvoiceRow; a: RowActions }) {
  const b = badge(row)
  const due = sonGun(row, Date.now())
  const n = shortNote(row)
  return (
    <li className={`rounded-xl border bg-card ${stateOf(row) === 'failed' ? 'border-danger/40' : 'border-border'}`}>
      <div className="flex items-start gap-2 p-3">
        <Check row={row} a={a} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => a.open(row)}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{row.fullName}</span>
            <span className="text-right font-semibold tabular-nums">
              {tl(row.amountKurus)}
              {row.chargedKurus !== null && row.chargedKurus !== row.amountKurus ? (
                <span className="block text-xs font-normal text-muted-foreground">kartta {tl(row.chargedKurus)}</span>
              ) : null}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {METHOD[row.method] ?? row.method} · {gun(row.receivedAt)}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 font-semibold ${b.cls}`}>{b.text}</span>
            {due ? <span className={due.urgent ? 'text-danger' : ''}>{due.text}</span> : null}
            {overLimitOf(row, a) ? <span className="text-warning">Fiş sınırı üstü</span> : null}
          </div>
          {n.text !== '—' ? <p className={`mt-1 text-xs ${n.cls}`}>{n.text}</p> : null}
          <span className="mt-2 inline-block text-sm font-medium text-primary">İşlem ›</span>
        </button>
      </div>
    </li>
  )
}

/**
 * Bir tahsilatın işlem penceresi: e-Arşiv kes · Fiş kesildi · Elle işaretle · tutar · not · TC · PDF · tiki kaldır.
 * Satıra tıklayınca açılır, çünkü tabloda bu kadar düğmeye yer yok (owner, 2026-11-05: "tıklayıp buna e-arşiv kes").
 */
function RowDialog({ row, a, onClose }: { row: InvoiceRow; a: RowActions; onClose: () => void }) {
  const [note, setNote] = useState(row.note ?? '')
  const [saving, setSaving] = useState(false)
  const s = stateOf(row)
  const b = badge(row)

  async function tick() {
    const value = lira(a.amountOf(row))
    if (!Number.isFinite(value) || value <= 0) return void toast.error('Kesilen tutarı girin.')
    setSaving(true)
    try {
      // An e-Arşiv-rule row ticked by hand = cut elsewhere (the GİB portal); every other row = an ÖKC receipt.
      const document = row.rule === 'e_archive' ? 'e_archive' : 'okc_receipt'
      const r = await markInvoiceIssuedAction({ paymentId: row.paymentId, note: note.trim() || null, invoicedKurus: Math.round(value * 100), document })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      else {
        toast.success(`${row.fullName} — ${document === 'okc_receipt' ? 'fiş kesildi' : 'elle işaretlendi'}.`)
        onClose()
      }
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
      else onClose()
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

  const canTick = s === 'open' || s === 'failed' || s === 'auto'
  const canArchive = s === 'open' || s === 'auto' || s === 'failed'
  const charged = row.chargedKurus !== null && row.chargedKurus !== row.amountKurus

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.fullName}</DialogTitle>
          <DialogDescription>
            {METHOD[row.method] ?? row.method} · {gun(row.receivedAt)} · tahsilat {tl(row.amountKurus)}
            {charged ? ` · kartta ${tl(row.chargedKurus!)} (komisyonlu)` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>
          <button type="button" onClick={() => void editTc()} className="inline-flex min-h-9 items-center gap-1.5 hover:text-primary" title="TC düzenle">
            TC <span className={`tabular-nums ${row.nationalId ? '' : 'text-muted-foreground'}`}>{row.nationalId ?? a.placeholder}</span>
            <PencilIcon className="size-3.5 opacity-60" />
          </button>
        </div>

        {s === 'issued' ? (
          <p className="text-sm text-muted-foreground">
            Kesilen {row.invoicedKurus === null ? '—' : tl(row.invoicedKurus)}
            {row.documentNo ? ` · ${row.documentNo}` : ''}
            {row.note ? ` · ${row.note}` : ''}
            {row.pdfMail
              ? ` · PDF ${row.pdfMail.to} adresine ${row.pdfMail.status === 'sent' ? 'gönderildi' : row.pdfMail.status === 'pending' ? 'gönderiliyor' : 'gönderilemedi'}`
              : ''}
          </p>
        ) : s === 'pending' ? (
          <p className="text-sm text-muted-foreground">Paraşüt bu faturayı kesiyor — liste kendiliğinden güncellenir.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {s === 'failed' ? <p className="text-sm text-danger sm:col-span-2">{row.eArchive?.error ?? 'Paraşüt yanıt vermedi.'}</p> : null}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Kesilen tutar (KDV dahil)
              <Input value={a.amountOf(row)} inputMode="decimal" onChange={(e) => a.setAmount(row.paymentId, e.target.value)} className="h-10 text-right text-base" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Fiş no / not
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="h-10" />
            </label>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {canArchive ? (
            <Button
              size="lg"
              className="min-h-11"
              variant={row.rule === 'e_archive' || s === 'failed' ? 'default' : 'outline'}
              disabled={saving || !a.setup.eArchiveReady}
              onClick={() => {
                onClose()
                a.eArchive(row)
              }}
            >
              {s === 'failed' ? 'e-Arşiv — tekrar dene' : 'e-Arşiv fatura kes…'}
            </Button>
          ) : null}
          {canArchive && !a.setup.eArchiveReady ? (
            <p className="text-xs text-muted-foreground">e-Arşiv, Ayarlar → Fatura’da Paraşüt bağlanınca açılır.</p>
          ) : null}
          {canTick && row.rule === 'okc_manual' ? (
            <Button size="lg" className="min-h-11" variant="outline" disabled={saving} onClick={() => void tick()}>
              Fiş kesildi (ÖKC)
            </Button>
          ) : null}
          {canTick && row.rule === 'e_archive' ? (
            <Button size="lg" className="min-h-11" variant="ghost" disabled={saving} onClick={() => void tick()}>
              Elle işaretle — faturayı başka yerden kestim
            </Button>
          ) : null}
          {row.byParasut ? (
            <Button size="lg" className="min-h-11" variant="outline" onClick={() => void pdf()}>
              PDF’i aç
            </Button>
          ) : null}
          {s === 'issued' ? (
            <Button size="lg" className="min-h-11" variant="ghost" disabled={saving} onClick={() => void untick()}>
              Tiki kaldır
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One confirmation for the batch: who, TC, amount — then nothing can be taken back here. */
function ConfirmEArchive({
  rows,
  placeholder,
  amountOf,
  setAmount,
  staging,
  mailAllowed,
  onClose,
  onDone,
}: {
  rows: InvoiceRow[]
  placeholder: string
  amountOf: (r: InvoiceRow) => string
  setAmount: (id: string, v: string) => void
  staging: boolean
  mailAllowed: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  // PDF by e-mail (owner, 2026-11-05): a tick and an address per row; on by default when the member has one.
  const [mail, setMail] = useState<Record<string, { on: boolean; to: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.paymentId, { on: mailAllowed && r.memberEmail !== null, to: r.memberEmail ?? '' }])),
  )
  const mailOf = (r: InvoiceRow) => mail[r.paymentId] ?? { on: false, to: '' }
  const setMailOf = (r: InvoiceRow, v: Partial<{ on: boolean; to: string }>) => setMail((m) => ({ ...m, [r.paymentId]: { ...mailOf(r), ...v } }))
  // A retry keeps the first request's amount (the same invoice at Paraşüt): not editable.
  const retry = (r: InvoiceRow) => r.eArchive !== null
  const kurus = (r: InvoiceRow) => (r.eArchive ? r.eArchive.invoicedKurus : Math.round(lira(amountOf(r)) * 100))
  const total = rows.reduce((n, r) => n + (kurus(r) || 0), 0)

  async function go() {
    if (rows.some((r) => !Number.isInteger(kurus(r)) || kurus(r) <= 0)) return void toast.error('Her satırın kesilen tutarını girin.')
    if (rows.some((r) => mailOf(r).on && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mailOf(r).to.trim())))
      return void toast.error('PDF gönderilecek satırlarda geçerli bir e-posta adresi yazın.')
    setBusy(true)
    try {
      const res = await requestEArchiveAction({ items: rows.map((r) => ({ paymentId: r.paymentId, invoicedKurus: kurus(r), emailTo: mailOf(r).on ? mailOf(r).to.trim() : null })) })
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
                {r.chargedKurus !== null && r.chargedKurus !== r.amountKurus ? ` · kartta ${tl(r.chargedKurus)} (komisyonlu)` : ''}
              </p>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Kesilen tutar (KDV dahil)
                {retry(r) ? (
                  <span className="text-sm font-medium text-foreground tabular-nums">{tl(kurus(r))} · ilk denemenin tutarı</span>
                ) : (
                  <Input value={amountOf(r)} inputMode="decimal" onChange={(e) => setAmount(r.paymentId, e.target.value)} className="h-10 text-right text-base" />
                )}
              </label>
              {mailAllowed ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={mailOf(r).on} onChange={(e) => setMailOf(r, { on: e.target.checked })} className="size-5 accent-primary" />
                  Fatura PDF’i e-postayla gönderilsin
                </label>
                {mailOf(r).on ? (
                  <Input
                    type="email"
                    inputMode="email"
                    value={mailOf(r).to}
                    placeholder="ornek@eposta.com"
                    onChange={(e) => setMailOf(r, { to: e.target.value })}
                    className="h-10"
                    aria-label={`${r.fullName} — PDF gönderilecek e-posta`}
                  />
                ) : null}
              </div>
              ) : null}
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
