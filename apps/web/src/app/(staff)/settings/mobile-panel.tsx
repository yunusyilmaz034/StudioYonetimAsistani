'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { getMobileSettingsAction, setMobileBannerAction } from '@/server/actions/mobile-settings'

type Tone = 'accent' | 'gold' | 'good'
const TONES: { key: Tone; label: string; className: string }[] = [
  { key: 'accent', label: 'Vurgu', className: 'bg-primary' },
  { key: 'gold', label: 'Altın', className: 'bg-amber-500' },
  { key: 'good', label: 'Yeşil', className: 'bg-emerald-600' },
]

// Ayarlar → Mobil. Everything the owner controls in the member app is collected here. Today: the
// home-screen campaign banner (the top card in the app).
export function MobilePanel({ canEdit }: { canEdit: boolean }) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tone, setTone] = useState<Tone>('accent')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getMobileSettingsAction()
      .then((s) => {
        if (s.banner) { setActive(s.banner.active); setTitle(s.banner.title); setBody(s.banner.body); setTone(s.banner.tone) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    if (active && (title.trim().length === 0 || body.trim().length === 0)) {
      toast.error('Banner açıkken başlık ve metin dolu olmalı.')
      return
    }
    setSaving(true)
    try {
      const r = await setMobileBannerAction({ active, title: title.trim(), body: body.trim(), tone })
      if (r.ok) toast.success('Mobil banner kaydedildi.')
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2Icon className="animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-6">
      <Section
        title="Ana sayfa kampanya banner'ı"
        hint="Üyelerin mobil uygulamayı açtığında en üstte gördüğü duyuru/kampanya kartı. Kapalıyken görünmez."
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(Boolean(v))} disabled={!canEdit} />
            <span className="text-sm font-medium">Banner'ı üyelere göster</span>
          </label>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Başlık</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Örn. Yaz Kampanyası 🌸" disabled={!canEdit} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Metin</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={240} rows={3} placeholder="Örn. Ağustos sonuna kadar 8 derslik pakette %20 indirim. Detaylar için resepsiyona ulaşın." disabled={!canEdit} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Renk</label>
            <div className="flex gap-2">
              {TONES.map((tn) => (
                <button
                  key={tn.key}
                  type="button"
                  onClick={() => setTone(tn.key)}
                  disabled={!canEdit}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tone === tn.key ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
                >
                  <span className={`size-3.5 rounded-full ${tn.className}`} />
                  {tn.label}
                </button>
              ))}
            </div>
          </div>

          {/* live preview */}
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Önizleme</p>
            <div className={`rounded-xl border-l-4 bg-card p-3 shadow-sm ${tone === 'gold' ? 'border-amber-500' : tone === 'good' ? 'border-emerald-600' : 'border-primary'}`}>
              <p className="text-sm font-semibold">{title || 'Başlık'}</p>
              <p className="text-sm text-muted-foreground">{body || 'Metin buraya gelecek.'}</p>
            </div>
          </div>

          {canEdit ? (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : null} Kaydet
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Banner'ı yalnızca işletme sahibi düzenleyebilir.</p>
          )}
        </div>
      </Section>
    </div>
  )
}
