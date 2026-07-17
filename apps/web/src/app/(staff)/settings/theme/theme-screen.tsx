'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
  FONT_FAMILIES,
  CATEGORY_DEFAULT,
  CATEGORY_KEYS,
  CATEGORY_LABEL,
  FONT_SCALES,
  SURFACE_DEFAULT,
  SURFACE_KEYS,
  SURFACE_LABEL,
  THEME_PRESETS,
  themeCss,
  type CategoryKey,
  type FontFamilyId,
  type FontScale,
  type StudioTheme,
  type SurfaceKey,
} from '@/lib/theme/presets'
import { updateStudioThemeAction } from '@/server/actions/theme'

const PREVIEW_ID = 'studio-theme-preview'

// Ayarlar › Tema (PF-12) — pick a curated palette + type size and see it apply live before saving. The
// preview is a style tag we keep in sync; on save it is persisted and injected server-side on next load.
// `embedded` renders the editor inline (inside the settings Görünüm tab) without its own page chrome —
// clicking the tab shows the theme controls directly, no second screen (owner, 2026-07-17).
export function ThemeScreen({ initial, embedded = false }: { initial: StudioTheme; embedded?: boolean }) {
  const [presetId, setPresetId] = useState(initial.presetId)
  const [fontScale, setFontScale] = useState<FontScale>(initial.fontScale)
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(initial.fontFamily)
  const [categories, setCategories] = useState<Record<CategoryKey, string | null>>(initial.categories)
  const [surfaces, setSurfaces] = useState<Record<SurfaceKey, string | null>>(initial.surfaces)
  const [busy, setBusy] = useState(false)

  const catsDiffer = CATEGORY_KEYS.some((k) => categories[k] !== initial.categories[k])
  const surfDiffer = SURFACE_KEYS.some((k) => surfaces[k] !== initial.surfaces[k])
  const dirty =
    presetId !== initial.presetId ||
    fontScale !== initial.fontScale ||
    fontFamily !== initial.fontFamily ||
    catsDiffer ||
    surfDiffer
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    let el = document.getElementById(PREVIEW_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = PREVIEW_ID
      document.head.appendChild(el)
    }
    el.textContent = themeCss({ presetId, fontScale, fontFamily, categories, surfaces })
  }, [presetId, fontScale, fontFamily, categories, surfaces])

  // Left the screen with the change unsaved? Don't keep the preview applied for the rest of the session.
  useEffect(
    () => () => {
      if (dirtyRef.current) document.getElementById(PREVIEW_ID)?.remove()
    },
    [],
  )

  async function save() {
    setBusy(true)
    try {
      await updateStudioThemeAction({ presetId, fontScale, fontFamily, categories, surfaces })
      dirtyRef.current = false
      toast.success('Tema kaydedildi.')
    } catch {
      toast.error('Tema kaydedilemedi.')
    }
    setBusy(false)
  }

  const content = (
    <>
      <Section title="Renk" hint="Ana vurgu rengi. Nötr zemin ve kontrast korunur; seçenekler el ile ayarlanmıştır.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => {
            const on = p.id === presetId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                aria-pressed={on}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-sm transition-colors ${
                  on ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:bg-muted'
                }`}
              >
                <span className="size-7 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: p.primary }} />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {on ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Yazı boyutu">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FONT_SCALES) as FontScale[]).map((s) => (
            <Button key={s} variant={s === fontScale ? 'default' : 'outline'} size="sm" onClick={() => setFontScale(s)}>
              {FONT_SCALES[s].label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Yazı tipi" hint="Sistemde her zaman bulunan seçenekler; ileride daha fazla yazı tipi eklenebilir.">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FONT_FAMILIES) as FontFamilyId[]).map((f) => (
            <Button key={f} variant={f === fontFamily ? 'default' : 'outline'} size="sm" onClick={() => setFontFamily(f)}>
              {FONT_FAMILIES[f].label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Ders tipi renkleri" hint="Takvimde her ders tipinin rengi. Boş bırakılırsa varsayılan kullanılır.">
        <div className="space-y-2">
          {CATEGORY_KEYS.map((k) => {
            const value = categories[k] ?? CATEGORY_DEFAULT[k]
            const custom = categories[k] !== null
            return (
              <div key={k} className="flex items-center gap-3">
                <input
                  type="color"
                  value={value}
                  onChange={(e) => setCategories((c) => ({ ...c, [k]: e.target.value }))}
                  aria-label={`${CATEGORY_LABEL[k]} rengi`}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                />
                <span className="flex-1 text-sm font-medium">{CATEGORY_LABEL[k]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
                {custom ? (
                  <Button variant="ghost" size="sm" onClick={() => setCategories((c) => ({ ...c, [k]: null }))}>
                    Sıfırla
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Yüzey renkleri" hint="Kenar çubuğu ve ajanda hücresinin zemini. Boş bırakılırsa varsayılan.">
        <div className="space-y-2">
          {SURFACE_KEYS.map((k) => {
            const value = surfaces[k] ?? SURFACE_DEFAULT[k]
            const custom = surfaces[k] !== null
            return (
              <div key={k} className="flex items-center gap-3">
                <input
                  type="color"
                  value={value}
                  onChange={(e) => setSurfaces((s) => ({ ...s, [k]: e.target.value }))}
                  aria-label={`${SURFACE_LABEL[k]} rengi`}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                />
                <span className="flex-1 text-sm font-medium">{SURFACE_LABEL[k]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
                {custom ? (
                  <Button variant="ghost" size="sm" onClick={() => setSurfaces((s) => ({ ...s, [k]: null }))}>
                    Sıfırla
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Önizleme" hint="Değişiklik anında burada (ve tüm ekranda) görünür — kaydedene kadar kalıcı olmaz.">
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Birincil</Button>
            <Button size="sm" variant="outline">
              İkincil
            </Button>
            <Badge className="bg-primary-soft text-primary">Etiket</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Bu, üyelerin ve resepsiyonun gördüğü renk ve yazı boyutudur. Örnek bir cümle ile nasıl durduğunu görün.
          </p>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {dirty ? <span className="text-sm text-muted-foreground">Kaydedilmemiş değişiklik var</span> : null}
        <Button onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
        </Button>
      </div>
    </>
  )

  if (embedded) return <div className="space-y-6">{content}</div>

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Tema"
        description="Uygulamanın rengi ve yazı boyutu — stüdyonuza göre"
        actions={
          <Button variant="outline" size="sm" render={<Link href="/settings" />}>
            <ArrowLeftIcon />
            Ayarlar
          </Button>
        }
      />
      {content}
    </main>
  )
}
