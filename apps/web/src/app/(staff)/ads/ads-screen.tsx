'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import type { CampaignResult } from '@/lib/ads-attribution'
import { formatKurus } from '@/lib/payroll-labels'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import { adsReportAction, type AdsScreen as Data } from '@/server/actions/ads'

import { AdCampaignsPanel } from './ad-campaigns-panel'

// IG-4a — onaylı tasarım: https://claude.ai/artifact/Wmkm8GjLKoyhqV5LGX6Fmr
// Mobile: campaign cards. From md up: one table that scrolls inside its own box if it must.

const DAYS = [7, 30, 90] as const
const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Yayında', cls: 'bg-success/15 text-success' },
  PAUSED: { label: 'Durduruldu', cls: 'bg-muted text-muted-foreground' },
  CAMPAIGN_PAUSED: { label: 'Durduruldu', cls: 'bg-muted text-muted-foreground' },
  ARCHIVED: { label: 'Arşiv', cls: 'bg-muted text-muted-foreground' },
  DELETED: { label: 'Silindi', cls: 'bg-muted text-muted-foreground' },
}
const status = (s: string) => STATUS[s] ?? { label: s === 'UNKNOWN' ? '—' : 'Bitti', cls: 'bg-muted text-muted-foreground' }
const lira = (k: number) => formatKurus(k)
const ratio = (r: number | null) => (r == null ? '—' : `${r.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ₺`)
// "Üye başı" is good or bad only against what a member is worth — a cheap member is green, a costly one amber.
// Threshold: a member who costs more than a third of what she paid is amber. A reading aid, not a verdict.
const cpmClass = (c: CampaignResult) =>
  c.costPerMemberKurus == null ? '' : c.revenueKurus > 0 && c.costPerMemberKurus * c.members * 3 <= c.revenueKurus ? 'text-success' : 'text-warning'

export function AdsScreen() {
  const [days, setDays] = useState<(typeof DAYS)[number]>(30)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (d: (typeof DAYS)[number]) => {
    setLoading(true)
    try {
      setData(await adsReportAction({ days: d }))
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Reklam raporu yüklenemedi.')
    }
    setLoading(false)
  }, [])
  useEffect(() => void load(days), [load, days])

  const t = data?.report.totals
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Reklamlar" description="AI kampanyayı hazırlar, sen onaylarsın; aşağıda harcanan paranın kaç üye getirdiği." />

      <AdCampaignsPanel />

      <h2 className="pt-2 text-lg font-bold">Ölçüm</h2>

      <div className="flex flex-wrap items-center gap-2">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={`min-h-9 rounded-full px-3.5 text-sm font-medium ${days === d ? 'bg-foreground text-background' : 'border border-border bg-card'}`}
          >
            {d} gün
          </button>
        ))}
        {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
        {data?.syncedAt ? (
          <span className="ml-auto text-xs text-muted-foreground">
            Meta verisi: {new Date(data.syncedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        ) : null}
      </div>

      {!data ? null : !data.configured ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Reklam verisi henüz çekilmedi. Gece 03:30'daki ilk çekimden sonra burada görünecek.
        </p>
      ) : (
        <>
          <p className="rounded-xl border border-border bg-card p-4 text-[15px]">
            {t && t.spendKurus > 0 ? (
              <>
                Son {data.days} günde <b>{lira(t.spendKurus)}</b> harcandı, <b>{t.members} üye</b> geldi
                {t.costPerMemberKurus != null ? (
                  <>
                    {' '}
                    — üye başı <b>{lira(t.costPerMemberKurus)}</b>
                  </>
                ) : null}
                . Harcanan her 1 ₺ <b>{ratio(t.revenuePerLira)}</b> gelir getirdi.
              </>
            ) : (
              <>Son {data.days} günde reklam harcaması yok.</>
            )}
          </p>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              ['Harcama', t ? lira(t.spendKurus) : '—', false],
              ['Mesaj başlatan', String(t?.messages ?? 0), false],
              ['Lead (telefonlu)', String(t?.leads ?? 0), false],
              ['Üye oldu', String(t?.members ?? 0), true],
              ['Gelir (bu üyelerden)', t ? lira(t.revenueKurus) : '—', false],
            ].map(([label, value, strong]) => (
              <div key={String(label)} className={`rounded-xl bg-card p-3 ${strong ? 'border-[1.5px] border-primary' : 'border border-border'}`}>
                <p className={`text-xs ${strong ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          {data.report.campaigns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Bu dönemde kampanya yok.</p>
          ) : (
            <>
              <ul className="space-y-2 md:hidden">
                {data.report.campaigns.map((c) => (
                  <li key={c.id} className="space-y-2 rounded-xl border border-border bg-card p-3.5">
                    <p className="flex justify-between gap-2">
                      <span className="font-semibold">{c.name}</span>
                      <span className={`self-center rounded px-1.5 text-[11px] font-semibold ${status(c.status).cls}`}>{status(c.status).label}</span>
                    </p>
                    <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground">
                      <span>Harcama<b className="block text-sm text-foreground">{lira(c.spendKurus)}</b></span>
                      <span>Mesaj<b className="block text-sm text-foreground">{c.messages}</b></span>
                      <span>Üye<b className="block text-sm text-foreground">{c.members}</b></span>
                      <span>Üye başı<b className={`block text-sm ${cpmClass(c)}`}>{c.costPerMemberKurus == null ? '—' : lira(c.costPerMemberKurus)}</b></span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Kampanya</th>
                      <th className="px-3 py-3 font-semibold">Durum</th>
                      <th className="px-3 py-3 text-right font-semibold">Harcama</th>
                      <th className="px-3 py-3 text-right font-semibold">Mesaj</th>
                      <th className="px-3 py-3 text-right font-semibold">Lead</th>
                      <th className="px-3 py-3 text-right font-semibold">Üye</th>
                      <th className="px-3 py-3 text-right font-semibold">Gelir</th>
                      <th className="px-3 py-3 text-right font-semibold">Üye başı</th>
                      <th className="px-4 py-3 text-right font-semibold">1 ₺ →</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.campaigns.map((c) => (
                      <tr key={c.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-semibold">{c.name}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded px-1.5 text-[11px] font-semibold ${status(c.status).cls}`}>{status(c.status).label}</span>
                        </td>
                        <td className="px-3 py-3 text-right">{lira(c.spendKurus)}</td>
                        <td className="px-3 py-3 text-right">{c.messages}</td>
                        <td className="px-3 py-3 text-right">{c.leads}</td>
                        <td className="px-3 py-3 text-right">{c.members}</td>
                        <td className="px-3 py-3 text-right">{lira(c.revenueKurus)}</td>
                        <td className={`px-3 py-3 text-right font-semibold ${cpmClass(c)}`}>{c.costPerMemberKurus == null ? '—' : lira(c.costPerMemberKurus)}</td>
                        <td className="px-4 py-3 text-right">{ratio(c.revenuePerLira)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Üye: reklamdan yazan kişinin telefonu, yazdıktan sonraki 90 gün içinde kayıt olan bir üyeyle eşleşti. Gelir: o üyelerin aynı 90 gündeki ödemeleri (nakit esas).
            Meta rakamları her gece 03:30'da tazelenir. Mesaj: bizim kaydettiğimiz, reklamdan açılan sohbetler.
          </p>
        </>
      )}
    </main>
  )
}
