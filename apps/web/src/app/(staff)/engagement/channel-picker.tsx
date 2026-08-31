'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { audienceReachAction } from '@/server/actions/notifications'

import type { Audience } from './audience-panel'

// NEREDEN GİTSİN (owner, 2026-08-31).
//
// Eskiden üç seçenekli tek bir sıraydı: *Ayardaki kanallar · Sadece WhatsApp · Sadece e-posta*. İki
// kusuru vardı ve owner ikisini de aynı cümlede yakaladı — *"uygulama içi seçsek de whatsapp yine
// seçili geliyor"*:
//
//   1. UYGULAMA İÇİ HİÇ YOKTU. "Sadece uygulamaya düşsün" demenin bir yolu yoktu, çünkü tek "hepsi"
//      seçeneği stüdyo ayarındaki her kanalı kapsıyordu ve WhatsApp orada açıktı.
//   2. SEÇİM, SONUCU SÖYLEMİYORDU. "Sadece e-posta" 130 üyeye değil 18'ine gitmek demekti — bunu
//      ancak önizlemede, yani seçim yapıldıktan SONRA görebiliyordun.
//
// Artık her kanal kendi kutusu ve yanında **kaç kişiye ulaşacağı** yazıyor. Uygulama içi bir kutu
// değil: kapatılamaz, ve neden kapatılamadığı orada yazıyor. Bir onay kutusu gibi gösterip sonra
// sunucuda geri açmak, kullanıcıya yalan söyleyen bir arayüzdür.

/** Gönderilebilir kanallar. `in_app` burada YOK — o bir seçim değil. */
export const SENDABLE = ['whatsapp', 'email', 'push'] as const
export type Sendable = (typeof SENDABLE)[number]

const META: Record<Sendable, { icon: string; name: string; why: (reach: number, total: number) => string }> = {
  whatsapp: {
    icon: '💬',
    name: 'WhatsApp',
    why: (r, t) => (t > r ? `${t - r} üyenin kampanya izni yok` : 'Kampanya izni olan üyelere'),
  },
  email: {
    icon: '✉️',
    name: 'E-posta',
    why: (r, t) => (t > r ? `${t - r} üyenin e-posta adresi yok` : 'Adresi olan üyelere'),
  },
  push: {
    icon: '🔔',
    name: 'Telefon bildirimi',
    why: () => 'Uygulamayı yüklemiş ve izin vermiş üyeler',
  },
}

export function ChannelPicker({
  audience,
  total,
  selected,
  onChange,
}: {
  audience: Audience
  /** Kitledeki kişi sayısı — "kaçına ulaşamıyoruz"u hesaplamak için. */
  total: number
  selected: readonly Sendable[]
  onChange: (next: Sendable[]) => void
}) {
  const [reach, setReach] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let iptal = false
    setReach(null)
    const input = audience.kind === 'segment' ? { segment: audience.key } : { groupId: audience.id }
    void audienceReachAction(input)
      .then((r) => !iptal && setReach(r))
      .catch(() => !iptal && setReach({}))
    return () => {
      iptal = true
    }
  }, [audience])

  const toggle = (c: Sendable) =>
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c])

  return (
    <div className="space-y-2">
      {/* Kilitli satır. Bilerek bir onay kutusu DEĞİL — kapatılamayan bir şeyi kapatılabilirmiş gibi
          göstermek, arayüzün söyleyebileceği en sinsi yalandır. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-3.5 py-3">
        <span className="w-5 shrink-0 text-center text-lg" aria-hidden>
          📱
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Uygulama içi bildirim</div>
          <div className="text-xs text-muted-foreground">Üyenin kendi hesap geçmişi — kapatılamaz</div>
        </div>
        <span className="ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          her zaman açık
        </span>
      </div>

      {SENDABLE.map((c) => {
        const acik = selected.includes(c)
        const n = reach?.[c]
        return (
          <label
            key={c}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
              acik ? 'border-primary bg-primary-soft/40' : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <Checkbox checked={acik} onCheckedChange={() => toggle(c)} />
            <span className="w-5 shrink-0 text-center text-lg" aria-hidden>
              {META[c].icon}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{META[c].name}</div>
              <div className="text-xs text-muted-foreground">
                {n === undefined ? '…' : META[c].why(n, total)}
              </div>
            </div>
            <span className="ml-auto shrink-0 text-right">
              {n === undefined ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <b className="block text-[15px] tabular-nums text-foreground">{n}</b>
                  <span className="block text-[11px] text-muted-foreground">ulaşır</span>
                </>
              )}
            </span>
          </label>
        )
      })}

      {selected.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Hiçbiri seçili değil — mesaj <b className="text-foreground">yalnızca uygulamaya</b> düşecek. Kimseye
          WhatsApp ya da e-posta gitmez.
        </p>
      ) : null}
    </div>
  )
}
