'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangleIcon,
  BookOpenIcon,
  ListChecksIcon,
  Loader2Icon,
  PencilIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Markdown } from '@/components/markdown'
import {
  deleteKnowledgeArticleAction,
  listKnowledgeArticlesAction,
  seedKnowledgeBaseAction,
  upsertKnowledgeArticleAction,
  type KnowledgeArticle,
  type KnowledgeCategory,
} from '@/server/actions/knowledge'

const CATS: { key: KnowledgeCategory; label: string; icon: typeof BookOpenIcon; hint: string }[] = [
  { key: 'scenario', label: 'Senaryolar', icon: PlayCircleIcon, hint: 'Şu oldu, ne yapmalı?' },
  { key: 'guide', label: 'Nasıl Yapılır', icon: ListChecksIcon, hint: 'Adım adım rehberler' },
  { key: 'concept', label: 'Kavramlar', icon: BookOpenIcon, hint: 'Sözlük' },
  { key: 'risk', label: 'Riskli / Sık Hata', icon: AlertTriangleIcon, hint: 'Dikkat edilecekler' },
]
const catMeta = (k: KnowledgeCategory) => CATS.find((c) => c.key === k) ?? CATS[0]!
const EMPTY = { id: '', category: 'scenario' as KnowledgeCategory, title: '', body: '', order: 100, pinned: false, updatedAt: 0 }

export function KnowledgeScreen({ initial, canManage }: { initial: KnowledgeArticle[]; canManage: boolean }) {
  const [articles, setArticles] = useState<KnowledgeArticle[]>(initial)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<KnowledgeCategory | 'all'>('all')
  const [reading, setReading] = useState<KnowledgeArticle | null>(null)
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async () => setArticles([...(await listKnowledgeArticlesAction())])

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    return articles.filter(
      (a) =>
        (cat === 'all' || a.category === cat) &&
        (needle === '' || a.title.toLocaleLowerCase('tr').includes(needle) || a.body.toLocaleLowerCase('tr').includes(needle)),
    )
  }, [articles, q, cat])

  async function seed() {
    setBusy(true)
    try {
      const r = await seedKnowledgeBaseAction()
      if (r.ok) {
        await reload()
        toast.success(`${r.value.count} başlangıç maddesi eklendi.`)
      } else toast.error('Zaten içerik var.')
    } catch {
      toast.error('Yüklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    if (!editing.title.trim() || !editing.body.trim()) {
      toast.error('Başlık ve içerik zorunlu.')
      return
    }
    setBusy(true)
    try {
      const r = await upsertKnowledgeArticleAction({
        id: editing.id || undefined,
        category: editing.category,
        title: editing.title.trim(),
        body: editing.body.trim(),
        order: editing.order,
        pinned: editing.pinned,
      })
      if (r.ok) {
        await reload()
        setEditing(null)
        toast.success('Kaydedildi.')
      }
    } catch {
      toast.error('Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: KnowledgeArticle) {
    if (!confirm(`"${a.title}" silinsin mi?`)) return
    setBusy(true)
    try {
      await deleteKnowledgeArticleAction({ id: a.id })
      await reload()
      toast.success('Silindi.')
    } catch {
      toast.error('Silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold">Bilgi Merkezi</h1>
          <p className="text-sm text-muted-foreground">Panelin tüm işleyişi — senaryolar, rehberler, kavramlar ve riskli işlemler.</p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <PlusIcon className="size-4" /> Yeni Madde
          </Button>
        ) : null}
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara — ör. eğitmen, iptal, kredi, PAYTR…" className="pl-9" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip active={cat === 'all'} onClick={() => setCat('all')} label="Tümü" />
        {CATS.map((c) => (
          <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)} label={c.label} icon={<c.icon className="size-3.5" />} />
        ))}
      </div>

      {articles.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <SparklesIcon className="mx-auto size-8 text-accent" />
          <p className="mt-3 font-medium">Bilgi Merkezi boş</p>
          <p className="mt-1 text-sm text-muted-foreground">Hazırladığımız başlangıç içeriğini yükle, sonra dilediğin gibi düzenle.</p>
          {canManage ? (
            <Button className="mt-4" onClick={() => void seed()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon className="size-4" />} Başlangıç içeriğini yükle
            </Button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Eşleşen madde yok.</p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {filtered.map((a) => {
            const m = catMeta(a.category)
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setReading(a)}
                  className="flex h-full w-full flex-col gap-1.5 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary"
                >
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${a.category === 'risk' ? 'text-danger' : 'text-accent'}`}>
                    <m.icon className="size-3.5" /> {m.label}
                  </span>
                  <span className="font-semibold text-foreground">{a.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{a.body.replace(/[#*-]/g, '').slice(0, 120)}</span>
                  {canManage ? (
                    <span className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 hover:text-foreground" onClick={(e) => { e.stopPropagation(); setEditing({ ...a }) }}><PencilIcon className="size-3" /> Düzenle</span>
                      <span className="inline-flex items-center gap-1 hover:text-danger" onClick={(e) => { e.stopPropagation(); void remove(a) }}><Trash2Icon className="size-3" /> Sil</span>
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Reader */}
      <Sheet open={!!reading} onOpenChange={(o) => !o && setReading(null)}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-5 sm:max-w-lg">
          {reading ? (
            <>
              <SheetHeader className="p-0">
                <SheetDescription className="text-xs font-medium uppercase tracking-wide text-accent">{catMeta(reading.category).label}</SheetDescription>
                <SheetTitle className="text-h1">{reading.title}</SheetTitle>
              </SheetHeader>
              <Markdown>{reading.body}</Markdown>
              {canManage ? (
                <Button variant="outline" onClick={() => { setEditing({ ...reading }); setReading(null) }}>
                  <PencilIcon className="size-4" /> Bu maddeyi düzenle
                </Button>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Editor (owner) */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-5 sm:max-w-lg">
          {editing ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle className="text-h1">{editing.id ? 'Maddeyi Düzenle' : 'Yeni Madde'}</SheetTitle>
                <SheetDescription>Metinde **kalın**, ## başlık, - liste, 1. adım kullanabilirsin.</SheetDescription>
              </SheetHeader>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kategori</label>
                <div className="flex flex-wrap gap-2">
                  {CATS.map((c) => (
                    <Chip key={c.key} active={editing.category === c.key} onClick={() => setEditing({ ...editing, category: c.key })} label={c.label} icon={<c.icon className="size-3.5" />} />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Başlık</label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Ör. Üye rezervasyonunu değiştirmek istiyor" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">İçerik</label>
                <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={14} placeholder={'1. Adım...\n2. Adım...\n\n⚠️ Dikkat edilecek nokta.'} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.pinned} onChange={(e) => setEditing({ ...editing, pinned: e.target.checked })} /> Üste sabitle
              </label>
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

function Chip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
    >
      {icon} {label}
    </button>
  )
}
