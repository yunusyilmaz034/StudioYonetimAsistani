'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { loadInvoiceSettingsAction, parasutConnectAction, saveInvoiceSettingsAction, type InvoiceSettings } from '@/server/actions/invoices'

// FT-2 · Belge ayarları (owner, OR-132). Which document each payment method gets, and the three values
// the accountant gives (service line, VAT rate, receipt limit). No setting here ever cuts an invoice
// by itself — every e-Arşiv is still a person's press.

const METHODS = [
  { id: 'credit_card', label: 'Kredi kartı' },
  { id: 'pos', label: 'POS' },
  { id: 'cash', label: 'Nakit' },
  { id: 'bank_transfer', label: 'Havale / EFT' },
  { id: 'online', label: 'Online (PayTR)' },
  { id: 'gift_card', label: 'Hediye kartı' },
  { id: 'wallet', label: 'Cüzdan' },
] as const
const RULES = [
  { id: 'okc_auto', label: 'ÖKC — cihaz otomatik' },
  { id: 'okc_manual', label: 'ÖKC — elle tik' },
  { id: 'e_archive', label: 'e-Arşiv' },
] as const

export function InvoiceSettingsPanel({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [s, setS] = useState<InvoiceSettings | null>(null)
  const [by, setBy] = useState<Record<string, string>>({})
  const [line, setLine] = useState('')
  const [vat, setVat] = useState('')
  const [limit, setLimit] = useState('')
  const [url, setUrl] = useState('')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadInvoiceSettingsAction().then((x) => {
      setS(x)
      if (!x) return
      setBy({ ...x.policy.documentByMethod })
      setLine(x.policy.serviceLine)
      setVat(x.policy.vatRatePercent === null ? '' : String(x.policy.vatRatePercent))
      setLimit(x.policy.receiptLimitKurus === null ? '' : String(x.policy.receiptLimitKurus / 100))
      setUrl(x.policy.internetSaleUrl ?? '')
      setCompany(x.policy.parasut.companyId ?? '')
    })
  }, [])

  async function save() {
    const vatN = vat.trim() === '' ? null : Number(vat)
    const limitN = limit.trim() === '' ? null : Math.round(Number(limit.replace(/\./g, '').replace(',', '.')) * 100)
    if (vatN !== null && (!Number.isInteger(vatN) || vatN < 0 || vatN > 100)) return void toast.error('KDV oranı 0–100 arası tam sayı olmalı.')
    if (limitN !== null && (!Number.isFinite(limitN) || limitN <= 0)) return void toast.error('Fiş sınırını lira olarak girin.')
    setBusy(true)
    try {
      const r = await saveInvoiceSettingsAction({
        documentByMethod: by,
        serviceLine: line,
        vatRatePercent: vatN,
        receiptLimitKurus: limitN,
        internetSaleUrl: url.trim() || null,
        companyId: company.trim() || null,
      })
      if (!r.ok) toast.error(domainErrorMessage(r.error))
      else {
        toast.success('Belge ayarları kaydedildi.')
        onSaved()
      }
    } catch {
      toast.error('Kaydedilemedi. Değerleri kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    const link = await parasutConnectAction()
    if (!link) return void toast.error('Bağlantı başlatılamadı.')
    window.location.href = link
  }

  if (s === null) return <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Yükleniyor…</div>

  const field = 'min-h-10 rounded-lg border border-border bg-background px-3 text-sm'
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm" aria-label="Belge ayarları">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Belge ayarları</h2>
          <p className="text-xs text-muted-foreground">Hiçbir ayar faturayı kendiliğinden kestirmez — her e-Arşiv bir kişinin onayıyla çıkar.</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Kapat
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Ödeme yöntemine göre belge</h3>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {METHODS.map((m) => (
            <label key={m.id} className="flex items-center justify-between gap-3 text-sm">
              {m.label}
              <select value={by[m.id] ?? 'okc_manual'} onChange={(e) => setBy((b) => ({ ...b, [m.id]: e.target.value }))} className={field}>
                {RULES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">ÖKC yöntemlerinde de satırda “e-Arşiv kes” düğmesi durur (müşteri isterse ya da fiş sınırı aşılırsa).</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <h3 className="text-sm font-semibold sm:col-span-3">Fatura içeriği (mali müşavirin söylediği)</h3>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Hizmet satırı ({'{paket}'} = paket adı)
          <Input value={line} onChange={(e) => setLine(e.target.value)} maxLength={160} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          KDV oranı (%) — boşken e-Arşiv kapalı
          <Input value={vat} inputMode="numeric" onChange={(e) => setVat(e.target.value)} placeholder="müşavire sorun" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Fiş sınırı (₺) — üstünde uyarı
          <Input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} placeholder="müşavire sorun" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-3">
          Online satış adresi (PayTR e-Arşiv’inde yazar)
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border p-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Paraşüt bağlantısı</h3>
          <p className="text-xs text-muted-foreground">
            {s.connected ? 'Bağlı' : 'Bağlı değil'} ·{' '}
            <strong className={s.policy.parasut.environment === 'staging' ? 'text-warning' : ''}>
              {s.policy.parasut.environment === 'staging' ? 'TEST ortamı' : 'Gerçek ortam'}
            </strong>
            {s.connectedAt ? ` · bağlandı ${new Date(s.connectedAt).toLocaleDateString('tr-TR')}` : ''}. Paraşüt şifrenizi Paraşüt’ün kendi sayfasında
            girersiniz; panel görmez.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Paraşüt firma no
            <Input value={company} inputMode="numeric" onChange={(e) => setCompany(e.target.value)} className="h-9 w-32" />
          </label>
        </div>
        <Button variant="outline" onClick={() => void connect()}>
          {s.connected ? 'Yeniden bağlan' : 'Paraşüt’e bağlan'}
        </Button>
      </div>

      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </section>
  )
}
