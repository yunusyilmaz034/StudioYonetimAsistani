'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DomainError } from '@studio/core'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { domainErrorMessage } from '@/lib/domain-error'
import { formatKurus } from '@/lib/payroll-labels'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import {
  adCampaignsAction,
  approveAndPublishAdCampaignAction,
  editAdCampaignAction,
  proposeAdCampaignAction,
  removeAdCampaignAction,
  type AdResult,
  type CampaignsScreen,
} from '@/server/actions/ad-campaigns'

import { LiveCampaignControls } from './live-campaign-controls'

// IG-5a — onaylı tasarım: https://claude.ai/artifact/TVanv618TgE9PvF6NsE8xY
// The total a campaign may spend is the first thing on every card and on the approve button itself:
// the owner approves an amount, not a form.

type Campaign = CampaignsScreen['campaigns'][number]
interface Draft {
  id: string
  name: string
  dailyTl: string
  startDate: string
  endDate: string
  radiusKm: number
  ageMin: number
  ageMax: number
  igMediaId: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Onay bekliyor', cls: 'bg-warning/15 text-warning' },
  approved: { label: 'Onaylandı', cls: 'bg-info/15 text-info' },
  publishing: { label: 'Yayınlanıyor…', cls: 'bg-info/15 text-info' },
  live: { label: 'Yayında', cls: 'bg-success/15 text-success' },
  paused: { label: 'Durduruldu', cls: 'bg-warning/15 text-warning' },
  failed: { label: 'Yayınlanamadı', cls: 'bg-destructive/15 text-destructive' },
}

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1
const trDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })

function explain(r: AdResult<unknown>): string {
  if (r.ok) return ''
  const e = r.error
  if (e.code === 'ai_unavailable') return 'AI şu an öneri hazırlayamadı. Biraz sonra tekrar deneyin.'
  if (e.code === 'ads_not_configured') return 'Reklam hesabı ayarları eksik (hesap, sayfa ya da tavan).'
  return domainErrorMessage(e as DomainError)
}

