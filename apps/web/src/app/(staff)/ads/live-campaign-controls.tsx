'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import { formatKurus } from '@/lib/payroll-labels'
import { changeAdCampaignAction, dismissAdChangeAction, type AdResult, type CampaignsScreen } from '@/server/actions/ad-campaigns'

// IG-5b — onaylı tasarım: https://claude.ai/artifact/RvmSRrJ2T99QBBkhV382Kn
// A campaign on Meta: spend so far, the AI's pending request, and the owner's four changes. Her press
// is the approval, after ONE confirm that states what happens (and, for money, the new maximum).
// The cap arithmetic shown here is a preview only — the domain decides, and refuses over the cap.

type Campaign = CampaignsScreen['campaigns'][number]
type Run = <T>(key: string, f: () => Promise<AdResult<T>>, ok: (v: T) => string | null) => Promise<void>
type Mode = null | 'pause' | 'resume' | 'budget' | 'end_date' | 'approve'

const KIND: Record<string, string> = { pause: 'durdur', resume: 'devam ettir', budget: 'bütçe', end_date: 'bitiş' }
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1
const trDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
const trTime = (ms: number) => new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export function LiveCampaignControls({ c, caps, busy, run }: { c: Campaign; caps: { daily: number; campaign: number }; busy: string | null; run: Run }) {
  const [mode, setMode] = useState<Mode>(null)
  const [dailyTl, setDailyTl] = useState(String(c.dailyBudget.amount / 100))
  const [endDate, setEndDate] = useState(c.endDate)
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
  const ended = c.endDate < today
  const pct = c.maxSpendKurus > 0 ? Math.min(100, Math.round((c.spentKurus / c.maxSpendKurus) * 100)) : 0
  const req = c.pendingChange ?? null

  const apply = (key: string, change: unknown, done: string) =>
    run(key, () => changeAdCampaignAction({ id: c.id, change }), (v) => {
      setMode(null)
      return v.status === 'applied' ? done : `Meta kabul etmedi: ${v.message ?? ''}`
    })

  // The preview of the money rule, for the sheet.
  const newDaily = Math.round(Number(dailyTl || 0) * 100)
  const budgetTotal = newDaily * days(c.startDate, c.endDate)
  const endTotal = (c.dailyBudget.amount as number) * Math.max(0, days(c.startDate, endDate))
  const overDaily = newDaily > caps.daily
  const overTotal = (mode === 'budget' ? budgetTotal : endTotal) > caps.campaign

  return (
    <div className="mt-auto space-y-2.5">
      <p className="text-sm">
        Harcanan <b className="tabular-nums">{formatKurus(c.spentKurus)}</b> / en fazla <b className="tabular-nums">{formatKurus(c.maxSpendKurus)}</b>
      </p>
      <div className="h-1.5 overflow-hidden rounded bg-border" aria-hidden="true">
        <i className="block h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {c.messages} WhatsApp mesajı · harcama her gece güncellenir{ended ? ' · bitiş tarihi geçti' : ''}
      </p>
      {c.status === 'paused' && c.pausedAt ? <p className="text-xs text-muted-foreground">Durduruldu · {trTime(c.pausedAt as number)}</p> : null}

      {c.lastChangeFailure ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs">
          <b>{KIND[c.lastChangeFailure.kind]} uygulanamadı.</b> Meta: “{c.lastChangeFailure.message}”. Kampanya eski hâliyle devam ediyor.
        </p>
      ) : null}
      {c.drift ? (
        <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs">
          <b>Meta'da elle değiştirilmiş.</b>{' '}
          {c.drift.dailyBudgetKurus != null ? `Reklam Yöneticisi'nde günlük bütçe ${formatKurus(c.drift.dailyBudgetKurus)}, onaylanan ${formatKurus(c.dailyBudget.amount)}. ` : ''}
          {c.drift.endDate ? `Bitiş ${trDate(c.drift.endDate)}, onaylanan ${trDate(c.endDate)}. ` : ''}
          {c.drift.status ? `Meta'da durum: ${c.drift.status === 'PAUSED' ? 'durdurulmuş' : 'açık'}. ` : ''}
          Gece kontrolünde bulundu.
        </p>
      ) : null}

      {req ? (
        <div className="space-y-2 rounded-lg bg-info/10 px-3 py-2.5">
          <p className="text-[11px] font-bold tracking-wide text-info uppercase">
            AI öneriyor · {KIND[req.kind]}
            {req.kind === 'budget' && req.dailyBudget ? ` → ${formatKurus(req.dailyBudget.amount)}/gün` : ''}
            {req.kind === 'end_date' && req.endDate ? ` → ${trDate(req.endDate)}` : ''}
          </p>
          <p className="text-[13px]">{req.rationale}</p>
          {mode === 'approve' ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void apply('approve-req', 'pending', 'Uygulandı.')} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {busy === 'approve-req' ? <Loader2Icon className="size-4 animate-spin" /> : null} Evet, uygula
              </button>
              <button type="button" onClick={() => setMode(null)} className="min-h-11 rounded-lg border border-border bg-card text-sm">
                Vazgeç
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('approve')} className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                Onayla · {KIND[req.kind]}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void run('dismiss', () => dismissAdChangeAction({ id: c.id }), () => 'Öneri reddedildi.')} className="min-h-11 rounded-lg border border-border bg-card text-sm disabled:opacity-50">
                Reddet
              </button>
            </div>
          )}
        </div>
      ) : null}

      {mode === 'pause' || mode === 'resume' ? (
        <div className="space-y-2 rounded-lg border-[1.5px] border-primary p-3">
          <p className="text-sm font-semibold">{mode === 'pause' ? 'Kampanya durdurulsun mu?' : 'Kampanya yeniden açılsın mı?'}</p>
          <p className="text-xs text-muted-foreground">
            {mode === 'pause'
              ? 'Harcama hemen kesilir. İstediğin zaman "Devam ettir" ile açabilirsin; bitiş tarihi değişmez.'
              : `Harcama yeniden başlar: ${formatKurus(c.dailyBudget.amount)}/gün, en geç ${trDate(c.endDate)}.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void apply(mode, { kind: mode }, mode === 'pause' ? 'Durduruldu.' : 'Yeniden yayında.')}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === mode ? <Loader2Icon className="size-4 animate-spin" /> : null} {mode === 'pause' ? 'Evet, durdur' : 'Evet, devam ettir'}
            </button>
            <button type="button" onClick={() => setMode(null)} className="min-h-11 rounded-lg border border-border text-sm">
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'budget' || mode === 'end_date' ? (
        <div className="space-y-2 rounded-lg border-[1.5px] border-primary p-3">
          {mode === 'budget' ? (
            <label className="block text-xs font-semibold">
              Yeni günlük tutar (TL)
              <input id={`ad-daily-${c.id}`} inputMode="numeric" value={dailyTl} onChange={(e) => setDailyTl(e.target.value.replace(/[^\d]/g, ''))} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm" />
            </label>
          ) : (
            <label className="block text-xs font-semibold">
              Yeni bitiş (önceki {trDate(c.endDate)})
              <input id={`ad-end-${c.id}`} type="date" min={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" />
            </label>
          )}
          <div className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {mode === 'budget'
              ? `${formatKurus(newDaily)} × ${days(c.startDate, c.endDate)} gün = ${formatKurus(budgetTotal)}`
              : `${formatKurus(c.dailyBudget.amount)} × ${Math.max(0, days(c.startDate, endDate))} gün = ${formatKurus(endTotal)}`}
            <br />
            {mode === 'budget' && overDaily ? (
              <span className="text-destructive">✗ günde en fazla {formatKurus(caps.daily)}</span>
            ) : overTotal ? (
              <span className="text-destructive">✗ kampanya başına en fazla {formatKurus(caps.campaign)}</span>
            ) : (
              <span className="text-success">✓ tavanın içinde</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null || (mode === 'budget' && overDaily) || overTotal}
              onClick={() =>
                void (mode === 'budget'
                  ? apply('budget', { kind: 'budget', dailyBudgetKurus: newDaily }, 'Bütçe değişti.')
                  : apply('end_date', { kind: 'end_date', endDate }, 'Bitiş tarihi değişti.'))
              }
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === mode ? <Loader2Icon className="size-4 animate-spin" /> : null} Onayla · en fazla {formatKurus(mode === 'budget' ? budgetTotal : endTotal)}
            </button>
            <button type="button" onClick={() => setMode(null)} className="min-h-11 rounded-lg border border-border text-sm">
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      {mode === null ? (
        <div className="grid grid-cols-3 gap-2">
          {c.status === 'live' ? (
            <button type="button" onClick={() => setMode('pause')} className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium text-destructive">
              Durdur
            </button>
          ) : (
            <button type="button" disabled={ended} onClick={() => setMode('resume')} className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium disabled:opacity-50">
              Devam ettir
            </button>
          )}
          <button type="button" onClick={() => setMode('budget')} className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium">
            Bütçe
          </button>
          <button type="button" onClick={() => setMode('end_date')} className="min-h-11 rounded-xl border border-border bg-card text-sm font-medium">
            Bitiş
          </button>
        </div>
      ) : null}
    </div>
  )
}
