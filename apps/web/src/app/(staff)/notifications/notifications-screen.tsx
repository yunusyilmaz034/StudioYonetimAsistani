'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2Icon, RefreshCwIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Toaster } from '@/components/ui/sonner'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listNotificationsAction,
  resendNotificationAction,
  type NotificationRow,
} from '@/server/actions/notifications'
import { InboxIcon } from 'lucide-react'

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Bekliyor', className: 'bg-muted text-muted-foreground' },
  queued: { label: 'Kuyrukta', className: 'bg-info/10 text-info' },
  sent: { label: 'Gönderildi', className: 'bg-success/10 text-success' },
  delivered: { label: 'İletildi', className: 'bg-success/10 text-success' },
  failed: { label: 'Başarısız', className: 'bg-danger/10 text-danger' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
  suppressed: { label: 'Gönderilmedi', className: 'bg-warning/10 text-warning' },
}

const CHANNEL: Record<string, string> = {
  in_app: 'Uygulama içi',
  email: 'E-posta',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  push: 'Push',
}

const SUPPRESSION: Record<string, string> = {
  member_preference: 'üye tercihi',
  no_consent: 'rıza yok',
  daily_limit: 'günlük limit',
  missing_contact: 'iletişim bilgisi yok',
  duplicate: 'tekrar',
}

const ERROR_TR: Record<string, string> = {
  no_provider: 'Bu kanal henüz kurulmadı',
  missing_address: 'E-posta adresi yok',
  missing_phone: 'Telefon numarası yok',
  gateway_timeout: 'Sağlayıcı yanıt vermedi',
  invalid_number: 'Geçersiz numara',
  provider_threw: 'Sağlayıcı hatası',
}

// Two views make this a working screen rather than a log: what FAILED (a member who was never told
// her class was cancelled is a phone call reception must make today), and what we chose NOT to send.
type Tab = 'all' | 'failed' | 'suppressed'

export function NotificationsScreen({
  initial,
  isOwner,
}: {
  initial: readonly NotificationRow[]
  isOwner: boolean
}) {
  const [rows, setRows] = useState<readonly NotificationRow[]>(initial)
  const [tab, setTab] = useState<Tab>('all')
  const [pending, start] = useTransition()

  const reload = () => start(async () => setRows(await listNotificationsAction()))

  const failed = rows.filter((r) => r.status === 'failed')
  const suppressed = rows.filter((r) => r.status === 'suppressed' || r.suppression !== null)
  const shown = tab === 'failed' ? failed : tab === 'suppressed' ? suppressed : rows

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader
        title="Bildirim Merkezi"
        description="Kime, hangi kanaldan, ne zaman ulaştık — ve neyi bilerek göndermedik."
        actions={
          <Button variant="outline" onClick={reload} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            <span className="hidden sm:inline">Yenile</span>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {[
          { id: 'all' as Tab, label: `Tümü (${rows.length})` },
          { id: 'failed' as Tab, label: `İletilemeyen (${failed.length})` },
          { id: 'suppressed' as Tab, label: `Gönderilmeyen (${suppressed.length})` },
        ].map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? 'default' : 'outline'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Kayıt yok" description="Bu görünümde bildirim yok." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zaman</th>
                <th className="px-3 py-2 text-left font-medium">Mesaj</th>
                <th className="px-3 py-2 text-left font-medium">Kime</th>
                <th className="px-3 py-2 text-left font-medium">Kanal</th>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                <th className="px-3 py-2 text-left font-medium">Deneme</th>
                <th className="px-3 py-2 text-left font-medium">İşlem No</th>
                {isOwner ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.attemptId} className="transition-colors hover:bg-primary-soft/30">
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                    {r.at ? formatDateTime(r.at) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground">{r.templateName}</p>
                    {r.subject ? <p className="truncate text-xs text-muted-foreground">{r.subject}</p> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-foreground">{r.recipientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.recipientKind === 'member' ? 'üye' : 'personel'}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{CHANNEL[r.channel] ?? r.channel}</td>
                  <td className="px-3 py-2.5">
                    <Badge className={STATUS[r.status]?.className ?? ''}>
                      {STATUS[r.status]?.label ?? r.status}
                    </Badge>
                    {r.errorCode ? (
                      <p className="mt-0.5 text-xs text-danger">
                        {ERROR_TR[r.errorCode] ?? r.errorCode}
                        {r.permanent ? ' · kalıcı' : ' · geçici'}
                      </p>
                    ) : null}
                    {r.suppression ? (
                      <p className="mt-0.5 text-xs text-warning">{SUPPRESSION[r.suppression] ?? r.suppression}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{r.attemptNo}</td>
                  <td className="px-3 py-2.5">
                    {r.operationId ? (
                      <Link
                        href={`/operations/${r.operationId}`}
                        className="font-mono text-[0.6875rem] text-muted-foreground hover:text-primary"
                      >
                        {r.operationId.slice(-6)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  {isOwner ? (
                    <td className="px-3 py-2.5 text-right">
                      {r.status === 'failed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const res = await resendNotificationAction({ attemptId: r.attemptId })
                              if (res.ok) {
                                toast.success('Yeniden gönderildi.')
                                setRows(await listNotificationsAction())
                              } else {
                                toast.error(domainErrorMessage(res.error))
                              }
                            })
                          }
                        >
                          <SendIcon />
                          Tekrar
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
