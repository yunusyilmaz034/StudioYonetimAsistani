'use client'

import { useMemo, useState } from 'react'
import { Loader2Icon, PencilIcon, PlusIcon, SendIcon, SparklesIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  deleteEngagementContentAction,
  listEngagementContentAction,
  seedEngagementContentAction,
  upsertEngagementContentAction,
  type EngagementCategory,
  type EngagementContent,
  type SegmentInfo,
  type SegmentKey,
} from '@/server/actions/engagement'
import { sendEngagementAction } from '@/server/actions/notifications'

const CAT_LABEL: Record<EngagementCategory, string> = {
  motivation: 'Motivasyon',
  birthday: 'Doğum günü',
  missed: 'Seni özledik',
  campaign: 'Kampanya',
  custom: 'Diğer',
}
const CATS = Object.keys(CAT_LABEL) as EngagementCategory[]
const EMPTY = { id: '', category: 'motivation' as EngagementCategory, title: '', subject: '', body: '', updatedAt: 0 }

export function EngagementScreen({
  initialContent,
  segments,
  canManage,
}: {
  initialContent: EngagementContent[]
  segments: SegmentInfo[]
  canManage: boolean
}) {
  const [content, setContent] = useState<EngagementContent[]>(initialContent)
  const reloadContent = async () => setContent([...(await listEngagementContentAction())])

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-10">
      <div>
        <h1 className="text-display font-semibold">Stüdyodan</h1>
        <p className="text-sm text-muted-foreground">Üyelerinle bağ kur — motivasyon, kutlama ve kampanyaları doğru kitleye gönder. Her gönderim senin onayınla.</p>
      </div>

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send"><SendIcon className="size-4" /> Gönder</TabsTrigger>
          <TabsTrigger value="library"><SparklesIcon className="size-4" /> İçerik Kütüphanesi</TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <Composer content={content} segments={segments} />
        </TabsContent>

        <TabsContent value="library">
          <Library content={content} canManage={canManage} onChanged={reloadContent} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────────────────────
function Composer({ content, segments }: { content: EngagementContent[]; segments: SegmentInfo[] }) {
  const [segment, setSegment] = useState<SegmentKey>('all')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const seg = segments.find((s) => s.key === segment)

  const pick = (c: EngagementContent) => {
    setSubject(c.subject)
    setBody(c.body)
  }

  async function send() {
    if (!subject.trim() || !body.trim()) {
      toast.error('Başlık ve mesaj zorunlu.')
      return
    }
    if (!seg || seg.count === 0) {
      toast.error('Seçilen kitlede üye yok.')
      return
    }
    if (!confirm(`"${seg.label}" (${seg.count} üye) grubuna göndermeyi onaylıyor musun?`)) return
    setSending(true)
    try {
      const res = await sendEngagementAction({ subject: subject.trim(), body: body.trim(), segment })
      if (res.ok) {
        toast.success(`${res.value.sent} üyeye gönderildi${res.value.failed ? `, ${res.value.failed} başarısız` : ''}.`)
        setSubject('')
        setBody('')
      } else toast.error('Gönderilemedi.')
    } catch {
      toast.error('Gönderilemedi.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-sm font-medium">Kitle</p>
        <div className="flex flex-wrap gap-2">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${segment === s.key ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              <UsersIcon className="size-3.5" /> {s.label} <span className="tabular-nums opacity-70">({s.count})</span>
            </button>
          ))}
        </div>
      </section>

      {content.length > 0 ? (
        <section className="space-y-2">
          <p className="text-sm font-medium">Kütüphaneden seç <span className="font-normal text-muted-foreground">(sonra düzenleyebilirsin)</span></p>
          <div className="flex flex-wrap gap-2">
            {content.map((c) => (
              <button key={c.id} type="button" onClick={() => pick(c)} className="rounded-lg border bg-card px-3 py-1.5 text-left text-sm shadow-xs transition-colors hover:border-primary">
                <span className="text-xs text-accent">{CAT_LABEL[c.category]}</span>
                <span className="block font-medium">{c.title}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Başlık</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Yeni bir hafta, yeni bir sen ✨" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mesaj</label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={600} placeholder="Üyene söylemek istediğin sıcak mesaj…" />
        </div>
      </section>

      {subject || body ? (
        <section className="space-y-2 rounded-2xl border bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Önizleme (üyenin ana sayfasında)</p>
          <div className="rounded-xl border-l-4 border-primary bg-card p-3 shadow-sm">
            <p className="text-sm font-semibold">📣 {subject || 'Başlık'}</p>
            <p className="text-sm text-muted-foreground">{body || 'Mesaj burada görünecek.'}</p>
          </div>
        </section>
      ) : null}

      <Button onClick={() => void send()} disabled={sending}>
        {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon className="size-4" />} {seg ? `${seg.count} üyeye gönder` : 'Gönder'}
      </Button>
      <p className="text-xs text-muted-foreground">Uygulama içi "Stüdyodan" akışına her zaman düşer; bildirimi açık üyelere ayrıca telefon bildirimi gider.</p>
    </div>
  )
}

// ── İçerik Kütüphanesi ────────────────────────────────────────────────────────────────────────
function Library({ content, canManage, onChanged }: { content: EngagementContent[]; canManage: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<EngagementContent | null>(null)
  const [busy, setBusy] = useState(false)
  const grouped = useMemo(() => CATS.map((c) => ({ cat: c, items: content.filter((x) => x.category === c) })).filter((g) => g.items.length > 0), [content])

  async function seed() {
    setBusy(true)
    try {
      const r = await seedEngagementContentAction()
      if (r.ok) {
        await onChanged()
        toast.success(`${r.value.count} hazır içerik eklendi.`)
      } else toast.error('Zaten içerik var.')
    } catch {
      toast.error('Yüklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    if (!editing.title.trim() || !editing.subject.trim() || !editing.body.trim()) {
      toast.error('Tüm alanlar zorunlu.')
      return
    }
    setBusy(true)
    try {
      const r = await upsertEngagementContentAction({ id: editing.id || undefined, category: editing.category, title: editing.title.trim(), subject: editing.subject.trim(), body: editing.body.trim() })
      if (r.ok) {
        await onChanged()
        setEditing(null)
        toast.success('Kaydedildi.')
      }
    } catch {
      toast.error('Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: EngagementContent) {
    if (!confirm(`"${c.title}" silinsin mi?`)) return
    setBusy(true)
    try {
      await deleteEngagementContentAction({ id: c.id })
      await onChanged()
      toast.success('Silindi.')
    } catch {
      toast.error('Silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}><PlusIcon className="size-4" /> Yeni İçerik</Button>
          {content.length === 0 ? <Button size="sm" variant="outline" onClick={() => void seed()} disabled={busy}><SparklesIcon className="size-4" /> Hazır içerikleri yükle</Button> : null}
        </div>
      ) : null}

      {content.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Henüz içerik yok.</p>
      ) : (
        grouped.map((g) => (
          <section key={g.cat} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{CAT_LABEL[g.cat]}</h3>
            <ul className="space-y-2">
              {g.items.map((c) => (
                <li key={c.id} className="rounded-xl border bg-card p-3 shadow-xs">
                  <p className="font-medium">{c.title}</p>
                  <p className="text-sm font-semibold text-foreground">{c.subject}</p>
                  <p className="text-sm text-muted-foreground">{c.body}</p>
                  {canManage ? (
                    <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                      <button type="button" onClick={() => setEditing({ ...c })} className="inline-flex items-center gap-1 hover:text-foreground"><PencilIcon className="size-3" /> Düzenle</button>
                      <button type="button" onClick={() => void remove(c)} className="inline-flex items-center gap-1 hover:text-danger"><Trash2Icon className="size-3" /> Sil</button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-5 sm:max-w-lg">
          {editing ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="text-h1">{editing.id ? 'İçeriği Düzenle' : 'Yeni İçerik'}</SheetTitle>
                <SheetDescription>Kütüphanedeki bu içeriği Gönder ekranından seçip yollarsın.</SheetDescription>
              </SheetHeader>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kategori</label>
                <div className="flex flex-wrap gap-2">
                  {CATS.map((c) => (
                    <button key={c} type="button" onClick={() => setEditing({ ...editing, category: c })} className={`rounded-full px-3 py-1.5 text-sm font-medium ${editing.category === c ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{CAT_LABEL[c]}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5"><label className="text-sm font-medium">İç başlık <span className="font-normal text-muted-foreground">(sadece sen görürsün)</span></label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Pazartesi motivasyonu" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Başlık <span className="font-normal text-muted-foreground">(üye görür)</span></label><Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} maxLength={120} /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Mesaj</label><Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={6} maxLength={600} /></div>
              <div className="flex gap-2">
                <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Vazgeç</Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
