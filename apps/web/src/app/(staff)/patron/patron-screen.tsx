'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon, SendIcon, SparklesIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PatronBriefing, ResolvedPatronAction } from '@/lib/patron/actions'
import { askPatronAction, patronBriefingAction } from '@/server/actions/patron'
import { sendEngagementAction } from '@/server/actions/notifications'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  actions?: readonly ResolvedPatronAction[]
  aiGenerated?: boolean
}

const READY_QUESTIONS = [
  'Bu ay nasıl gidiyoruz, geçen aya göre?',
  'Alacaklarım ne durumda?',
  'Kimler kaçmak üzere?',
  'Boş kapasitem ne durumda?',
  "WhatsApp'tan kaç lead geldi?",
]

export function PatronScreen() {
  const router = useRouter()
  const [briefing, setBriefing] = useState<PatronBriefing | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(true)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ResolvedPatronAction | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    patronBriefingAction()
      .then(setBriefing)
      .catch(() => setBriefing(null))
      .finally(() => setBriefingLoading(false))
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setMessages((m) => [...m, { role: 'user', text: q }])
    setInput('')
    setBusy(true)
    try {
      const res = await askPatronAction({ question: q })
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, actions: res.actions, aiGenerated: res.aiGenerated }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Bir sorun oldu, tekrar dener misin?' }])
    }
    setBusy(false)
  }

  function onAction(a: ResolvedPatronAction) {
    if (a.navigate) {
      router.push(a.navigate)
      return
    }
    setConfirm(a)
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-var(--app-header,4rem))] max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Patron Asistanı"
        description="İşletmeni tanıyan asistanın. Gerçek rakamlarla sorularını cevaplar, ne yapman gerektiğini önerir."
      />

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {/* Weekly briefing */}
        <Section title="Bu haftanın brifingi">
          {briefingLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Hazırlanıyor…
            </div>
          ) : briefing && briefing.answer ? (
            <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <SparklesIcon className="size-3.5" /> AI patron brifingi
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{briefing.answer}</p>
              {briefing.actions.length > 0 ? <ActionRow actions={briefing.actions} onAction={onAction} /> : null}
            </div>
          ) : briefing ? (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                AI brifingi için anahtar henüz bağlı değil. Aşağıdaki hızlı aksiyonlar hazır verinden çalışıyor.
              </p>
              {briefing.actions.length > 0 ? <ActionRow actions={briefing.actions} onAction={onAction} /> : null}
            </div>
          ) : null}
        </Section>

        {/* Conversation */}
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Hazır sorular</p>
            <div className="flex flex-wrap gap-2">
              {READY_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void ask(q)}
                  className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m, i) => (
              <li key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {m.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.text}</div>
                ) : (
                  <div className="max-w-[92%] space-y-2">
                    <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{m.text}</p>
                    </div>
                    {m.actions && m.actions.length > 0 ? <ActionRow actions={m.actions} onAction={onAction} /> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Düşünüyor…
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask(input)
            }
          }}
          rows={1}
          placeholder="İşletmenle ilgili bir şey sor…"
          className="max-h-32 min-h-11 flex-1 resize-none"
        />
        <Button type="submit" disabled={busy || !input.trim()} className="h-11 shrink-0">
          <SendIcon className="size-4" />
        </Button>
      </form>

      {confirm ? <SendConfirmDialog action={confirm} onClose={() => setConfirm(null)} /> : null}
    </main>
  )
}

function ActionRow({ actions, onAction }: { actions: readonly ResolvedPatronAction[]; onAction: (a: ResolvedPatronAction) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.kind}
          type="button"
          onClick={() => onAction(a)}
          className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <SparklesIcon className="size-3.5" />
          {a.label}
          {a.audienceCount > 0 ? <span className="rounded-full bg-primary/15 px-1.5 tabular-nums">{a.audienceCount}</span> : null}
        </button>
      ))}
    </div>
  )
}

// Every send is owner-confirmed: the recipient count is shown and the text is editable before anything
// leaves. Sending reuses the audited engagement pipeline (consent-aware; in-app always, WhatsApp/push
// only with marketing opt-in).
function SendConfirmDialog({ action, onClose }: { action: ResolvedPatronAction; onClose: () => void }) {
  const [subject, setSubject] = useState(action.defaultSubject)
  const [body, setBody] = useState(action.defaultBody)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!subject.trim() || !body.trim()) {
      toast.error('Başlık ve mesaj boş olamaz.')
      return
    }
    setBusy(true)
    try {
      const res = await sendEngagementAction({ subject: subject.trim(), body: body.trim(), memberIds: [...action.memberIds] })
      if (res.ok) {
        toast.success(`${res.value.sent} kişiye gönderildi${res.value.failed > 0 ? ` · ${res.value.failed} başarısız` : ''}.`)
        onClose()
      } else {
        toast.error('Gönderilecek uygun alıcı bulunamadı.')
      }
    } catch {
      toast.error('Gönderilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <UsersIcon className="size-3.5" />
            {action.audienceCount} kişiye gönderilecek. Uygulama içi bildirim herkese ulaşır; WhatsApp yalnızca izni olanlara gider.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Başlık</span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Mesaj</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={600} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />} {action.audienceCount} kişiye gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
