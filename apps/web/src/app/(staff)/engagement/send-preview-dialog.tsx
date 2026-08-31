'use client'

import { Loader2Icon, SendIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EngagementPreviewRow } from '@/server/actions/notifications'

// BEFORE IT GOES OUT (owner, 2026-08-31).
//
// The button used to send. One press, 173 messages, nothing to take back — and the only thing between
// the owner and that was a `confirm()` repeating the number already on screen. She asked for the one
// thing she could not get anywhere else: **kime ne gidecek**, before the send, and an explicit
// approval afterwards.
//
// This dialog answers three questions in the order they are actually asked:
//   1. What will they read? — the message, once, as the member sees it.
//   2. How many will actually be REACHED, per channel? — the number that surprises. Choosing
//      "Sadece e-posta" for 173 members reaches 23, because 23 have an e-mail address. The old
//      button said 173 and the studio had no way to find out otherwise.
//   3. Who exactly? — every name, and beside the ones who will not be reached, the reason.
//
// The counts come from the server calling the same pure `selectChannels` the pipeline calls. Nothing
// here recomputes a rule.

const CHANNEL_LABEL: Record<string, string> = {
  in_app: 'Uygulama içi',
  whatsapp: 'WhatsApp',
  email: 'E-posta',
  sms: 'SMS',
  push: 'Push bildirim',
}

const REASON_LABEL: Record<string, string> = {
  no_consent: 'kampanya izni yok',
  member_preference: 'üye bu kanalı kapatmış',
  missing_contact: 'iletişim bilgisi yok',
  quiet_hours: 'sessiz saatler',
}

export interface EngagementPreview {
  readonly total: number
  readonly rows: readonly EngagementPreviewRow[]
  readonly perChannel: Record<string, number>
  readonly reasons: Record<string, number>
}

export function SendPreviewDialog({
  preview,
  audienceLabel,
  subject,
  body,
  sending,
  onConfirm,
  onClose,
}: {
  preview: EngagementPreview
  audienceLabel: string
  subject: string
  body: string
  sending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const channels = Object.entries(preview.perChannel).sort((a, b) => b[1] - a[1])
  const reasons = Object.entries(preview.reasons).sort((a, b) => b[1] - a[1])

  return (
    <Dialog open onOpenChange={(v) => !v && !sending && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Göndermeden önce</DialogTitle>
          <DialogDescription>
            <b className="text-foreground">{audienceLabel}</b> · {preview.total} üye. Onaylamadan hiçbir mesaj gitmez.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="rounded-xl border-l-4 border-primary bg-card p-3 shadow-sm">
            <p className="text-sm font-semibold">📣 {subject}</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kaç kişiye, hangi kanaldan</p>
            {channels.length === 0 ? (
              <p className="text-sm text-danger">Hiçbir kanaldan kimseye ulaşılamıyor.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map(([c, n]) => (
                  <Badge key={c} className="bg-primary/10 text-primary">
                    {CHANNEL_LABEL[c] ?? c}: <span className="tabular-nums">&nbsp;{n}</span>
                  </Badge>
                ))}
              </div>
            )}
            {reasons.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Ulaşılamayan:{' '}
                {reasons.map(([r, n], i) => (
                  <span key={r}>
                    {i > 0 ? ' · ' : ''}
                    <span className="tabular-nums">{n}</span> {REASON_LABEL[r] ?? r}
                  </span>
                ))}
              </p>
            ) : null}
            {/* Uygulama içi kayıt her zaman düşer — kapatılamaz, çünkü üyenin kendi hesap geçmişidir. */}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kimlere gidecek</p>
            {preview.rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/40">
                <span className="w-6 shrink-0 tabular-nums text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Vazgeç
          </Button>
          <Button onClick={onConfirm} disabled={sending || preview.total === 0}>
            {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
            {sending ? `${preview.total} üyeye gönderiliyor…` : `Onayla ve ${preview.total} üyeye gönder`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
