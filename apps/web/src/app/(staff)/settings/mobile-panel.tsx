'use client'

import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, CropIcon, ImageIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { MediaPicker } from '@/components/media-picker'
import { ImageCropDialog, type CropTransform } from '@/components/image-crop-dialog'
import { getMobileSettingsAction, setMobileBannersAction, setMobileBrandingAction, setMobileCampaignAction, uploadMobileImageAction } from '@/server/actions/mobile-settings'

// The frames the phone actually renders, measured from the app rather than guessed. The home banner
// card is `screen − 40pt` wide with a 148pt floor, which on the widest device is 400×160pt — 2.5:1,
// 1200px at @3x. The popup's aspect ratio is hard-coded to 1 in campaign-popup.tsx, so anything else
// is cropped there no matter what is uploaded.
const BANNER_FRAME = { aspect: 2.5, width: 1200 }
const POPUP_FRAME = { aspect: 1, width: 1080 }

// A small "Medya" button that opens the Media Center picker (upload or choose existing) and drops the
// chosen URL into a field.
// Uploads the cropped canvas and returns its permanent URL. The ORIGINAL is left exactly where it
// was — the crop is an additional file, so re-editing never has to reconstruct anything.
async function uploadCropped(dataUrl: string, kind: 'banner' | 'campaign'): Promise<string | null> {
  const r = await uploadMobileImageAction({ dataUrl, kind })
  if (!r.ok) {
    toast.error(r.error.code === 'image_too_large' ? 'Görsel çok büyük.' : 'Görsel yüklenemedi.')
    return null
  }
  return r.value.url
}

function MediaButton({ onPick, disabled }: { onPick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onPick} disabled={disabled}>
      <ImageIcon className="size-4" /> Medya
    </Button>
  )
}

type Tone = 'accent' | 'gold' | 'good'
const TONES: { key: Tone; label: string; className: string }[] = [
  { key: 'accent', label: 'Vurgu', className: 'bg-primary' },
  { key: 'gold', label: 'Altın', className: 'bg-amber-500' },
  { key: 'good', label: 'Yeşil', className: 'bg-emerald-600' },
]

// One banner in the panel's editable list. `id` is a stable key so reorder/remove never scramble React.
interface EditBanner {
  id: string
  active: boolean
  title: string
  body: string
  detail: string
  tone: Tone
  imageUrl: string
  imageSourceUrl: string
  imageCrop?: CropTransform | undefined
}

