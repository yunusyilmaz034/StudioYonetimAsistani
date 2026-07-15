'use client'

import { useState, useTransition } from 'react'
import { BellIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import type { InboxRow, NotificationPrefs } from '@studio/core'

import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Toaster } from '@/components/ui/sonner'
import { formatDateTime } from '@/lib/datetime'
import { markInboxReadAction, setPrefsAction } from '@/server/actions/notifications'

const CHANNELS: readonly { key: keyof NotificationPrefs; label: string; note?: string }[] = [
  { key: 'email', label: 'E-posta' },
  { key: 'sms', label: 'SMS', note: 'yakında' },
  { key: 'whatsapp', label: 'WhatsApp', note: 'yakında' },
  { key: 'push', label: 'Push bildirimi', note: 'yakında' },
]

export function MessagesScreen({
  inbox,
  prefs,
}: {
  inbox: readonly InboxRow[]
  prefs: NotificationPrefs
}) {
  const [rows, setRows] = useState<readonly InboxRow[]>(inbox)
  const [current, setCurrent] = useState<NotificationPrefs>(prefs)
  const [pending, start] = useTransition()

  const save = (next: NotificationPrefs) => {
    setCurrent(next)
    start(async () => {
      await setPrefsAction(next)
      toast.success('Tercihleriniz kaydedildi.')
    })
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <Toaster />
      <PageHeader title="Bildirimler" description="Hesabınızla ilgili tüm bilgilendirmeler" />

      <Section title="Gelen kutusu">
        {rows.length === 0 ? (
          <EmptyState icon={BellIcon} title="Bildirim yok" description="Henüz bir bildiriminiz yok." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {rows.map((m) => (
              <li key={m.intentId}>
                <button
                  type="button"
                  className={`w-full px-3 py-3 text-left transition-colors hover:bg-primary-soft/30 ${m.read ? '' : 'bg-primary-soft/20'}`}
                  onClick={() => {
                    if (m.read) return
                    setRows((prev) => prev.map((r) => (r.intentId === m.intentId ? { ...r, read: true } : r)))
                    void markInboxReadAction({ intentId: m.intentId })
                  }}
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {m.read ? null : <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    {m.subject}
                  </p>
                  <p className="text-sm text-muted-foreground">{m.body}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatDateTime(m.at)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Bildirim tercihleri">
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          {CHANNELS.map((c) => (
            <label key={c.key} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-foreground">
                {c.label}
                {c.note ? <span className="ml-1 text-xs text-muted-foreground">({c.note})</span> : null}
              </span>
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-primary)]"
                checked={current[c.key]}
                disabled={pending}
                onChange={(e) => save({ ...current, [c.key]: e.target.checked })}
              />
            </label>
          ))}
          {/* KVKK — marketing consent is SEPARATE from the operational channels above. An operational
              message (rezervasyon, iptal, hatırlatma) is always sent; only campaigns depend on this. */}
          <label className="flex items-center justify-between gap-3 border-t border-border py-2">
            <span className="text-sm text-foreground">
              Kampanya ve pazarlama mesajları
              <span className="block text-xs text-muted-foreground">
                Yalnızca kampanya/duyuru içindir. Rezervasyon ve iptal bilgilendirmeleri bundan bağımsızdır.
              </span>
            </span>
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-primary)]"
              checked={current.campaign}
              disabled={pending}
              onChange={(e) => save({ ...current, campaign: e.target.checked })}
            />
          </label>

          {/* She may say "not by SMS". She may not say "never tell me my class was cancelled". */}
          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            {pending ? (
              <span className="flex items-center gap-1">
                <Loader2Icon className="size-3 animate-spin" /> Kaydediliyor…
              </span>
            ) : (
              'Uygulama içi bildirimler kapatılamaz: bunlar hesabınızın kaydıdır. Ders iptali gibi zorunlu bilgilendirmeler her durumda burada görünür.'
            )}
          </p>
        </div>
      </Section>
    </main>
  )
}
