'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2Icon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listNotificationTemplatesAction,
  previewNotificationAction,
  sendManualNotificationAction,
  type TemplateRow,
} from '@/server/actions/notifications'

// The manual-send actions can also refuse with codes outside the shared DomainError union
// (member/template not found); map those, then fall back to the shared copy.
function sendErrorMessage(error: { readonly code: string }): string {
  if (error.code === 'member_not_found') return 'Üye bulunamadı.'
  if (error.code === 'template_not_found') return 'Şablon bulunamadı.'
  return domainErrorMessage(error as Parameters<typeof domainErrorMessage>[0])
}

// Manual send (Plus Phase 5, §12) — staff sends a TEMPLATE to a member through the same notify()
// pipeline (channel selection, consent, quiet hours, retry, audit). `memberName` is filled server-
// side; every OTHER required param is an editable field, pre-filled from `contextParams` when the
// caller has it (e.g. a reservation's session name + time). Render refuses a missing param, so a
// blank "Merhaba {{memberName}}" can never be sent.
const HUMAN_PARAM: Record<string, string> = {
  sessionName: 'Ders',
  sessionTime: 'Ders saati',
  fromTime: 'Eski saat',
  toTime: 'Yeni saat',
  productName: 'Paket',
  daysLeft: 'Kalan gün',
  remaining: 'Kalan hak',
  amount: 'Tutar',
  reason: 'Sebep',
  sessionCount: 'Ders sayısı',
  inviteLink: 'Davet linki',
  balance: 'Bakiye',
  dueDate: 'Vade',
}

export function ManualSendDialog({
  memberId,
  memberName,
  open,
  onClose,
  contextParams,
}: {
  memberId: string
  memberName?: string
  open: boolean
  onClose: () => void
  contextParams?: Readonly<Record<string, string>>
}) {
  const [templates, setTemplates] = useState<readonly TemplateRow[] | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPreview(null)
    listNotificationTemplatesAction()
      .then((rows) => setTemplates(rows.filter((t) => t.active)))
      .catch(() => setTemplates([]))
  }, [open])

  const template = useMemo(() => templates?.find((t) => t.id === templateId) ?? null, [templates, templateId])
  // Every required param except memberName (the server fills that from the member record).
  const fields = useMemo(() => (template ? template.requiredParams.filter((p) => p !== 'memberName') : []), [template])

  // When the template changes, seed the fields from the caller's context params.
  useEffect(() => {
    if (!template) return
    const seeded: Record<string, string> = {}
    for (const f of fields) seeded[f] = contextParams?.[f] ?? ''
    setValues(seeded)
    setPreview(null)
  }, [templateId, template, fields, contextParams])

  const paramsPayload = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const f of fields) out[f] = values[f] ?? ''
    return out
  }

  async function doPreview() {
    if (!template) return
    setBusy(true)
    try {
      const res = await previewNotificationAction({ templateId: template.id, params: { memberName: memberName ?? '', ...paramsPayload() } })
      if (res.ok) setPreview(res.value)
      else {
        setPreview(null)
        toast.error(sendErrorMessage(res.error))
      }
    } catch {
      toast.error('Ön izleme oluşturulamadı.')
    }
    setBusy(false)
  }

  async function doSend() {
    if (!template) return
    setBusy(true)
    try {
      const res = await sendManualNotificationAction({ memberId, templateId: template.id, params: paramsPayload() })
      if (res.ok) {
        toast.success('Mesaj gönderildi.')
        onClose()
      } else {
        toast.error(sendErrorMessage(res.error))
      }
    } catch {
      toast.error('Gönderilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mesaj Gönder</DialogTitle>
          <DialogDescription>
            Şablon seçin, önizleyin ve gönderin. Mesaj, üyenin tercih ve izinlerine göre uygun kanallardan iletilir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            Şablon
            <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
              <SelectTrigger>
                <SelectValue>
                  {(v: unknown) => templates?.find((t) => t.id === v)?.name ?? 'Şablon seç'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {fields.map((f) => (
            <label key={f} className="flex flex-col gap-1 text-sm">
              {HUMAN_PARAM[f] ?? f}
              <Input
                value={values[f] ?? ''}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, [f]: e.target.value }))
                  setPreview(null)
                }}
              />
            </label>
          ))}

          {preview ? (
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">{preview.subject}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{preview.body}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="outline" onClick={() => void doPreview()} disabled={busy || !template}>
            Ön izle
          </Button>
          <Button onClick={() => void doSend()} disabled={busy || !template}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            Gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
