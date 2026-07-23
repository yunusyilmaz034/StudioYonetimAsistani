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
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listNotificationTemplatesAction,
  previewNotificationAction,
  sendManualNotificationAction,
  sendWhatsAppTemplateAction,
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
  subject: 'Başlık',
  body: 'Mesaj',
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

// Ready-made motivation lines for a free-text "Stüdyodan mesaj". Clicking one fills the box; it stays
// fully editable, so it is a starting point, never a canned send. Warm, women-only-studio tone.
const MOTIVATION_LINES: readonly string[] = [
  'Bugün harika bir iş çıkardın, seninle gurur duyuyoruz! 💛',
  'Küçük adımlar büyük değişimler yaratır — böyle devam! 🌸',
  'Sağlığın için attığın her adım çok değerli. ✨',
  'Her ders bir adım daha güçlü, bir adım daha sen. 💪',
  'Bu hafta kendine ayırdığın zaman için tebrikler. 🙌',
  'Seni yakında yeniden aramızda görmek isteriz 🌸',
]

// The manual-send dropdown had ~20 templates in one flat list — too much to scan. Group them by purpose
// so the desk picks a category first, then a short list. Groups are derived from the template id (the
// catalogue is code, so the ids are stable); anything unmatched lands in "Diğer".
const GROUP_ORDER = ['Serbest mesaj & Motivasyon', 'Rezervasyon & Ders', 'Paket & Kredi', 'Ödeme & Bakiye', 'Üyelik & Davet', 'Diğer'] as const
function groupOf(t: { id: string }): string {
  const id = t.id
  if (id === 'engagement_broadcast') return 'Serbest mesaj & Motivasyon'
  if (/booking|waitlist|session|closure/.test(id)) return 'Rezervasyon & Ders'
  if (/package|credit|program/.test(id)) return 'Paket & Kredi'
  if (/payment|refund|balance|instalment|wallet/.test(id)) return 'Ödeme & Bakiye'
  if (/portal|invite/.test(id)) return 'Üyelik & Davet'
  return 'Diğer'
}

export function ManualSendDialog({
  memberId,
  memberName,
  open,
  onClose,
  contextParams,
  channel = 'notify',
}: {
  memberId: string
  memberName?: string
  open: boolean
  onClose: () => void
  contextParams?: Readonly<Record<string, string>>
  // 'notify' (default) = the member's preferred channels decide. 'whatsapp' = a deliberate WhatsApp
  // template send: only Meta-approved templates are offered and it goes out over WhatsApp only.
  channel?: 'notify' | 'whatsapp'
}) {
  const whatsapp = channel === 'whatsapp'
  const [templates, setTemplates] = useState<readonly TemplateRow[] | null>(null)
  const [group, setGroup] = useState<string>('')
  const [templateId, setTemplateId] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setGroup('')
    setTemplateId('')
    listNotificationTemplatesAction()
      .then((rows) => setTemplates(rows.filter((t) => t.active && (!whatsapp || t.whatsappCapable))))
      .catch(() => setTemplates([]))
  }, [open, whatsapp])

  const template = useMemo(() => templates?.find((t) => t.id === templateId) ?? null, [templates, templateId])
  // Every required param except memberName (the server fills that from the member record).
  const fields = useMemo(() => (template ? template.requiredParams.filter((p) => p !== 'memberName') : []), [template])
  // Category-first: the first dropdown lists the groups that actually have templates; the second is
  // filtered to the chosen group.
  const groups = useMemo(() => {
    const present = new Set((templates ?? []).map((t) => groupOf(t)))
    return GROUP_ORDER.filter((g) => present.has(g))
  }, [templates])
  const groupTemplates = useMemo(() => (templates ?? []).filter((t) => groupOf(t) === group), [templates, group])

  // When the template changes, seed the fields from the caller's context params.
  useEffect(() => {
    if (!template) return
    const seeded: Record<string, string> = {}
    // A free-text "Stüdyodan mesaj" gets a friendly default title so the desk only writes the body.
    for (const f of fields) seeded[f] = contextParams?.[f] ?? (f === 'subject' ? 'Stüdyodan 💛' : '')
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
      const res = whatsapp
        ? await sendWhatsAppTemplateAction({ memberId, templateId: template.id, params: paramsPayload() })
        : await sendManualNotificationAction({ memberId, templateId: template.id, params: paramsPayload() })
      if (res.ok) {
        toast.success(whatsapp ? 'WhatsApp mesajı gönderildi.' : 'Mesaj gönderildi.')
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
          <DialogTitle>{whatsapp ? "WhatsApp'tan Gönder" : 'Mesaj Gönder'}</DialogTitle>
          <DialogDescription>
            {whatsapp
              ? 'Meta onaylı bir WhatsApp şablonu seçin, önizleyin ve gönderin. Mesaj WhatsApp üzerinden iletilir.'
              : 'Şablon seçin, önizleyin ve gönderin. Mesaj, üyenin tercih ve izinlerine göre uygun kanallardan iletilir.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            Kategori
            <Select
              value={group}
              onValueChange={(v) => {
                setGroup(v ?? '')
                setTemplateId('')
                setPreview(null)
              }}
            >
              <SelectTrigger>
                <SelectValue>{(v: unknown) => (v ? String(v) : 'Kategori seç')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {group ? (
            <label className="flex flex-col gap-1 text-sm">
              Şablon
              <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue>
                    {(v: unknown) => groupTemplates.find((t) => t.id === v)?.name ?? 'Şablon seç'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groupTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {fields.map((f) =>
            f === 'body' ? (
              <label key={f} className="flex flex-col gap-1 text-sm">
                {HUMAN_PARAM[f] ?? f}
                <Textarea
                  rows={4}
                  placeholder="Mesajını yaz ya da aşağıdan bir öneri seç…"
                  value={values[f] ?? ''}
                  onChange={(e) => {
                    setValues((prev) => ({ ...prev, [f]: e.target.value }))
                    setPreview(null)
                  }}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {MOTIVATION_LINES.map((line) => (
                    <button
                      key={line}
                      type="button"
                      onClick={() => {
                        setValues((prev) => ({ ...prev, body: line }))
                        setPreview(null)
                      }}
                      className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {line.length > 34 ? `${line.slice(0, 32)}…` : line}
                    </button>
                  ))}
                </div>
              </label>
            ) : (
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
            ),
          )}

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
