'use client'

import { useState, useTransition } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listNotificationTemplatesAction,
  resetNotificationTemplateAction,
  updateNotificationTemplateAction,
  type TemplateRow,
} from '@/server/actions/notifications'

// The message copy IS data (AD-41): the studio edits it here, per template, without a deploy. A
// deactivated template stops NEW sends; a past message keeps its rendered snapshot, always. Reception
// reads; only the owner changes what the studio says.
export function TemplateManager({
  initial,
  canManage,
}: {
  initial: readonly TemplateRow[]
  canManage: boolean
}) {
  const [rows, setRows] = useState<readonly TemplateRow[]>(initial)
  const [editing, setEditing] = useState<TemplateRow | null>(null)
  const [, start] = useTransition()

  const reload = () => start(async () => setRows(await listNotificationTemplatesAction()))

  return (
    <Section
      title="Bildirim şablonları"
      hint="Konu ve gövde metnini düzenleyin. {{değişken}} alanları gönderim anında doldurulur."
    >
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {t.name}
                <Badge className="bg-muted text-muted-foreground">{t.channelLabel}</Badge>
                {t.overridden ? <Badge className="bg-info/10 text-info">özelleştirildi · v{t.version}</Badge> : null}
                {!t.active ? <Badge className="bg-warning/10 text-warning">pasif</Badge> : null}
              </p>
              <p className="max-w-xl truncate text-xs text-muted-foreground">{t.body}</p>
            </div>
            {canManage ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                Düzenle
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      ) : null}
    </Section>
  )
}

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: TemplateRow
  onClose: () => void
  onSaved: () => void
}) {
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [active, setActive] = useState(template.active)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await updateNotificationTemplateAction({ id: template.id, subject: subject.trim(), body: body.trim(), active })
      if (res.ok) {
        toast.success('Şablon kaydedildi.')
        onSaved()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setBusy(false)
  }

  async function reset() {
    setBusy(true)
    try {
      const res = await resetNotificationTemplateAction({ id: template.id })
      if (res.ok) {
        toast.success('Varsayılana döndürüldü.')
        onSaved()
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>Gövdede tüm zorunlu değişkenler bulunmalı, yoksa gönderim reddedilir.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {template.requiredParams.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBody((b) => `${b}{{${p}}}`)}
                className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-primary-soft/40"
              >
                {`{{${p}}}`}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Konu (e-posta)
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Gövde
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
            Aktif (kapalıyken yeni gönderim yapılmaz)
          </label>
        </div>

        <DialogFooter className="sm:justify-between">
          {template.overridden ? (
            <Button variant="ghost" className="text-danger" onClick={() => void reset()} disabled={busy}>
              Varsayılana dön
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => void save()} disabled={busy || subject.trim().length === 0 || body.trim().length === 0}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
