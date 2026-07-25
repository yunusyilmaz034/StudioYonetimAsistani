'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2Icon, Loader2Icon, MessageCircleIcon, SendIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { openWhatsAppWhenReady } from '@/lib/whatsapp'
import {
  prepareInviteMessageAction,
  sendPortalInvitesAction,
  type InviteRow,
  type InviteSendResult,
  type InviteState,
} from '@/server/actions/portal-onboarding'

// One request per 25 members — matches the action's own cap. Progress is rendered between chunks,
// so the operator sees the rollout advance instead of staring at a spinner.
const CHUNK = 25

const STATE_LABEL: Record<InviteState, string> = {
  never: 'Davet edilmedi',
  pending: 'Davet gönderildi',
  expired: 'Süresi doldu',
  activated: 'Hesabını açtı',
}

const STATE_VARIANT: Record<InviteState, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  never: 'outline',
  pending: 'secondary',
  expired: 'destructive',
  activated: 'default',
}

// The rollout is run in waves, and the waves are chosen along two axes: how far along she is
// (never asked / asked and waiting) and what she bought (pilates first, then fitness, …). Both are
// filters rather than a single list, because "who is left" and "who do I message next" are
// different questions asked minutes apart.
type Filter = 'todo' | 'never' | 'package' | 'pilates' | 'fitness' | 'pt' | 'hibrit' | 'all'

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'todo', label: 'Davet edilecekler' },
  { id: 'never', label: 'Hiç davet edilmedi' },
  { id: 'package', label: 'Paketi olanlar' },
  { id: 'pilates', label: 'Pilates' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'hibrit', label: 'Hibrit' },
  { id: 'pt', label: 'PT' },
  { id: 'all', label: 'Tümü' },
]

