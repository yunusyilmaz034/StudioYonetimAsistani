'use client'

import { DownloadIcon, PencilIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { downloadCsv } from '@/lib/export/csv'
import { RANGES, resolveRange, type RangeId } from '@/lib/ranges'
import {
  loadInvoicesAction,
  markInvoiceIssuedAction,
  revertInvoiceAction,
  setNationalIdAction,
  type InvoiceList,
  type InvoiceRow,
} from '@/server/actions/invoices'

import { ReportPinGate } from '../reports/pin-gate'

// FATURA TAKİBİ (owner, 2026-11-03). One row per payment: ad soyad · TC (yoksa 11111111111) · yöntem ·
// tarih · tutar · "fatura kesildi" tiki · not. The tick is a record of paperwork done elsewhere — the
// system does not cut the invoice.

const METHOD: Record<string, string> = {
  cash: 'Nakit',
  bank_transfer: 'Havale / EFT',
  credit_card: 'Kredi kartı',
  pos: 'POS',
  online: 'Online',
  gift_card: 'Hediye kartı',
  wallet: 'Cüzdan',
}
const DURUM = [
  { id: 'bekleyen', label: 'Kesilmedi' },
  { id: 'kesilen', label: 'Kesildi' },
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

const chip = (on: boolean) =>
  `min-h-10 rounded-lg border px-3 text-sm transition-colors ${
    on ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  }`

export function InvoicesScreen() {
  const [rangeId, setRangeId] = useState<RangeId>('last30')
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({})
  const [durum, setDurum] = useState<DurumId>('bekleyen')
  const [data, setData] = useState<InvoiceList | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = resolveRange(rangeId, Date.now(), custom)
      setData(await loadInvoicesAction({ fromMs: r.fromMs, toMs: r.toMs }))
    } catch {
      toast.error('Liste okunamadı. Sayfayı yenileyin.')
    } finally {
      setBusy(false)
    }
  }, [rangeId, custom])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    if (!data || data.locked) return []
    return data.rows.filter((r) => (durum === 'hepsi' ? true : durum === 'kesilen' ? r.issued : !r.issued))
  }, [data, durum])

  if (data?.locked) {
    return <ReportPinGate varsayilan={data.varsayilanPin} title="Fatura Takibi kilitli" onUnlocked={() => void load()} />
  }

  const all = data && !data.locked ? data.rows : []
  const placeholder = data && !data.locked ? data.placeholder : '11111111111'
  const bekleyen = all.filter((r) => !r.issued)

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Fatura Takibi"
        description="Hangi tahsilatın faturası kesildi, hangisi bekliyor?"
        actions={
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv({
                name: 'fatura-takibi',
                columns: ['Tarih', 'Ad Soyad', 'TC', 'Yöntem', 'Tutar (₺)', 'Fatura', 'Kesilen tutar (₺)', 'Not'],
                rows: rows.map((r) => [
                  gun(r.receivedAt),
                  r.fullName,
                  r.nationalId ?? placeholder,
                  METHOD[r.method] ?? r.method,
                  r.amountKurus / 100,
                  r.issued ? 'Kesildi' : 'Kesilmedi',
                  r.invoicedKurus === null ? '' : r.invoicedKurus / 100,
                  r.note ?? '',
                ]),
              })
            }
          >
            <DownloadIcon />
            CSV
          </Button>
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
      </div>

      {data && !data.locked ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-medium">
            {all.length} tahsilat · {all.length - bekleyen.length} faturası kesildi · {bekleyen.length} bekliyor (
            {tl(bekleyen.reduce((n, r) => n + r.amountKurus, 0))})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Havale/EFT'lerde fatura 7 gün içinde kesilmeli: son 3 gününe girenler ve süresi geçenler her sabah 09:00'da
            e-postayla bildirilir. Tarih, paranın alındığı gündür. İptal edilen tahsilatlar ve test hesapları listede yok. TC'si girilmemiş
            üyede {placeholder} yazar; kalem simgesiyle üyenin TC'sini girebilirsiniz.
          </p>
        </div>
      ) : null}

      {busy ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}

      {data && !data.locked && rows.length === 0 && !busy ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Bu seçimde tahsilat yok.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {['Fatura', 'Tarih', 'Ad Soyad', 'TC', 'Yöntem', 'Tutar', 'Kesilen tutar', 'Not'].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <Row key={r.paymentId} row={r} placeholder={placeholder} onChanged={() => void load()} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}

function Row({ row, placeholder, onChanged }: { row: InvoiceRow; placeholder: string; onChanged: () => void }) {
  const [note, setNote] = useState(row.note ?? '')
  // Kesilen tutar — the payment's amount unless the desk types another (owner, 2026-11-03).
  const [kesilen, setKesilen] = useState(String(row.amountKurus / 100).replace('.', ','))
  const due = sonGun(row, Date.now())
  const [saving, setSaving] = useState(false)

  async function toggle() {
    setSaving(true)
    try {
      if (!row.issued) {
        const lira = Number(kesilen.replace(/\./g, '').replace(',', '.'))
        if (!Number.isFinite(lira) || lira <= 0) {
          toast.error('Kesilen tutarı girin.')
          return
        }
        const r = await markInvoiceIssuedAction({ paymentId: row.paymentId, note: note.trim() || null, invoicedKurus: Math.round(lira * 100) })
        if (!r.ok) toast.error(domainErrorMessage(r.error))
        else toast.success(`${row.fullName} — fatura kesildi olarak işaretlendi.`)
      } else {
        const reason = window.prompt('Tik neden kaldırılıyor? (zorunlu)')
        if (reason === null) return
        const r = await revertInvoiceAction({ paymentId: row.paymentId, reason })
        if (!r.ok) toast.error(domainErrorMessage(r.error))
      }
      onChanged()
    } catch {
      toast.error('Kaydedilemedi. Bağlantınızı kontrol edin.')
    } finally {
      setSaving(false)
    }
  }

  async function editTc() {
    const v = window.prompt(`${row.fullName} — TC kimlik numarası (boş bırakırsanız silinir)`, row.nationalId ?? '')
    if (v === null) return
    try {
      const r = await setNationalIdAction({ memberId: row.memberId, nationalId: v.trim() === '' ? null : v.trim() })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      else onChanged()
    } catch {
      toast.error('Kaydedilemedi. Bağlantınızı kontrol edin.')
    }
  }

  return (
    <tr className={row.issued ? 'bg-success/5' : 'hover:bg-muted/30'}>
      <td className="px-3 py-2">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 whitespace-nowrap">
          <input type="checkbox" checked={row.issued} disabled={saving} onChange={() => void toggle()} className="size-5 accent-primary" />
          <span className={row.issued ? 'text-success' : 'text-muted-foreground'}>{row.issued ? 'Kesildi' : 'Kesilmedi'}</span>
        </label>
      </td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{gun(row.receivedAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.fullName}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
        <button type="button" onClick={() => void editTc()} className="inline-flex items-center gap-1.5 hover:text-primary" title="TC düzenle">
          <span className={row.nationalId ? '' : 'text-muted-foreground'}>{row.nationalId ?? placeholder}</span>
          <PencilIcon className="size-3.5 opacity-60" />
        </button>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {METHOD[row.method] ?? row.method}
        {due ? (
          <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs ${due.urgent ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}`}>
            {due.text}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{tl(row.amountKurus)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
        {row.issued ? (
          row.invoicedKurus === null ? '—' : tl(row.invoicedKurus)
        ) : (
          <Input value={kesilen} inputMode="decimal" onChange={(e) => setKesilen(e.target.value)} className="h-9 w-28 text-right" aria-label="Kesilen tutar" />
        )}
      </td>
      <td className="min-w-48 px-3 py-2">
        {row.issued ? (
          <span className="text-muted-foreground">{row.note ?? '—'}</span>
        ) : (
          <Input value={note} maxLength={300} placeholder="Fatura no / not" onChange={(e) => setNote(e.target.value)} className="h-9" />
        )}
      </td>
    </tr>
  )
}
