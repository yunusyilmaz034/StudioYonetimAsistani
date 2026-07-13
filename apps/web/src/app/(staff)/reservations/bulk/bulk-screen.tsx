'use client'

import { AlertTriangleIcon, ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Toaster } from '@/components/ui/sonner'
import { domainErrorMessage } from '@/lib/domain-error'
import type { DomainError } from '@studio/core'
import { formatDateTime } from '@/lib/datetime'
import {
  applyBulkCancelAction,
  applyBulkMoveAction,
  applyBulkTrainerChangeAction,
  listTrainerSessionsAction,
  listTrainersAction,
  previewBulkCancelAction,
  previewBulkMoveAction,
  type TrainerSessionRow,
} from '@/server/actions/bulk-reservations'
import { listUpcomingSessionsAction } from '@/server/actions/booking'

// TOPLU İŞLEMLER (v1.27 S7) — reception's morning, in one screen.
//
// Everything here is PREVIEW → APPLY, and the preview is not a summary: it is a NAMED LIST. "8 kişi
// etkilenecek" is a number nobody can check. "Ayşe — kredisi iade edilir. Fatma — GEÇ İPTAL, kredisi
// yanar." is a decision she can make.
//
// The dangerous case is drawn in red on purpose: a cancellation inside the window BURNS the member's
// credit, and reception must meet that fact before she presses the button, not afterwards from the
// member on the phone.

// The refusal codes arrive as plain strings across the Server Action boundary; they are the domain's
// own codes, and this is the one place they are turned back into the sentence a human reads.
const refusalText = (code: string) => domainErrorMessage({ code } as DomainError)

interface Session {
  sessionId: string
  serviceName: string
  trainerName: string | null
  startsAt: number
  capacity: number
  bookedCount: number
}

const label = (s: Session) =>
  `${formatDateTime(s.startsAt).slice(0, 16)} · ${s.serviceName}` +
  (s.trainerName ? ` · ${s.trainerName}` : '') +
  ` (${s.bookedCount}/${s.capacity})`

export function BulkScreen() {
  const [tab, setTab] = useState<'reservations' | 'trainer'>('reservations')

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader
        title="Toplu İşlemler"
        description="Bir dersin tamamını iptal edin, başka bir derse taşıyın veya eğitmenini değiştirin."
        actions={
          <Button variant="outline" render={<Link href="/reservations" />}>
            <ArrowLeftIcon />
            <span className="hidden sm:inline">Rezervasyonlar</span>
          </Button>
        }
      />

      <div className="flex gap-2">
        {(
          [
            ['reservations', 'Rezervasyonlar'],
            ['trainer', 'Eğitmen değişikliği'],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
              tab === id
                ? 'border-primary bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'reservations' ? <RosterOps /> : <TrainerOps />}
    </main>
  )
}

// ── Rezervasyonlar: iptal · taşı ────────────────────────────────────────────────────────────

function RosterOps() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [mode, setMode] = useState<'cancel' | 'move'>('move')
  const [rows, setRows] = useState<
    { reservationId: string; memberName: string; effect?: string; refusal: string | null }[] | null
  >(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listUpcomingSessionsAction({ nowMs: Date.now() }).then((s) => setSessions(s as unknown as Session[]))
  }, [])

  const source = sessions.find((s) => s.sessionId === sourceId)

  const preview = async () => {
    if (!sourceId) return
    setBusy(true)
    setRows(null)
    try {
      if (mode === 'cancel') {
        setRows([...(await previewBulkCancelAction({ sessionId: sourceId, reservationIds: [] }))])
      } else {
        if (!targetId) return
        setRows([
          ...(await previewBulkMoveAction({
            sessionId: sourceId,
            targetSessionId: targetId,
            reservationIds: [],
            overrideReason: null,
          })),
        ])
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Önizleme alınamadı.')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!rows) return
    // Only the rows the plan said would go through. Sending a row the domain has already refused
    // would just collect the same refusal a second time.
    const ids = rows.filter((r) => r.refusal === null).map((r) => r.reservationId)
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res =
        mode === 'cancel'
          ? await applyBulkCancelAction({ sessionId: sourceId, reservationIds: ids })
          : await applyBulkMoveAction({
              sessionId: sourceId,
              targetSessionId: targetId,
              reservationIds: ids,
              overrideReason: null,
            })

      if (res.failed.length === 0) {
        toast.success(`${res.applied} rezervasyon işlendi.`)
      } else {
        // Each item was its own transaction; there is no rollback and there must not be one. What is
        // owed here is the TRUTH: which ones went through and which did not.
        toast.error(
          `${res.applied} işlendi, ${res.failed.length} işlenemedi: ` +
            res.failed.map((f) => `${f.memberName} (${refusalText(f.code)})`).join(', '),
        )
      }
      setRows(null)
      void listUpcomingSessionsAction({ nowMs: Date.now() }).then((s) => setSessions(s as unknown as Session[]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const willBurn = rows?.filter((r) => r.effect === 'consumed').length ?? 0
  const ok = rows?.filter((r) => r.refusal === null).length ?? 0

  return (
    <div className="space-y-5">
      <Section title="1. Ders" hint="Önümüzdeki 14 günün dersleri.">
        <select
          className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value)
            setRows(null)
          }}
        >
          <option value="">Ders seçin…</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {label(s)}
            </option>
          ))}
        </select>
        {source && source.bookedCount === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Bu derste rezervasyon yok.</p>
        ) : null}
      </Section>

      <Section title="2. İşlem">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['move', 'Başka derse taşı'],
              ['cancel', 'Rezervasyonları iptal et'],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id)
                setRows(null)
              }}
              className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
                mode === id
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        {mode === 'move' ? (
          <select
            className="mt-3 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value)
              setRows(null)
            }}
          >
            <option value="">Hedef ders seçin…</option>
            {sessions
              .filter((s) => s.sessionId !== sourceId)
              .map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {label(s)}
                </option>
              ))}
          </select>
        ) : (
          // The distinction that must never be blurred: this removes THESE MEMBERS from a class that
          // is still going ahead, so the ordinary cancellation policy applies. A class that is NOT
          // happening is cancelled as a class — and then every credit is released unconditionally.
          <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            Bu, üyeleri <strong>yapılacak olan</strong> bir dersten çıkarır; normal iptal kuralı
            işler. Ders <strong>yapılmayacaksa</strong> dersin kendisini iptal edin — o zaman
            herkesin kredisi koşulsuz iade edilir.
          </p>
        )}

        <Button
          className="mt-3 min-h-11"
          variant="outline"
          disabled={busy || !sourceId || (mode === 'move' && !targetId)}
          onClick={() => void preview()}
        >
          Kimler etkilenecek?
        </Button>
      </Section>

      {rows ? (
        <Section title="3. Önizleme" hint="Hiçbir şey yazılmadı. Aşağıdakiler olacak.">
          {willBurn > 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>{willBurn} üyenin kredisi yanacak.</strong> Ders çok yakın olduğu için bu bir
                geç iptal. Krediyi geri vermek isterseniz, iptalden sonra üyenin paketinden kredi
                iadesi yapmanız gerekir.
              </span>
            </div>
          ) : null}

          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {rows.map((r) => (
              <li key={r.reservationId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="font-medium">{r.memberName}</span>
                {r.refusal ? (
                  <span className="text-danger">{refusalText(r.refusal)}</span>
                ) : r.effect === 'consumed' ? (
                  <span className="font-medium text-danger">GEÇ İPTAL — kredisi yanar</span>
                ) : r.effect === 'released' ? (
                  <span className="text-success">Kredisi iade edilir</span>
                ) : (
                  <span className="text-muted-foreground">Taşınır</span>
                )}
              </li>
            ))}
          </ul>

          <Button
            className="mt-3 min-h-12"
            variant={willBurn > 0 || mode === 'cancel' ? 'destructive' : 'default'}
            disabled={busy || ok === 0}
            onClick={() => void apply()}
          >
            {ok} rezervasyonu {mode === 'cancel' ? 'iptal et' : 'taşı'}
          </Button>
        </Section>
      ) : null}
    </div>
  )
}

