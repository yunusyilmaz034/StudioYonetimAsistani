'use client'

import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'

// Registers the service worker (Android install prompt) and, on iOS Safari where there is no prompt,
// shows a one-time "Ana Ekrana Ekle" hint so reception can install the panel from the shared link.
export function PwaSetup() {
  const [iosHint, setIosHint] = useState(false)
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {})
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    if (isIos && !standalone && localStorage.getItem('pwa_hint_dismissed') !== '1') setIosHint(true)
  }, [])

  if (!iosHint) return null
  return (
    <div className="fixed inset-x-3 bottom-20 z-50 flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-lg md:hidden">
      <div className="flex-1">
        <p className="text-sm font-semibold">Uygulama gibi kullan 📲</p>
        <p className="text-xs text-muted-foreground">Paylaş menüsü → <b>Ana Ekrana Ekle</b> ile paneli tam ekran kur.</p>
      </div>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem('pwa_hint_dismissed', '1')
          setIosHint(false)
        }}
        aria-label="Kapat"
        className="text-muted-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
