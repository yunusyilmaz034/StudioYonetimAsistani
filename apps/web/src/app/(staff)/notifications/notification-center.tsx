'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { InboxIcon, Loader2Icon, RefreshCwIcon, SearchIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listNotificationsAction,
  resendNotificationAction,
  type NotificationRow,
} from '@/server/actions/notifications'

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Bekliyor', className: 'bg-muted text-muted-foreground' },
  queued: { label: 'Sırada', className: 'bg-info/10 text-info' },
  sent: { label: 'Gönderildi', className: 'bg-info/10 text-info' },
  delivered: { label: 'İletildi', className: 'bg-success/10 text-success' },
  failed: { label: 'Başarısız', className: 'bg-danger/10 text-danger' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
  suppressed: { label: 'Gönderilmedi', className: 'bg-muted text-muted-foreground' },
  provider_not_configured: { label: 'Sağlayıcı yok', className: 'bg-warning/10 text-warning' },
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
  provider_not_configured: 'Sağlayıcı yapılandırılmamış',
  missing_address: 'E-posta adresi yok',
  missing_phone: 'Telefon numarası yok',
  gateway_timeout: 'Sağlayıcı yanıt vermedi',
  invalid_number: 'Geçersiz numara',
  provider_threw: 'Sağlayıcı hatası',
  network_error: 'Ağ hatası',
}

// "reservation.booked" → "Rezervasyon". A member reads a status; she never reads an event name.
const CAUSE_TR: Record<string, string> = {
  'reservation.booked': 'Rezervasyon',
  'reservation.cancelled': 'İptal',
  'reservation.moved': 'Taşıma',
  'class_session.cancelled': 'Ders iptali',
  'class_session.rescheduled': 'Saat değişikliği',
  'waitlist.promoted': 'Bekleme listesi',
  'studio_closure.applied': 'Kapanış',
  'entitlement.purchased': 'Paket',
  'entitlement.expiring': 'Süre uyarısı',
  'entitlement.expired': 'Süre doldu',
  'entitlement.credits_low': 'Kredi az',
  'entitlement.exhausted': 'Kredi bitti',
  'payment.received': 'Ödeme',
  'plan.instalment_due': 'Taksit',
  'member.invited': 'Davet',
  'manual_send': 'Manuel',
  'bulk_send': 'Toplu',
  'drawer.discrepancy_recorded': 'Kasa uyarısı',
  'system.error': 'Sistem hatası',
  'system.operation_failed': 'İşlem hatası',
  'notification.failed': 'İletim uyarısı',
}
const causeLabel = (t: string) => CAUSE_TR[t] ?? t

const DAY = 86_400_000