// ── Eğitmen değişikliği ─────────────────────────────────────────────────────────────────────

const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function TrainerOps() {
  const [trainers, setTrainers] = useState<{ id: string; name: string }[]>([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [from, setFrom] = useState(isoDay(Date.now()))
  const [to, setTo] = useState(isoDay(Date.now() + 7 * DAY))
  const [reason, setReason] = useState('')
  const [sessions, setSessions] = useState<TrainerSessionRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listTrainersAction().then((t) => setTrainers([...t]))
  }, [])

  const range = useMemo(
    () => ({
      fromMs: Date.parse(`${from}T00:00:00+03:00`),
      toMs: Date.parse(`${to}T23:59:59+03:00`),
    }),
    [from, to],
  )

  const look = async () => {
    if (!fromId) return
    setBusy(true)
    try {
      setSessions([...(await listTrainerSessionsAction({ trainerId: fromId, ...range }))])
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!sessions || sessions.length === 0 || !reason.trim()) return
    setBusy(true)
    try {
      const res = await applyBulkTrainerChangeAction({
        sessionIds: sessions.map((s) => s.sessionId),
        trainerId: toId || null,
        reason: reason.trim(),
      })
      if (res.failed.length === 0) toast.success(`${res.applied} dersin eğitmeni değişti.`)
      else toast.error(`${res.applied} ders değişti, ${res.failed.length} ders değişmedi.`)
      setSessions(null)
      setReason('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Section title="1. Hangi eğitmenin dersleri?">
        <select
          className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
          value={fromId}
          onChange={(e) => {
            setFromId(e.target.value)
            setSessions(null)
          }}
        >
          <option value="">Eğitmen seçin…</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-sm text-muted-foreground">—</span>
          <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button variant="outline" disabled={busy || !fromId} onClick={() => void look()}>
            Dersleri getir
          </Button>
        </div>
      </Section>

      {sessions ? (
        <Section title="2. Bu dersler devredilecek">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu aralıkta dersi yok.</p>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {sessions.map((s) => (
                  <li key={s.sessionId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span>{formatDateTime(s.startsAt).slice(0, 16)} · {s.serviceName}</span>
                    <span className="text-xs text-muted-foreground">{s.bookedCount} rezervasyon</span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 space-y-2">
                <select
                  className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                >
                  <option value="">Eğitmeni kaldır (atanmamış)</option>
                  {trainers
                    .filter((t) => t.id !== fromId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>

                {/* Never optional. In three weeks somebody will ask why Zeynep taught Tuesday, and
                    the answer belongs in the log, not in somebody's memory. */}
                <Input
                  placeholder="Sebep (zorunlu) — ör. Ayşe hastalandı"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />

                <Button
                  className="min-h-12"
                  disabled={busy || !reason.trim()}
                  onClick={() => void apply()}
                >
                  {sessions.length} dersin eğitmenini değiştir
                </Button>
              </div>
            </>
          )}
        </Section>
      ) : null}
    </div>
  )
}