export function AdCampaignsPanel() {
  const [data, setData] = useState<CampaignsScreen | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await adCampaignsAction())
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Kampanyalar yüklenemedi.')
    }
  }, [])
  useEffect(() => void load(), [load])

  async function run<T>(key: string, f: () => Promise<AdResult<T>>, ok: (v: T) => string | null) {
    setBusy(key)
    try {
      const r = await f()
      if (!r.ok) toast.error(explain(r))
      else {
        const m = ok(r.value)
        if (m) toast.success(m)
      }
      await load()
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'İşlem tamamlanamadı.')
    }
    setBusy(null)
    setConfirm(null)
  }

  if (!data) return null
  const post = (id: string) => data.posts.find((p) => p.id === id)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Kampanyalar</h2>
          <p className="text-sm text-muted-foreground">
            AI hazırlar, sen onaylarsın. Onaysız hiçbir şey Meta'ya gitmez. Tavan: günde {formatKurus(data.dailyCapKurus)} · kampanya başına {formatKurus(data.campaignCapKurus)}.
          </p>
        </div>
        <button
          type="button"
          disabled={!data.configured || busy !== null}
          onClick={() => void run('propose', () => proposeAdCampaignAction(), () => 'Taslak hazır — gözden geçirip onaylayın.')}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === 'propose' ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
          Kampanya öner
        </button>
      </div>

      {data.campaigns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Henüz kampanya yok. “Kampanya öner”e basın; taslak burada onay bekler.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.campaigns.map((c: Campaign) => {
            const st = STATUS[c.status] ?? { label: c.status, cls: 'bg-muted text-muted-foreground' }
            const p = post(c.creative.igMediaId)
            const editing = draft?.id === c.id
            return (
              <article key={c.id} className={`flex flex-col gap-2.5 rounded-xl bg-card p-4 ${c.status === 'draft' || c.pendingChange ? 'border-[1.5px] border-primary' : 'border border-border'}`}>
                <span className={`self-start rounded px-1.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                <h3 className="text-[17px] font-bold">{c.name}</h3>
                <p className="text-sm">
                  En fazla <b>{formatKurus(c.maxSpendKurus)}</b> · {formatKurus(c.dailyBudget.amount)}/gün × {days(c.startDate, c.endDate)} gün
                </p>
                <p className="text-xs text-muted-foreground">
                  {trDate(c.startDate)} – {trDate(c.endDate)} · bitince kendiliğinden durur
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.targeting.label} + {c.targeting.radiusKm} km · kadın {c.targeting.ageMin}–{c.targeting.ageMax} · WhatsApp'a mesaj
                </p>
                <div className="flex gap-2.5">
                  {p?.thumbnail ? <img src={p.thumbnail} alt="Reklam görseli olacak Instagram gönderisi" className="h-24 w-20 shrink-0 rounded-lg object-cover" /> : <span className="grid h-24 w-20 shrink-0 place-items-center rounded-lg bg-muted text-[11px] text-muted-foreground">Gönderi</span>}
                  <p className="line-clamp-5 text-xs text-foreground">{c.creative.primaryText}</p>
                </div>
                {c.rationale ? <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">AI: {c.rationale}</p> : null}
                {c.failure ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-foreground">Meta: “{c.failure.message}”. Hiçbir şey yayında değil; harcama yok.</p> : null}

                {editing && draft ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <label className="block text-xs font-medium">
                      Ad
                      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs font-medium">
                        Günlük TL
                        <input inputMode="numeric" value={draft.dailyTl} onChange={(e) => setDraft({ ...draft, dailyTl: e.target.value.replace(/[^\d]/g, '') })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
                      </label>
                      <label className="block text-xs font-medium">
                        Başlangıç
                        <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-1.5 text-sm" />
                      </label>
                      <label className="block text-xs font-medium">
                        Bitiş
                        <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-1.5 text-sm" />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs font-medium">
                        Yarıçap km
                        <input type="number" min={1} max={80} value={draft.radiusKm} onChange={(e) => setDraft({ ...draft, radiusKm: Number(e.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
                      </label>
                      <label className="block text-xs font-medium">
                        Yaş en az
                        <input type="number" min={18} max={65} value={draft.ageMin} onChange={(e) => setDraft({ ...draft, ageMin: Number(e.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
                      </label>
                      <label className="block text-xs font-medium">
                        Yaş en çok
                        <input type="number" min={18} max={65} value={draft.ageMax} onChange={(e) => setDraft({ ...draft, ageMax: Number(e.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
                      </label>
                    </div>
                    <fieldset>
                      <legend className="text-xs font-medium">Gönderi</legend>
                      <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
                        {data.posts.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            aria-pressed={draft.igMediaId === x.id}
                            aria-label={`Gönderi ${x.timestamp.slice(0, 10)}`}
                            onClick={() => setDraft({ ...draft, igMediaId: x.id })}
                            className={`h-20 w-16 shrink-0 overflow-hidden rounded-md ${draft.igMediaId === x.id ? 'ring-2 ring-primary' : 'ring-1 ring-border'}`}
                          >
                            {x.thumbnail ? <img src={x.thumbnail} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px]">{x.mediaType}</span>}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <p className="text-xs text-muted-foreground">
                      En fazla {formatKurus(Number(draft.dailyTl || 0) * 100 * Math.max(0, days(draft.startDate, draft.endDate)))} — tavanı aşarsa kaydedilmez.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            'edit',
                            () =>
                              editAdCampaignAction({
                                id: draft.id,
                                fields: { name: draft.name, dailyBudgetKurus: Number(draft.dailyTl || 0) * 100, startDate: draft.startDate, endDate: draft.endDate, radiusKm: draft.radiusKm, ageMin: draft.ageMin, ageMax: draft.ageMax, igMediaId: draft.igMediaId },
                              }),
                            () => {
                              setDraft(null)
                              return 'Kaydedildi.'
                            },
                          )
                        }
                        className="min-h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Kaydet
                      </button>
                      <button type="button" onClick={() => setDraft(null)} className="min-h-10 rounded-lg border border-border px-3 text-sm">
                        Vazgeç
                      </button>
                    </div>
                  </div>
                ) : null}

                {(c.status === 'draft' || c.status === 'failed') && !editing ? (
                  <div className="mt-auto space-y-2">
                    {c.status === 'draft' ? (
                      confirm === c.id ? (
                        <div className="space-y-2 rounded-lg border-[1.5px] border-primary p-3">
                          <p className="text-sm">
                            Bu kampanya <b>{trDate(c.startDate)}</b>'da başlar ve en fazla <b>{formatKurus(c.maxSpendKurus)}</b> harcar. Yayınlansın mı?
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() =>
                                void run('approve', () => approveAndPublishAdCampaignAction({ id: c.id }), (v) => (v.status === 'live' ? 'Yayında.' : `Yayınlanamadı: ${v.message ?? ''}`))
                              }
                              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                            >
                              {busy === 'approve' ? <Loader2Icon className="size-4 animate-spin" /> : null} Evet, yayınla
                            </button>
                            <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-lg border border-border px-3 text-sm">
                              Vazgeç
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirm(c.id)} className="min-h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground">
                          Onayla ve yayınla · en fazla {formatKurus(c.maxSpendKurus)}
                        </button>
                      )
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ id: c.id, name: c.name, dailyTl: String(c.dailyBudget.amount / 100), startDate: c.startDate, endDate: c.endDate, radiusKm: c.targeting.radiusKm, ageMin: c.targeting.ageMin, ageMax: c.targeting.ageMax, igMediaId: c.creative.igMediaId })
                        }
                        className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium"
                      >
                        {c.status === 'failed' ? 'Düzelt' : 'Düzenle'}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run('remove', () => removeAdCampaignAction({ id: c.id }), () => 'Taslak silindi.')}
                        className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground disabled:opacity-50"
                      >
                        Taslağı sil
                      </button>
                    </div>
                  </div>
                ) : null}
                {c.status === 'live' || c.status === 'paused' ? (
                  <LiveCampaignControls c={c} caps={{ daily: data.dailyCapKurus, campaign: data.campaignCapKurus }} busy={busy} run={run} />
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
