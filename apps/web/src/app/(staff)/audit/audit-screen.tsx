'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2Icon, ShieldIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { fieldLabel, present } from '@/lib/activity/present'
import { formatDateTime } from '@/lib/datetime'
import { auditAction } from '@/server/actions/activity'
import type { ActivityEvent, ActivityPage } from '@/server/activity-query'

// Kim · ne yaptı · ne zaman · eski değer → yeni değer · İşlem No.
//
// I-30 — a screen never invents a fact the log does not have. An event written before 2026-07-13
// carries no before/after: the previous value was never recorded, and no engineering produces one.
// Those rows say so, in one quiet line. A log that guesses is worse than a log with gaps, because
// you cannot tell which rows are guesses.

interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'açık' : 'kapalı'
  if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} kayıt`
  return String(v)
}

// ── GRUPLAR (owner, 2026-09-01) ───────────────────────────────────────────────────────────
//
// *"Gün gün grupla, filtre olarak sayfa başına ekle."*
//
// Filtre kutuları olayları TEK TEK değil, KONUYA göre süzüyor. Otuz olay adı arasından "hangisi
// kredi düzeltmesiydi" diye seçim yapmak, aranan şeyin adını zaten bilmeyi gerektirir — oysa buraya
// bakan kişi tam da onu bilmediği için bakıyordur.
const KONULAR: readonly { readonly id: string; readonly label: string; readonly types: readonly string[] }[] = [
  {
    id: 'kredi',
    label: 'Kredi ve haklar',
    types: ['entitlement.adjusted', 'entitlement.entry_revoked', 'entitlement.entry_restored'],
  },
  {
    id: 'paket',
    label: 'Paket değişiklikleri',
    types: ['entitlement.amended', 'entitlement.extended', 'entitlement.cancelled', 'entitlement.reactivated'],
  },
  {
    id: 'dondurma',
    label: 'Dondurma',
    types: [
      'entitlement.frozen',
      'entitlement.unfrozen',
      'entitlement.freeze_scheduled',
      'entitlement.freeze_schedule_cancelled',
    ],
  },
  { id: 'bildirim', label: 'Gönderilen bildirimler', types: ['notification.intent_created', 'notification.suppressed'] },
  { id: 'ders', label: 'Ders ve rezervasyon', types: ['class_session.cancelled', 'class_session.capacity_changed', 'reservation.corrected'] },
  {
    id: 'toplu',
    label: 'Toplu işlemler ve kapanışlar',
    types: ['bulk_operation.planned', 'bulk_operation.applied', 'studio_closure.planned', 'studio_closure.applied', 'studio_closure.cancelled'],
  },
  {
    id: 'ayar',
    label: 'Ürün, hizmet ve ayarlar',
    types: ['product.created', 'product.updated', 'service.updated', 'service.deactivated', 'service.policy_published', 'studio.settings_updated'],
  },
  { id: 'uye', label: 'Üye kaydı', types: ['member.deactivated', 'member.profile_updated', 'member.churned', 'lead.lost'] },
]

const SAYFA = [25, 50, 100, 200] as const

/** Gün başlığı: "Bugün", "Dün", sonra tam tarih. Bir kaydın hangi güne ait olduğu, saatinden önce gelir. */
function gunBasligi(ms: number, now: number): string {
  const g = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
  if (g(ms) === g(now)) return 'Bugün'
  if (g(ms) === g(now - 86_400_000)) return 'Dün'
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
}

export function AuditScreen({ initial }: { initial: ActivityPage }) {
  const [entries, setEntries] = useState<readonly ActivityEvent[]>(initial.entries)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [konu, setKonu] = useState<string | null>(null)
  const [sayfa, setSayfa] = useState<number>(50)
  const [pending, start] = useTransition()

  const tipler = (id: string | null) => (id ? (KONULAR.find((k) => k.id === id)?.types ?? []) : undefined)

  const yenile = (yeniKonu: string | null, yeniSayfa: number) =>
    start(async () => {
      setKonu(yeniKonu)
      setSayfa(yeniSayfa)
      const page = await auditAction({ cursor: null, ...(tipler(yeniKonu) ? { types: tipler(yeniKonu) } : {}), pageSize: yeniSayfa })
      setEntries(page.entries)
      setCursor(page.nextCursor)
    })

  const more = () =>
    start(async () => {
      const page = await auditAction({ cursor, ...(tipler(konu) ? { types: tipler(konu) } : {}), pageSize: sayfa })
      setEntries((prev) => [...prev, ...page.entries])
      setCursor(page.nextCursor)
    })

  // Gün gün grupla. Sıra zaten yeniden eskiye; gruplama onu bozmadan başlık ekler.
  const now = Date.now()
  const gunler: { baslik: string; rows: ActivityEvent[] }[] = []
  for (const e of entries) {
    const b = gunBasligi(e.occurredAt, now)
    const son = gunler.at(-1)
    if (son && son.baslik === b) son.rows.push(e)
    else gunler.push({ baslik: b, rows: [e] })
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Elle Yapılan İşlemler"
        description="Sistemde kendiliğinden olmayan hareketler: kim, neyi, ne zaman, kime yaptı."
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => yenile(null, sayfa)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${konu === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          Tümü
        </button>
        {KONULAR.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => yenile(k.id, sayfa)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${konu === k.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            {k.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Sayfa başına
          <select
            value={sayfa}
            onChange={(e) => yenile(konu, Number(e.target.value))}
            className="min-h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            {SAYFA.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={ShieldIcon} title="Kayıt yok" description={konu ? 'Bu konuda kayıt bulunamadı — filtreyi değiştirin.' : 'Henüz denetlenecek bir değişiklik yapılmadı.'} />
      ) : (
        gunler.map((g) => (
        <section key={g.baslik} className="space-y-1.5">
          <h2 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
            {g.baslik} <span className="font-normal normal-case tracking-normal">· {g.rows.length} işlem</span>
          </h2>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {g.rows.map((e) => {
            const p = present(e)
            const changes = (e.payload.changes as FieldChange[] | undefined) ?? []
            return (
              <article key={e.eventId} className="space-y-1.5 px-3 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-muted-foreground">
                  <span>{formatDateTime(e.occurredAt)}</span>
                  <span className="font-medium text-foreground">{e.actorName}</span>
                  <Link
                    href={`/operations/${e.operationId}`}
                    className="ml-auto rounded px-1 font-mono text-[0.6875rem] transition-colors hover:bg-muted hover:text-primary"
                  >
                    {e.operationId.slice(-6)}
                  </Link>
                </p>
                <p className="text-sm font-medium text-foreground">{p.title}</p>
                {p.detail ? <p className="text-xs text-muted-foreground">{p.detail}</p> : null}

                {changes.length > 0 ? (
                  <ul className="space-y-0.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
                    {changes.map((c) => (
                      <li key={c.field} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{fieldLabel(c.field)}:</span>{' '}
                        <span className="line-through">{show(c.from)}</span> → <span className="text-foreground">{show(c.to)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground/70">
                    Bu kayıt için eski/yeni değer bilgisi tutulmamış.
                  </p>
                )}
              </article>
            )
          })}
        </div>
        </section>
        ))
      )}

      {cursor ? (
        <Button variant="outline" className="w-full" onClick={more} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          Daha eski kayıtlar
        </Button>
      ) : null}
    </main>
  )
}
