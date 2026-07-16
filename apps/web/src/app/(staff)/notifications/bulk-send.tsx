'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckIcon, Loader2Icon, SearchIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import {
  sendBulkNotificationAction,
  type TemplateRow,
} from '@/server/actions/notifications'
import { listBookingMembersAction, type BookingMember } from '@/server/actions/booking'

// The params a bulk send can fill for EVERY member. A template that needs anything else (a balance, a
// class time) can't be sent this way — it would be refused per member with `template_params_missing`.
const BULK_PARAMS = new Set(['memberName'])

// Failure codes → a human reason, so "1 başarısız" says WHY.
const REASON_TR: Record<string, string> = {
  template_params_missing: 'şablon üyeye özel bilgi istiyor (toplu gönderimde doldurulamaz)',
  daily_limit_reached: 'günlük gönderim limiti doldu',
  template_not_found: 'şablon bulunamadı',
  template_inactive: 'şablon pasif',
  member_not_found: 'üye bulunamadı',
}
const reasonText = (reasons: Record<string, number>): string =>
  Object.entries(reasons)
    .map(([code, n]) => `${n} ${REASON_TR[code] ?? code}`)
    .join(', ')

// A SIMPLE bulk send (owner, §13): pick a template, pick the members, send. Every message goes
// through the same notify() pipeline — consent, quiet hours, retry, audit. It is deliberately NOT a
// campaign engine: no segments, no scheduling, no A/B — those stay in the future backlog. A member
// set is the members you select; "paket sahipleri / süresi bitecekler" are deferred (noted below).
export function BulkSend({ templates }: { templates: readonly TemplateRow[] }) {
  const [templateId, setTemplateId] = useState('')
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setMembers(await listBookingMembersAction())
      } catch {
        setMembers([])
        toast.error('Üye listesi yüklenemedi.')
      }
    })()
  }, [])

  const filtered = useMemo(() => {
    if (!members) return []
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return members.slice(0, 40)
    return members
      .filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q) || (digits.length > 0 && m.phone.includes(digits)))
      .slice(0, 40)
  }, [members, query])

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A template the bulk flow can't fill for everyone → the send would fail per member. Warn and block.
  const selectedTemplate = templates.find((t) => t.id === templateId)
  const unfillable = (selectedTemplate?.requiredParams ?? []).filter((p) => !BULK_PARAMS.has(p))
  const blocked = unfillable.length > 0

  async function send() {
    if (!templateId || selected.size === 0) return
    setBusy(true)
    try {
      const res = await sendBulkNotificationAction({ memberIds: [...selected], templateId })
      if (res.ok) {
        const { sent, failed, reasons } = res.value
        if (failed > 0) {
          const why = reasonText(reasons)
          toast.error(`${sent} gönderildi, ${failed} başarısız${why ? ` — ${why}` : ''}.`)
        } else {
          toast.success(`${sent} gönderildi.`)
          setSelected(new Set())
        }
      } else {
        toast.error('Gönderim tamamlanamadı.')
      }
    } catch {
      toast.error('Gönderim tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Section
      title="Toplu Gönderim"
      hint="Bir şablon seçin, üyeleri seçin, gönderin. Her mesaj üyenin tercih ve rızasına göre iletilir."
    >
      <div className="space-y-4">
        <label className="flex flex-col gap-1 text-sm">
          Şablon
          <select
            className="h-10 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Şablon seçin…</option>
            {templates
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>

        {blocked ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-sm">
            <p className="font-medium">Bu şablon toplu gönderime uygun değil</p>
            <p className="text-muted-foreground">
              Üyeye özel bilgi gerektiriyor ({unfillable.join(', ')}) — toplu gönderimde bu alanlar doldurulamaz.
              Bu şablonu üye kartından <strong>tek tek</strong> gönderin.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Üyeler</p>
            <span className="text-xs text-muted-foreground">{selected.size} seçili</span>
          </div>
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Üye ara (isim veya telefon)…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {members === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
              {filtered.map((m) => {
                const on = selected.has(m.id)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-primary-soft/30"
                    >
                      <span className="truncate">
                        <span className="font-medium text-foreground">{m.fullName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{m.phone}</span>
                      </span>
                      {on ? (
                        <CheckIcon className="size-4 shrink-0 text-primary" />
                      ) : (
                        <span className="size-4 shrink-0 rounded border border-border" />
                      )}
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">Eşleşen üye yok.</li> : null}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Gelişmiş segmentasyon (paket sahipleri, süresi bitecekler) şimdilik kapsam dışı.
          </p>
          <Button disabled={busy || !templateId || selected.size === 0 || blocked} onClick={() => void send()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {selected.size > 0 ? `${selected.size} kişiye gönder` : 'Gönder'}
          </Button>
        </div>

        {templateId ? (
          <p className="text-xs text-muted-foreground">
            Seçili şablon:{' '}
            <Badge className="bg-muted text-muted-foreground">
              {templates.find((t) => t.id === templateId)?.name}
            </Badge>
          </p>
        ) : null}
      </div>
    </Section>
  )
}
