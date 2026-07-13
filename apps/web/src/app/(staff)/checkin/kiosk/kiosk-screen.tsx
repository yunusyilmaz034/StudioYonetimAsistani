'use client'

import { CheckIcon, SearchIcon, WifiOffIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { checkInCommand } from '@/lib/commands'
import { checkInByQrAction } from '@/server/actions/qr'
import type { BookingMember } from '@/server/actions/booking'
import type { CheckinState } from '@/server/checkin-query'

import { QrScanner } from '../qr-scanner'

// The kiosk. An iPad on a wall, operated by the member.
//
// ── The three rules ─────────────────────────────────────────────────────────────────────────
//   1. ONE thing on screen at a time. She is holding a phone and a water bottle.
//   2. It RESETS ITSELF. A kiosk still saying "Hoş geldin Ayşe" when Fatma walks up has told Fatma
//      who came before her.
//   3. It is HONEST about the internet. QR is verified on the server or it is not verified (D16), so
//      offline it says so and points at the desk — it does not scan a code it can do nothing with.

/** How long a result stays up before the kiosk forgets it. Long enough to read, short enough that the
 *  next member does not see it. */
const RESET_MS = 4_000

/** The same member, scanned twice by a camera running at 4 fps, is one arrival. */
const DEBOUNCE_MS = 4_000

type Result =
  | { readonly kind: 'welcome'; readonly name: string }
  | { readonly kind: 'goodbye'; readonly name: string }
  | { readonly kind: 'error'; readonly message: string }

export function KioskScreen({
  state,
  members,
}: {
  state: CheckinState
  members: readonly BookingMember[]
}) {
  const [result, setResult] = useState<Result | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [online, setOnline] = useState(true)

  const lastScan = useRef<Map<string, number>>(new Map())
  const insideIds = useMemo(() => new Set(state.inside.map((i) => i.memberId)), [state.inside])

  // The browser knows. It is not a guess, and it is the difference between "QR çalışmıyor, isimle
  // gir" and a member standing there holding up a phone at a camera that will never answer.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  // Rule 2: it resets itself. Nobody is standing here to clear the screen.
  useEffect(() => {
    if (!result) return
    const t = window.setTimeout(() => {
      setResult(null)
      setQuery('')
      setSearching(false)
    }, RESET_MS)
    return () => window.clearTimeout(t)
  }, [result])

  const scan = useCallback(
    async (token: string) => {
      if (!state.branchId || result) return

      const now = Date.now()
      const seen = lastScan.current.get(token)
      if (seen && now - seen < DEBOUNCE_MS) return
      lastScan.current.set(token, now)

      try {
        const res = await checkInByQrAction({ token, branchId: state.branchId })
        if (res.ok) setResult({ kind: 'welcome', name: res.value.memberName })
        else setResult({ kind: 'error', message: domainErrorMessage(res.error) })
      } catch {
        setResult({
          kind: 'error',
          message: 'Bağlantı yok. Lütfen resepsiyona başvurun.',
        })
      }
    },
    [state.branchId, result],
  )

  // The MANUAL path, and the reason it exists: it rides the OFFLINE `/commands` queue. When the wifi
  // drops, QR stops (a signature must be verified on the server), and this keeps the door working.
  const checkInByName = useCallback(
    async (member: BookingMember) => {
      const wasInside = insideIds.has(member.id)
      try {
        await checkInCommand({ memberId: member.id as never, method: 'reception' })
        setResult({
          kind: wasInside ? 'goodbye' : 'welcome',
          name: member.fullName,
        })
      } catch {
        setResult({ kind: 'error', message: 'Kaydedilemedi. Resepsiyona başvurun.' })
      }
    },
    [insideIds, state.branchId],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    if (q.length < 2) return []
    return members
      .filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q))
      .slice(0, 6) // a kiosk list you have to scroll is a kiosk list nobody reads
  }, [members, query])

  if (!state.isOpen) {
    return (
      <Shell>
        <p className="text-center text-h2 font-semibold">Stüdyo kapalı.</p>
        <p className="mt-2 text-center text-muted-foreground">Lütfen resepsiyona başvurun.</p>
      </Shell>
    )
  }

  // ── The result screen. One thing, big, and then it goes away. ─────────────────────────────
  if (result) {
    return (
      <Shell>
        <div className="text-center">
          {result.kind === 'welcome' ? (
            <>
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-success/15">
                <CheckIcon className="size-12 text-success" />
              </div>
              <p className="mt-6 text-display font-semibold">Hoş geldin</p>
              <p className="mt-1 text-h1 font-medium">{result.name}</p>
            </>
          ) : result.kind === 'goodbye' ? (
            <>
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-muted">
                <CheckIcon className="size-12 text-muted-foreground" />
              </div>
              <p className="mt-6 text-display font-semibold">Görüşürüz</p>
              <p className="mt-1 text-h1 font-medium">{result.name}</p>
            </>
          ) : (
            <>
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-danger/15">
                <XIcon className="size-12 text-danger" />
              </div>
              <p className="mt-6 text-h1 font-semibold">{result.message}</p>
            </>
          )}
        </div>
      </Shell>
    )
  }

  // ── Manual search — the offline path, and the one for a member who forgot her phone. ──────
  if (searching) {
    return (
      <Shell>
        <div className="w-full max-w-md">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Adınızı yazın"
            className="h-16 text-center text-h2"
          />

          <div className="mt-4 space-y-2">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void checkInByName(m)}
                className="flex min-h-16 w-full items-center justify-between rounded-xl border border-border px-5 text-left text-h3 font-medium hover:bg-muted"
              >
                {m.fullName}
                <span className="text-sm font-normal text-muted-foreground">
                  {insideIds.has(m.id) ? 'Çıkış' : 'Giriş'}
                </span>
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            className="mt-6 min-h-14 w-full text-base"
            onClick={() => {
              setSearching(false)
              setQuery('')
            }}
          >
            Geri
          </Button>
        </div>
      </Shell>
    )
  }

  // ── The camera. What a member sees when she walks in. ─────────────────────────────────────
  return (
    <Shell>
      <div className="w-full max-w-lg text-center">
        <h1 className="text-h1 font-semibold">QR kodunu okut</h1>
        <p className="mt-1 text-muted-foreground">Telefonundaki kodu kameraya göster.</p>

        {online ? (
          <div className="relative mt-6 overflow-hidden rounded-2xl">
            <QrScanner
              active
              onScan={(token) => void scan(token)}
              className="aspect-square w-full bg-black object-cover"
            />
            {/* A frame to aim at. A camera with no target is a camera people wave a phone at. */}
            <div className="pointer-events-none absolute inset-8 rounded-xl border-4 border-white/70" />
          </div>
        ) : (
          // Rule 3. QR is verified on the server or it is not verified (D16) — so offline it is not
          // a slower QR, it is no QR, and saying otherwise wastes her morning in front of a camera.
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-warning/30 bg-warning/5 p-10">
            <WifiOffIcon className="size-12 text-warning" />
            <p className="mt-4 text-h3 font-semibold">İnternet bağlantısı yok</p>
            <p className="mt-1 text-muted-foreground">
              QR okutma şu an çalışmıyor. Aşağıdan adınızla giriş yapabilirsiniz — kaydınız alınır.
            </p>
          </div>
        )}

        <Button
          variant="outline"
          className="mt-6 min-h-16 w-full text-h3"
          onClick={() => setSearching(true)}
        >
          <SearchIcon className="size-5" />
          Adımla giriş yap
        </Button>
      </div>
    </Shell>
  )
}

/** Fullscreen. No navigation: a member must not be one stray tap from the members list. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-8">
      {children}

      {/* The way out, for reception — deliberately small, in a corner, and boring. */}
      <Link
        href="/checkin"
        className="absolute bottom-4 right-4 text-sm text-muted-foreground/60 hover:text-muted-foreground"
      >
        Resepsiyon ekranı
      </Link>
    </div>
  )
}