// Curated, freely-usable (Pexels) fitness/pilates photos for a women-only studio — one tap to preview
// the image banner. The owner replaces these with her own studio photos.
const EXAMPLE_IMAGES: { url: string; label: string }[] = [
  { url: 'https://images.pexels.com/photos/25599825/pexels-photo-25599825.jpeg?auto=compress&cs=tinysrgb&w=1200', label: 'Reformer Pilates' },
  { url: 'https://images.pexels.com/photos/3823039/pexels-photo-3823039.jpeg?auto=compress&cs=tinysrgb&w=1200', label: 'Pilates / Yoga' },
  { url: 'https://images.pexels.com/photos/28080/pexels-photo.jpg?auto=compress&cs=tinysrgb&w=1200', label: 'Fitness' },
]

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b${Date.now()}${Math.round(Math.random() * 1e6)}`

// Ayarlar → Mobil. Everything the owner controls in the member app is collected here: the app branding,
// the home-screen banner carousel (several, swipeable, each with a tap-through detail page), and the
// open-screen campaign popup.
export function MobilePanel({ canEdit }: { canEdit: boolean }) {
  const [banners, setBanners] = useState<EditBanner[]>([])
  const [appName, setAppName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [campActive, setCampActive] = useState(false)
  const [campImage, setCampImage] = useState('')
  const [campSource, setCampSource] = useState('')
  const [campCrop, setCampCrop] = useState<CropTransform | undefined>(undefined)
  const [cropping, setCropping] = useState<
    null | { src: string; aspect: number; width: number; title: string; hint?: string; initial?: CropTransform; kind: 'banner' | 'campaign'; apply: (url: string, c: CropTransform) => void }
  >(null)
  const [campTitle, setCampTitle] = useState('')
  const [campCta, setCampCta] = useState('')
  const [campUrl, setCampUrl] = useState('')
  const [savingCamp, setSavingCamp] = useState(false)
  const [picker, setPicker] = useState<((url: string) => void) | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingBrand, setSavingBrand] = useState(false)

  useEffect(() => {
    getMobileSettingsAction()
      .then((s) => {
        setBanners(
          (s.banners ?? []).map((b) => ({
            id: b.id ?? newId(),
            active: b.active,
            title: b.title,
            body: b.body,
            detail: b.detail ?? '',
            tone: b.tone,
            imageUrl: b.imageUrl ?? '',
            imageSourceUrl: b.imageSourceUrl ?? '',
            ...(b.imageCrop ? { imageCrop: b.imageCrop } : {}),
          })),
        )
        if (s.branding) { setAppName(s.branding.appName); setLogoUrl(s.branding.logoUrl) }
        if (s.campaign) { setCampActive(s.campaign.active); setCampImage(s.campaign.imageUrl); setCampSource(s.campaign.imageSourceUrl ?? ''); setCampCrop(s.campaign.imageCrop); setCampTitle(s.campaign.title); setCampCta(s.campaign.ctaLabel); setCampUrl(s.campaign.ctaUrl) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patchBanner(id: string, patch: Partial<EditBanner>) {
    setBanners((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }
  function addBanner() {
    setBanners((list) => [...list, { id: newId(), active: true, title: '', body: '', detail: '', tone: 'accent', imageUrl: '', imageSourceUrl: '' }])
  }
  function removeBanner(id: string) {
    setBanners((list) => list.filter((b) => b.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    setBanners((list) => {
      const i = list.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  async function saveCampaign() {
    setSavingCamp(true)
    try {
      const r = await setMobileCampaignAction({
        active: campActive,
        imageUrl: campImage.trim(),
        imageSourceUrl: campSource.trim(),
        ...(campCrop ? { imageCrop: campCrop } : {}),
        title: campTitle.trim(),
        ctaLabel: campCta.trim(),
        ctaUrl: campUrl.trim(),
      })
      if (r.ok) toast.success('Kampanya popup kaydedildi.')
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setSavingCamp(false)
  }

  async function saveBranding() {
    setSavingBrand(true)
    try {
      const r = await setMobileBrandingAction({ appName: appName.trim(), logoUrl: logoUrl.trim() })
      if (r.ok) toast.success('Uygulama markası kaydedildi.')
    } catch {
      toast.error('Kaydedilemedi. Sayfayı yenileyip tekrar deneyin.')
    }
    setSavingBrand(false)
  }

  async function saveBanners() {
    const bad = banners.find((b) => b.active && (b.title.trim().length === 0 || b.body.trim().length === 0))
    if (bad) {
      toast.error('Açık banner’larda başlık ve metin dolu olmalı.')
      return
    }
    setSaving(true)
    try {
      const payload = banners.map((b) => ({
        id: b.id,
        active: b.active,
        title: b.title.trim(),
        body: b.body.trim(),
        tone: b.tone,
        imageUrl: b.imageUrl.trim(),
        imageSourceUrl: b.imageSourceUrl.trim(),
        ...(b.imageCrop ? { imageCrop: b.imageCrop } : {}),
        detail: b.detail.trim(),
      }))
      const r = await setMobileBannersAction({ banners: payload })
      if (r.ok) toast.success('Banner’lar kaydedildi.')
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2Icon className="animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-6">
      <Section title="Uygulama markası" hint="Üyelerin giriş ekranında ve ana sayfada gördüğü uygulama adı ve logo. Logo herkese açık bir görsel URL'i olmalı (örn. web sitenizdeki logo).">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Uygulama adı</label>
            <Input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={60} placeholder="Pilates Fitness By Işıl" disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Logo <span className="font-normal text-muted-foreground">(yükle ya da URL)</span></label>
            <div className="flex gap-2">
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://.../logo.png ya da yükle →" disabled={!canEdit} />
              <MediaButton onPick={() => setPicker(() => setLogoUrl)} disabled={!canEdit} />
            </div>
          </div>
          {logoUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <img src={logoUrl} alt="logo" className="size-12 rounded-lg object-contain" />
              <span className="text-sm text-muted-foreground">Logo önizleme</span>
            </div>
          ) : null}
          {canEdit ? (
            <Button onClick={() => void saveBranding()} disabled={savingBrand}>
              {savingBrand ? <Loader2Icon className="animate-spin" /> : null} Markayı Kaydet
            </Button>
          ) : null}
        </div>
      </Section>

      <Section
        title="Ana sayfa banner’ları"
        hint="Üyelerin uygulamayı açtığında en üstte gördüğü, sağa-sola kayan kartlar. Her banner’a bir görsel + kısa metin, bastığında açılan detay sayfası için uzun metin ekleyebilirsin. Kapalı banner görünmez."
      >
        <div className="space-y-4">
          {banners.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz banner yok. “Banner Ekle” ile ilk kartını oluştur.</p>
          ) : (
            banners.map((b, i) => (
              <BannerEditor
                key={b.id}
                banner={b}
                index={i}
                count={banners.length}
                canEdit={canEdit}
                onChange={(patch) => patchBanner(b.id, patch)}
                onRemove={() => removeBanner(b.id)}
                onMove={(dir) => move(b.id, dir)}
                onPickImage={() => setPicker(() => (url: string) => patchBanner(b.id, { imageUrl: url, imageSourceUrl: url, imageCrop: undefined }))}
                onCrop={() =>
                  setCropping({
                    src: b.imageSourceUrl || b.imageUrl,
                    aspect: BANNER_FRAME.aspect,
                    width: BANNER_FRAME.width,
                    title: 'Banner görselini hizala',
                    kind: 'banner' as const,
                    ...(b.imageCrop ? { initial: b.imageCrop } : {}),
                    apply: (url: string, crop: CropTransform) => patchBanner(b.id, { imageUrl: url, imageSourceUrl: b.imageSourceUrl || b.imageUrl, imageCrop: crop }),
                  })
                }
              />
            ))
          )}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={addBanner} disabled={banners.length >= 10}>
                <PlusIcon className="size-4" /> Banner Ekle
              </Button>
              <Button onClick={() => void saveBanners()} disabled={saving}>
                {saving ? <Loader2Icon className="animate-spin" /> : null} Kaydet
              </Button>
              {banners.length >= 10 ? <span className="text-xs text-muted-foreground">En fazla 10 banner.</span> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Banner’ları yalnızca işletme sahibi düzenleyebilir.</p>
          )}
        </div>
      </Section>

      <Section
        title="Kampanya popup'ı (açılışta)"
        hint="Uygulama açıldığında bir kez gösterilen tam görsel (ör. Instagram reklamı). Günde 1 kez; üye kapatınca susar. Kapalıyken çıkmaz."
      >
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <Checkbox checked={campActive} onCheckedChange={(v) => setCampActive(Boolean(v))} disabled={!canEdit} />
            <span className="text-sm font-medium">Popup'ı üyelere göster</span>
          </label>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Görsel <span className="font-normal text-muted-foreground">(kare — yükle ya da URL)</span></label>
            <div className="flex gap-2">
              <Input
                value={campImage}
                onChange={(e) => { setCampImage(e.target.value); setCampSource(e.target.value); setCampCrop(undefined) }}
                placeholder="https://.../kampanya.jpg ya da yükle →"
                disabled={!canEdit}
              />
              <MediaButton onPick={() => setPicker(() => (url: string) => { setCampImage(url); setCampSource(url); setCampCrop(undefined) })} disabled={!canEdit} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || !campImage}
                onClick={() =>
                  setCropping({
                    src: campSource || campImage,
                    aspect: POPUP_FRAME.aspect,
                    width: POPUP_FRAME.width,
                    title: 'Popup görselini hizala',
                    hint: 'Popup her zaman KARE gösterilir. Kare olmayan bir görselin üstü ve altı kesilir — burada hangi kısmın kalacağını seç.',
                    kind: 'campaign' as const,
                    ...(campCrop ? { initial: campCrop } : {}),
                    apply: (url: string, crop: CropTransform) => { setCampSource(campSource || campImage); setCampImage(url); setCampCrop(crop) },
                  })
                }
              >
                <CropIcon className="size-4" /> Hizala
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Uygulamada <strong>1:1 kare</strong> gösterilir (1080×1080 px). Dikey bir görsel yüklersen üstü ve altı kırpılır.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Başlık <span className="font-normal text-muted-foreground">(opsiyonel)</span></label>
              <Input value={campTitle} onChange={(e) => setCampTitle(e.target.value)} maxLength={80} placeholder="Yaz Kampanyası" disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Buton metni <span className="font-normal text-muted-foreground">(boş = buton yok)</span></label>
              <Input value={campCta} onChange={(e) => setCampCta(e.target.value)} maxLength={30} placeholder="Detaylar / WhatsApp" disabled={!canEdit} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Buton bağlantısı <span className="font-normal text-muted-foreground">(link ya da https://wa.me/90…)</span></label>
            <Input value={campUrl} onChange={(e) => setCampUrl(e.target.value)} placeholder="https://instagram.com/... ya da https://wa.me/90..." disabled={!canEdit} />
          </div>
          {campImage ? (
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Önizleme</p>
              <div className="mx-auto max-w-[240px] overflow-hidden rounded-2xl border bg-card shadow-sm">
                <img src={campImage} alt="kampanya" className="max-h-72 w-full object-cover" />
                {campTitle || campCta ? (
                  <div className="space-y-2 p-3">
                    {campTitle ? <p className="text-sm font-semibold">{campTitle}</p> : null}
                    {campCta ? <div className="rounded-lg bg-accent px-3 py-1.5 text-center text-sm font-semibold text-accent-foreground">{campCta}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {canEdit ? (
            <Button onClick={() => void saveCampaign()} disabled={savingCamp}>
              {savingCamp ? <Loader2Icon className="animate-spin" /> : null} Kaydet
            </Button>
          ) : null}
        </div>
      </Section>

      <MediaPicker open={!!picker} onOpenChange={(o) => !o && setPicker(null)} onSelect={(url) => { picker?.(url); setPicker(null) }} />

      {cropping ? (
        <ImageCropDialog
          open
          onOpenChange={(o) => !o && setCropping(null)}
          src={cropping.src}
          aspect={cropping.aspect}
          targetWidth={cropping.width}
          title={cropping.title}
          {...(cropping.hint ? { hint: cropping.hint } : {})}
          {...(cropping.initial ? { initial: cropping.initial } : {})}
          onApply={async (dataUrl, crop) => {
            const url = await uploadCropped(dataUrl, cropping.kind)
            if (!url) return
            cropping.apply(url, crop)
            toast.success('Hizalandı. Kaydetmeyi unutma.')
          }}
        />
      ) : null}
    </div>
  )
}

// One banner card in the list editor: active toggle, order controls, remove, all fields + a live preview.
function BannerEditor({
  banner,
  index,
  count,
  canEdit,
  onChange,
  onRemove,
  onMove,
  onPickImage,
  onCrop,
}: {
  banner: EditBanner
  index: number
  count: number
  canEdit: boolean
  onChange: (patch: Partial<EditBanner>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onPickImage: () => void
  onCrop: () => void
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-3">
          <Checkbox checked={banner.active} onCheckedChange={(v) => onChange({ active: Boolean(v) })} disabled={!canEdit} />
          <span className="text-sm font-medium">Banner {index + 1}{banner.active ? '' : ' (kapalı)'}</span>
        </label>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={() => onMove(-1)} disabled={index === 0} title="Yukarı taşı">
              <ChevronUpIcon className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => onMove(1)} disabled={index === count - 1} title="Aşağı taşı">
              <ChevronDownIcon className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} title="Sil">
              <Trash2Icon className="size-4 text-destructive" />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Başlık</label>
        <Input value={banner.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={80} placeholder="Örn. Yaz Kampanyası 🌸" disabled={!canEdit} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Kısa metin <span className="font-normal text-muted-foreground">(kartta görünür)</span></label>
        <Textarea value={banner.body} onChange={(e) => onChange({ body: e.target.value })} maxLength={240} rows={2} placeholder="Örn. Ağustos sonuna kadar 8 derslik pakette %20 indirim." disabled={!canEdit} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Detay metni <span className="font-normal text-muted-foreground">(opsiyonel — bastığında açılan sayfada görünür)</span></label>
        <Textarea value={banner.detail} onChange={(e) => onChange({ detail: e.target.value })} maxLength={2000} rows={4} placeholder="Kampanyanın tüm detayları, koşulları, tarihleri… Üye banner’a bastığında bu metni görür." disabled={!canEdit} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Görsel <span className="font-normal text-muted-foreground">(opsiyonel — yükle ya da URL yapıştır)</span></label>
        <div className="flex gap-2">
          <Input
            value={banner.imageUrl}
            onChange={(e) => onChange({ imageUrl: e.target.value, imageSourceUrl: e.target.value })}
            placeholder="https://.../kampanya.jpg ya da yükle →"
            disabled={!canEdit}
          />
          <MediaButton onPick={onPickImage} disabled={!canEdit} />
          <Button type="button" variant="outline" size="sm" onClick={onCrop} disabled={!canEdit || !banner.imageUrl}>
            <CropIcon className="size-4" /> Hizala
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Telefonda <strong>2,5:1</strong> orana kırpılır (1200×480 px). “Hizala” ile görselin hangi kısmının
          görüneceğini kendin seçebilirsin.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Örnek görsel:</span>
            {EXAMPLE_IMAGES.map((ex) => (
              <button
                key={ex.url}
                type="button"
                title={ex.label}
                onClick={() => onChange({ imageUrl: ex.url })}
                className={`size-12 overflow-hidden rounded-lg border transition-all ${banner.imageUrl === ex.url ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary'}`}
              >
                <img src={ex.url} alt={ex.label} className="size-full object-cover" />
              </button>
            ))}
            {banner.imageUrl ? (
              <button type="button" onClick={() => onChange({ imageUrl: '' })} className="text-xs text-muted-foreground underline">
                Görseli kaldır
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Renk <span className="font-normal text-muted-foreground">(görsel yoksa)</span></label>
        <div className="flex gap-2">
          {TONES.map((tn) => (
            <button
              key={tn.key}
              type="button"
              onClick={() => onChange({ tone: tn.key })}
              disabled={!canEdit}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${banner.tone === tn.key ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
            >
              <span className={`size-3.5 rounded-full ${tn.className}`} />
              {tn.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Önizleme</p>
        {banner.imageUrl ? (
          <div className="relative min-h-32 overflow-hidden rounded-xl shadow-sm">
            <img src={banner.imageUrl} alt="banner" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
            <div className="relative flex min-h-32 flex-col justify-end p-4 text-white">
              <p className="text-base font-semibold">{banner.title || 'Başlık'}</p>
              <p className="text-sm text-white/85">{banner.body || 'Metin buraya gelecek.'}</p>
            </div>
          </div>
        ) : (
          <div className={`rounded-xl border-l-4 bg-card p-3 shadow-sm ${banner.tone === 'gold' ? 'border-amber-500' : banner.tone === 'good' ? 'border-emerald-600' : 'border-primary'}`}>
            <p className="text-sm font-semibold">{banner.title || 'Başlık'}</p>
            <p className="text-sm text-muted-foreground">{banner.body || 'Metin buraya gelecek.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
