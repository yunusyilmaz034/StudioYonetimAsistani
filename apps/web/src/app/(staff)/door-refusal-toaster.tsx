'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { DoorClosedIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { recentDoorRefusalsAction, type DoorRefusal } from '@/server/actions/door-refusals'

// ── KAPIDA KALDI — ŞİMDİ (owner, 2026-10-08) ───────────────────────────────────────────────
//
// *"Turnikede uyarı veren, giriş yapamayan üye için panelde hemen en üstten popup çıkıp söylesin,
// dikkat çeksin."* `CheckInToaster` giren üyeyi söylüyordu; giremeyen sessizdi — oysa bekleyen o.
//
// Kırmızı, büyük ve KENDİLİĞİNDEN KAPANMIYOR: üye kapıda duruyor, ve masa o sırada başka bir işin
// ortasındaysa altı saniyelik bir bildirim hiç görülmemiş bir bildirimdir. Kapatmak bir tık.
//
// Soruyor, dinlemiyor (bkz. `recentDoorRefusalsAction`): olay günlüğü tarayıcıya açılmıyor. Sekme
// görünmezken sormuyor — arka plandaki on sekme on kat okuma demekti ve hiçbirini gören yoktu.

const POLL_MS = 6_000

const NEDEN: Record<string, string> = {
  no_class_now: 'Bu saatte rezervasyonlu dersi yok. Kapı, dersinden en erken 1 saat önce açılır.',
  no_credits_left: 'Paketindeki dersler bitmiş.',
  no_entries_left: 'Fitness giriş hakkı bitmiş.',
  no_active_membership: 'Geçerli bir paketi yok.',
}

function RefusedCard({ r, onClose }: { r: DoorRefusal; onClose: () => void }) {
  const saat = new Date(r.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
  return (
    <div role="alert" className="flex w-[26rem] max-w-[92vw] items-start gap-3 rounded-xl border-2 border-rose-500 bg-card p-4 shadow-2xl ring-4 ring-rose-500/20">
      <DoorClosedIcon className="mt-0.5 size-7 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-rose-600">{r.name} kapıda kaldı</p>
        <p className="text-sm text-foreground">{NEDEN[r.reason] ?? NEDEN.no_active_membership}</p>
        <div className="mt-2 flex items-center gap-3 text-sm">
          {r.memberId ? (
            <Link href={`/members/${r.memberId}`} onClick={onClose} className="font-medium text-primary underline-offset-2 hover:underline">
              Üyeyi aç
            </Link>
          ) : null}
          <span className="text-xs tabular-nums text-muted-foreground">{saat} · turnike</span>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Kapat" className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground">
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

export function DoorRefusalToaster() {
  useEffect(() => {
    let cursor: number | null = null
    let busy = false
    const seen = new Set<string>()

    async function tick(): Promise<void> {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const res = await recentDoorRefusalsAction({ cursor })
        cursor = res.cursor
        for (const r of res.refusals) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          // Aynı üye tekrar tekrar okutursa kartlar üst üste yığılmaz: kimlik üyenin, kart yenilenir.
          const id = `door-refused-${r.memberId || r.id}`
          toast.custom(() => <RefusedCard r={r} onClose={() => toast.dismiss(id)} />, { id, duration: Infinity })
        }
      } catch {
        // Bir sorgu düşerse bir sonraki dener; kapı uyarısı masanın geri kalanını bozmamalı.
      }
      busy = false
    }

    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    // Sekmeye dönülünce beklemeden sor: masa başka sekmedeyken kapıda kalan üye hemen görünsün.
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