export function NotificationCenter({
  initial,
  canManage,
}: {
  initial: readonly NotificationRow[]
  canManage: boolean
}) {
  const [rows, setRows] = useState<readonly NotificationRow[]>(initial)
  const [pending, start] = useTransition()

  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [range, setRange] = useState<'all' | 'today' | '7d' | '30d'>('all')
  const [cause, setCause] = useState('')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<NotificationRow | null>(null)

  const reload = () => start(async () => setRows(await listNotificationsAction()))

  const causes = useMemo(
    () => [...new Set(rows.map((r) => r.causedBy).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const now = Date.now()
    const q = query.trim().toLocaleLowerCase('tr')
    const floor = range === 'today' ? now - DAY : range === '7d' ? now - 7 * DAY : range === '30d' ? now - 30 * DAY : 0
    return rows.filter((r) => {
      if (channel && r.channel !== channel) return false
      if (status && r.status !== status) return false
      if (cause && r.causedBy !== cause) return false
      if (floor && r.at < floor) return false
      if (q && !r.recipientName.toLocaleLowerCase('tr').includes(q)) return false
      return true
    })
  }, [rows, channel, status, cause, range, query])

  const selCls =
    'h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="relative min-w-40 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Üye ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className={selCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Tüm kanallar</option>
          {Object.entries(CHANNEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className={selCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.label}
            </option>
          ))}
        </select>
        <select className={selCls} value={cause} onChange={(e) => setCause(e.target.value)}>
          <option value="">Tüm türler</option>
          {causes.map((c) => (
            <option key={c} value={c}>
              {causeLabel(c)}
            </option>
          ))}
        </select>
        <select className={selCls} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          <option value="all">Tüm zamanlar</option>
          <option value="today">Bugün</option>
          <option value="7d">Son 7 gün</option>
          <option value="30d">Son 30 gün</option>
        </select>
        <Button variant="outline" size="sm" onClick={reload} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          <span className="hidden sm:inline">Yenile</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Kayıt yok" description="Bu filtrede bildirim yok." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zaman</th>
                <th className="px-3 py-2 text-left font-medium">Mesaj</th>
                <th className="px-3 py-2 text-left font-medium">Kime</th>
                <th className="px-3 py-2 text-left font-medium">Kanal</th>
                <th className="px-3 py-2 text-left font-medium">Tür</th>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                {canManage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.attemptId}
                  className="cursor-pointer transition-colors hover:bg-primary-soft/30"
                  onClick={() => setDetail(r)}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                    {r.at ? formatDateTime(r.at) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground">{r.templateName}</p>
                    {r.subject ? <p className="max-w-72 truncate text-xs text-muted-foreground">{r.subject}</p> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-foreground">{r.recipientName}</p>
                    <p className="text-xs text-muted-foreground">{r.recipientKind === 'member' ? 'üye' : 'personel'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{CHANNEL[r.channel] ?? r.channel}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{causeLabel(r.causedBy)}</td>
                  <td className="px-3 py-2.5">
                    <Badge className={STATUS[r.status]?.className ?? ''}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.errorCode ? (
                      <p className="mt-0.5 text-xs text-danger">{ERROR_TR[r.errorCode] ?? r.errorCode}</p>
                    ) : null}
                    {r.suppression ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{SUPPRESSION[r.suppression] ?? r.suppression}</p>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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

      {/* Detail */}
      <Dialog open={detail !== null} onOpenChange={(o) => (o ? null : setDetail(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.templateName}</DialogTitle>
            <DialogDescription>Bildirim ayrıntısı</DialogDescription>
          </DialogHeader>
          {detail ? (
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <Row k="Durum">
                <Badge className={STATUS[detail.status]?.className ?? ''}>
                  {STATUS[detail.status]?.label ?? detail.status}
                </Badge>
              </Row>
              <Row k="Kime">
                {detail.recipientName} · {detail.recipientKind === 'member' ? 'üye' : 'personel'}
              </Row>
              <Row k="Kanal">{CHANNEL[detail.channel] ?? detail.channel}</Row>
              <Row k="Tür">{causeLabel(detail.causedBy)}</Row>
              <Row k="Zaman">{detail.at ? formatDateTime(detail.at) : '—'}</Row>
              <Row k="Deneme">{detail.attemptNo}</Row>
              {detail.subject ? <Row k="Konu">{detail.subject}</Row> : null}
              {detail.errorCode ? (
                <Row k="Hata">
                  {ERROR_TR[detail.errorCode] ?? detail.errorCode} · {detail.permanent ? 'kalıcı' : 'geçici'}
                </Row>
              ) : null}
              {detail.suppression ? (
                <Row k="Gönderilmedi">{SUPPRESSION[detail.suppression] ?? detail.suppression}</Row>
              ) : null}
              <Row k="İşlem No">
                {detail.operationId && canManage ? (
                  <Link href={`/operations/${detail.operationId}`} className="font-mono text-xs text-primary hover:underline">
                    {detail.operationId.slice(-8)}
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">
                    {detail.operationId ? detail.operationId.slice(-8) : '—'}
                  </span>
                )}
              </Row>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="col-span-2 text-foreground">{children}</dd>
    </>
  )
}
