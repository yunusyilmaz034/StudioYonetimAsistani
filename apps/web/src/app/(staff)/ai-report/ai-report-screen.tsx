'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2Icon } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { aiReportAction, type AiReport } from '@/server/actions/ai-report'

const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: '2-digit' })
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)
const TEMP_LABEL: Record<string, string> = { sıcak: '🔴 Sıcak', ılık: '🟡 Ilık', soğuk: '⚪ Soğuk' }
const PERIODS: { days: number; label: string }[] = [
  { days: 7, label: 'Son 7 gün' },
  { days: 30, label: 'Son 30 gün' },
  { days: 0, label: 'Tümü' },
]

export function AiReportScreen() {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState<AiReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    aiReportAction({ days })
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false))
  }, [days])

  const f = report?.funnel
  const maxDaily = Math.max(1, ...(report?.daily ?? []).map((x) => x.count))

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="AI Rapor" description="WhatsApp AI resepsiyonistinin hunisi ve verimliliği — ne kadar gerçekçi, ne kadar dönüyor." />

      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)} className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${days === p.days ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading || !f ? (
        <div className="flex justify-center py-16"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Funnel */}
          <Section title="Huni" hint="WhatsApp'tan yazan kişiden kayıtlı üyeye.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FunnelCard label="Yazan" value={f.wrote} sub="toplam kişi" tone="default" />
              <FunnelCard label="Devam eden" value={f.engaged} sub={`%${pct(f.engaged, f.wrote)} · konuşmaya devam`} tone="accent" />
              <FunnelCard label="Sıcak" value={f.hot} sub={`%${pct(f.hot, f.wrote)} · müşteri potansiyeli`} tone="warn" />
              <FunnelCard label="Kayıt" value={f.converted} sub={`%${pct(f.converted, f.wrote)} · üye oldu`} tone="good" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Dönüşüm: yazan → sıcak <strong className="text-foreground">%{pct(f.hot, f.wrote)}</strong> · yazan → kayıt{' '}
              <strong className="text-foreground">%{pct(f.converted, f.wrote)}</strong>
              {f.hot > 0 ? <> · sıcaktan kayıt <strong className="text-foreground">%{pct(f.converted, f.hot)}</strong></> : null}
            </p>
          </Section>

          {/* Daily */}
          {report && report.daily.length > 0 ? (
            <Section title="Günlük — kaç kişi yazdı">
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 120 }}>
                {report.daily.map((x) => (
                  <div key={x.day} className="flex min-w-7 flex-1 flex-col items-center justify-end gap-1" title={`${x.day}: ${x.count} kişi`}>
                    <span className="text-[11px] font-medium tabular-nums text-foreground">{x.count}</span>
                    <div className="w-full rounded-t bg-primary" style={{ height: `${(x.count / maxDaily) * 80}px` }} />
                    <span className="text-[9px] text-muted-foreground">{x.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {/* People */}
          <Section title={`Yazan kişiler (${report?.people.length ?? 0})`} hint="Kaç kez yazmış, tarihler, skor. Tıkla → sohbeti aç.">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Kişi</th>
                    <th className="px-3 py-2">İlk</th>
                    <th className="px-3 py-2">Son</th>
                    <th className="px-3 py-2 text-right">Mesaj</th>
                    <th className="px-3 py-2 text-right">Gün</th>
                    <th className="px-3 py-2">Skor</th>
                    <th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(report?.people ?? []).map((p) => (
                    <tr key={p.phone} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link href={`/conversations?phone=${encodeURIComponent(p.phone)}`} className="font-medium text-foreground hover:underline">
                          {p.name}
                        </Link>
                        {p.converted ? <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700">üye</span> : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{d(p.firstAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{d(p.lastAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.userMsgs}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.days}</td>
                      <td className="px-3 py-2">{p.temp ? TEMP_LABEL[p.temp] : '—'}</td>
                      <td className="px-3 py-2 text-xs">{p.status === 'human' ? '👤 İnsan' : '🤖 AI'}</td>
                    </tr>
                  ))}
                  {(report?.people.length ?? 0) === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Bu dönemde yazan yok.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </main>
  )
}

function FunnelCard({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: 'default' | 'accent' | 'warn' | 'good' }) {
  const ring =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/5' : tone === 'warn' ? 'border-rose-500/25 bg-rose-500/5' : tone === 'accent' ? 'border-primary/25 bg-primary/5' : 'border-border bg-card'
  return (
    <div className={`rounded-xl border p-4 ${ring}`}>
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