export function InviteScreen({
  rows,
  todayInvited,
  todayActivated,
  yesterdayInvited,
  yesterdayActivated,
}: {
  rows: readonly InviteRow[]
  todayInvited: number
  todayActivated: number
  yesterdayInvited: number
  yesterdayActivated: number
}) {
  const [filter, setFilter] = useState<Filter>('todo')
  const [reminding, setReminding] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)
  const [results, setResults] = useState<readonly InviteSendResult[]>([])

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return rows.filter((r) => {
      // Every filter except "Tümü" hides members who already have an account: this screen exists to
      // find who still needs one, and a done row is noise in every one of these lists.
      if (filter !== 'all' && r.state === 'activated') return false
      if (filter === 'never' && r.state !== 'never') return false
      if (filter === 'package' && !r.hasActivePackage) return false
      if ((filter === 'pilates' || filter === 'fitness' || filter === 'pt' || filter === 'hibrit') && !r.packageKinds.includes(filter))
        return false
      if (q && !r.fullName.toLocaleLowerCase('tr').includes(q) && !r.phone.includes(q)) return false
      return true
    })
  }, [rows, filter, query])

  const counts = useMemo(
    () => ({
      total: rows.length,
      activated: rows.filter((r) => r.state === 'activated').length,
      pending: rows.filter((r) => r.state === 'pending').length,
      never: rows.filter((r) => r.state === 'never').length,
    }),
    [rows],
  )

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.memberId))

  async function send() {
    const ids = visible.filter((r) => selected.has(r.memberId)).map((r) => r.memberId)
    if (ids.length === 0) return
    setBusy(true)
    setSent(0)
    setResults([])
    const collected: InviteSendResult[] = []
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const res = await sendPortalInvitesAction({ memberIds: chunk })
        collected.push(...res)
        setResults([...collected])
        setSent(collected.length)
      }
      const failed = collected.filter((r) => !r.ok).length
      if (failed === 0) toast.success(`${collected.length} üyeye davet gönderildi 🌸`)
      else toast.warning(`${collected.length - failed} gönderildi, ${failed} başarısız — listeye bak.`)
    } catch {
      toast.error('Gönderim sırasında bir hata oldu.')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = visible.filter((r) => selected.has(r.memberId)).length

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-28">
      <PageHeader
        title="Üyeleri portala davet et"
        description="Seçtiğin üyelere kişiye özel giriş bağlantısı gönderilir. Bağlantı 7 gün geçerlidir; üye şifresini kendi belirler."
        actions={
          <Button onClick={() => void send()} disabled={busy || selectedCount === 0} className="min-h-11">
            {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {busy ? `Gönderiliyor… ${sent}` : `Davet gönder (${selectedCount})`}
          </Button>
        }
      />

      {/* BUGÜN — the question you have while a rollout is running. A cumulative total can look healthy
          on a day where nothing moved; these two numbers cannot. */}
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Bugün gönderilen', value: todayInvited, of: null },
            { label: 'Bugün açılan hesap', value: todayActivated, of: todayInvited },
            { label: 'Dün gönderilen', value: yesterdayInvited, of: null },
            { label: 'Dün açılan hesap', value: yesterdayActivated, of: yesterdayInvited },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <p className="text-3xl font-semibold tabular-nums text-foreground">
                {s.value}
                {s.of != null && s.of > 0 ? (
                  <span className="ml-1.5 align-middle text-sm font-normal text-muted-foreground">%{Math.round((s.value / s.of) * 100)}</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
        {counts.pending > 0 ? (
          <p className="mt-3 border-t border-primary/20 pt-3 text-xs text-muted-foreground">
            <b className="text-foreground">{counts.pending} kişi</b> davetini açmadı. Listeden <b className="text-foreground">Hatırlat</b> ile güncel
            bağlantıyı yeniden gönderebilirsin.
          </p>
        ) : null}
      </div>

      {/* The rollout at a glance — the number that matters is "hesabını açtı", not "davet gönderildi". */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Aktif üye', value: counts.total },
          { label: 'Hesabını açtı', value: counts.activated },
          { label: 'Davet bekliyor', value: counts.pending },
          { label: 'Hiç davet edilmedi', value: counts.never },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            // The count is the point of the chip: "Fitness" is a word, "Fitness 6" is the next wave.
            const n = rows.filter((r) => {
              if (f.id !== 'all' && r.state === 'activated') return false
              if (f.id === 'never' && r.state !== 'never') return false
              if (f.id === 'package' && !r.hasActivePackage) return false
              if ((f.id === 'pilates' || f.id === 'fitness' || f.id === 'pt' || f.id === 'hibrit') && !r.packageKinds.includes(f.id)) return false
              return true
            }).length
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f.id ? 'border-primary bg-primary-soft/50 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-60">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ad veya telefon ara" className="sm:max-w-xs" />
          <Button
            type="button"
            variant="outline"
            onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.memberId)))}
            disabled={visible.length === 0}
            className="sm:ml-auto"
          >
            {allVisibleSelected ? 'Seçimi kaldır' : `Görünen ${visible.length} kişiyi seç`}
          </Button>
        </div>
      </div>

      {/* One row per member. Mobile-first: the row is a tap target, the status is a badge, no table
          that has to scroll sideways on a phone. */}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Bu filtrede üye yok.</p>
        ) : (
          visible.map((r) => {
            const result = results.find((x) => x.memberId === r.memberId)
            const isSelected = selected.has(r.memberId)
            return (
              <label
                key={r.memberId}
                className={`flex cursor-pointer items-center gap-3 p-3 transition-colors ${isSelected ? 'bg-primary-soft/30' : 'hover:bg-muted/40'}`}
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={isSelected}
                  onChange={() => toggle(r.memberId)}
                  disabled={busy}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{r.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.phone}</span>
                </span>
                {r.hasActivePackage ? <Badge variant="outline">Paketi var</Badge> : null}
                {/* One tap → WhatsApp opens with a FRESH link and a reminder line. Only offered where
                    it makes sense: she was asked and did not open it. */}
                {(r.state === 'pending' || r.state === 'expired') && !result ? (
                  <button
                    type="button"
                    disabled={reminding === r.memberId || busy}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setReminding(r.memberId)
                      openWhatsAppWhenReady(
                        prepareInviteMessageAction({ memberId: r.memberId, reminder: true })
                          .then((res) => {
                            if (res.ok) return { phone: res.phone, text: res.text }
                            toast.error(res.reason)
                            return null
                          })
                          .catch(() => {
                            toast.error('Hatırlatma hazırlanamadı.')
                            return null
                          })
                          .finally(() => setReminding(null)),
                      )
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-success/50 hover:text-success disabled:opacity-50"
                  >
                    {reminding === r.memberId ? <Loader2Icon className="size-3.5 animate-spin" /> : <MessageCircleIcon className="size-3.5" />}
                    Hatırlat
                  </button>
                ) : null}
                {result ? (
                  result.ok ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2Icon className="size-4" /> Gönderildi
                    </span>
                  ) : (
                    <span title={result.reason ?? ''} className="flex items-center gap-1 text-xs font-medium text-danger">
                      <XCircleIcon className="size-4" /> Gitmedi
                    </span>
                  )
                ) : (
                  <Badge variant={STATE_VARIANT[r.state]}>{STATE_LABEL[r.state]}</Badge>
                )}
              </label>
            )
          })
        )}
      </div>

      {/* The failures, spelled out. A rollout where 8 of 40 silently did not send is worse than one
          that says so. */}
      {results.some((r) => !r.ok) ? (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">Gönderilemeyenler</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {results
              .filter((r) => !r.ok)
              .map((r) => (
                <li key={r.memberId}>
                  <b className="text-foreground">{r.fullName}</b> — {r.reason}
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Bu üyeleri tekrar seçip yeniden gönderebilirsin; her denemede yeni bir bağlantı üretilir.
          </p>
        </div>
      ) : null}
    </main>
  )
}
