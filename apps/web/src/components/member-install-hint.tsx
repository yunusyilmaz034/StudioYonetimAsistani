'use client'

import { useEffect, useState } from 'react'
import { ShareIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

// "Ana Ekrana Ekle" — the reason the rollout does not need an app store.
//
// The studio's members are being invited to a LINK, and a link that lives in a browser tab gets
// lost. Installed to the home screen it opens full-screen from an icon, which is what a member
// means by "the app". So the hint is shown to HER, on her own phone, by the code that can actually
// tell which phone it is — instead of reception guessing iPhone vs Android over WhatsApp.
//
// Android/Chrome fires `beforeinstallprompt`, so she gets a real one-tap install button. iOS Safari
// has no such event — there the only path is Share → Add to Home Screen, so we say exactly that.
// Already installed (standalone) ⇒ nothing is shown.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'member_install_hint_dismissed'

export function MemberInstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === '1') return

    const standalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    if (standalone) return

    const onPrompt = (e: Event) => {
      e.preventDefault() // keep it, fire it on HER tap — Chrome ignores a prompt() without a gesture
      setPrompt(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS: no install event exists, and Safari is the only browser that can install. Chrome/Firefox
    // on iOS would show a hint the member cannot act on.
    const ua = navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua)
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
    if (isIos && isSafari) setIosHint(true)

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setPrompt(null)
    setIosHint(false)
  }

  if (!prompt && !iosHint) return null

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg md:mx-auto md:max-w-md">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Telefonuna ekle 📲</p>
        {prompt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Tek dokunuşla ana ekranına eklensin, uygulama gibi açılsın.</p>
        ) : (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Aşağıdaki <ShareIcon className="inline size-3.5" /> Paylaş düğmesine bas, <b>Ana Ekrana Ekle</b>&apos;yi seç.
          </p>
        )}
        {prompt ? (
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              void prompt.prompt().then(() => dismiss())
            }}
          >
            Ana ekrana ekle
          </Button>
        ) : null}
      </div>
      <button type="button" onClick={dismiss} aria-label="Kapat" className="shrink-0 text-muted-foreground">
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
