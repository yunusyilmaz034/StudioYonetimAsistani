'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

// ── HOW THIS BEHAVES, AND WHY ───────────────────────────────────────────────────────────────
//
// Two rhythms, deliberately different:
//
//   · a new CODE every ~30s — it lives 45s server-side, so this renews with room to spare and the
//     corridor never has more than one live code on the glass at a time.
//   · a STATUS poll every 1.5s — how quickly the greeting appears after she scans. Faster feels
//     magic; slower feels broken. It costs one small read.
//
// The device's credentials live in this browser's localStorage, entered once at setup. That is the
// same secret the server checks (`deviceHeartbeatAuth`): the machine on the wall IS the principal,
// and the check-in it produces says `actor: device` rather than borrowing a receptionist's name.
//
// SOUND. Browsers refuse to play audio until the page has been touched once — so the screen opens
// with a start button. That is not a design choice, it is the rule; a kiosk that never gets tapped
// is a kiosk that is silent forever, and nobody would work out why.

const STORE_KEY = 'kapi.device'
const CODE_EVERY_MS = 30_000
const POLL_EVERY_MS = 1_500
const GREET_FOR_MS = 4_500

type Crossed = { firstName: string; at: number }

export function KapiScreen() {
  const [creds, setCreds] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [greet, setGreet] = useState<Crossed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastGreeted = useRef<number>(0)
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => setCreds(localStorage.getItem(STORE_KEY)), [])

  /** A short two-note chime. Synthesised so the screen carries no audio file and never 404s a sound. */
  const chime = useCallback(() => {
    const ctx = audio.current
    if (!ctx) return
    const now = ctx.currentTime
    for (const [i, hz] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, now + i * 0.13)
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.13 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.13 + 0.32)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.13)
      osc.stop(now + i * 0.13 + 0.35)
    }
  }, [])

  const call = useCallback(
    async (path: string, body: unknown) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${creds}` },
        body: JSON.stringify(body ?? {}),
      })
      return (await res.json()) as { ok: boolean; value?: unknown; error?: { code?: string } }
    },
    [creds],
  )

  // Mint the code, and draw it. The QR carries the six digits alone — that is exactly what the
  // member app's scanner expects, and a short payload survives a dirty screen and a cheap camera.
  const renew = useCallback(async () => {
    try {
      const r = await call('/api/turnstile', {})
      if (!r.ok) {
        setError(r.error?.code === 'qr_invalid' ? 'Cihaz tanınmadı' : 'Kod alınamadı')
        return
      }
      const next = (r.value as { code: string }).code
      setCode(next)
      setQr(await QRCode.toDataURL(next, { width: 720, margin: 1, errorCorrectionLevel: 'M' }))
      setError(null)
    } catch {
      setError('Bağlantı yok')
    }
  }, [call])

  useEffect(() => {
    if (!creds || !started) return
    void renew()
    const t = setInterval(() => void renew(), CODE_EVERY_MS)
    return () => clearInterval(t)
  }, [creds, started, renew])

  useEffect(() => {
    if (!creds || !started || !code) return
    const t = setInterval(async () => {
      try {
        const r = await call('/api/turnstile/status', { code })
        const crossed = (r.value as { crossed: Crossed | null } | undefined)?.crossed ?? null
        // `at` guards against greeting the same crossing twice while the code is still on screen.
        if (crossed && crossed.at !== lastGreeted.current) {
          lastGreeted.current = crossed.at
          setGreet(crossed)
          chime()
          void renew() // the code is spent; put a fresh one up behind the greeting
          setTimeout(() => setGreet(null), GREET_FOR_MS)
        }
      } catch {
        /* a dropped poll is not worth showing; the next one is 1.5s away */
      }
    }, POLL_EVERY_MS)
    return () => clearInterval(t)
  }, [creds, started, code, call, chime, renew])

  // ── SETUP: once, at installation ──
  if (creds === null) {
    return (
      <Shell>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('creds')
            if (typeof v === 'string' && v.includes('.')) {
              localStorage.setItem(STORE_KEY, v.trim())
              setCreds(v.trim())
            }
          }}
          style={{ display: 'grid', gap: 16, width: 'min(520px, 90vw)' }}
        >
          <h1 style={{ font: '600 26px system-ui', margin: 0 }}>Kapı ekranı kurulumu</h1>
          <p style={{ color: '#9aa4b2', margin: 0, lineHeight: 1.6 }}>
            Cihaz kimliğini ve gizli anahtarını <code>cihazKimligi.gizliAnahtar</code> biçiminde yapıştırın.
            Bu bilgi yalnızca bu ekranda saklanır.
          </p>
          <input
            name="creds"
            autoFocus
            placeholder="dev_xxx.gizli-anahtar"
            style={{ padding: '16px 18px', borderRadius: 12, border: '1px solid #2b3442', background: '#0f1520', color: '#fff', font: '15px ui-monospace, monospace' }}
          />
          <button type="submit" style={btn}>Kaydet</button>
        </form>
      </Shell>
    )
  }

  // ── The one tap browsers require before they will make a sound ──
  if (!started) {
    return (
      <Shell>
        <button
          onClick={() => {
            const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            audio.current = new AC()
            void audio.current.resume()
            setStarted(true)
          }}
          style={{ ...btn, padding: '22px 48px', fontSize: 20 }}
        >
          Ekranı başlat
        </button>
      </Shell>
    )
  }

  // ── WELCOME ──
  if (greet) {
    return (
      <Shell tone="#0b2a1b">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'clamp(56px, 11vw, 150px)', lineHeight: 1 }}>✓</div>
          <div style={{ font: '600 clamp(30px, 6vw, 76px)/1.15 system-ui', marginTop: 26 }}>
            Hoş geldin{greet.firstName ? `, ${greet.firstName}` : ''}
          </div>
          <div style={{ color: '#8fd6ab', marginTop: 14, fontSize: 'clamp(15px, 2vw, 24px)' }}>Kapı açıldı</div>
        </div>
      </Shell>
    )
  }

  // ── THE CODE ──
  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#9aa4b2', letterSpacing: 3, fontSize: 13, textTransform: 'uppercase', marginBottom: 26 }}>
          Uygulamandan okut
        </div>
        {qr ? (
          // A plain <img>: the source is a data: URL generated in this browser, so there is nothing
          // for an image optimiser to fetch, cache or resize.
          <img src={qr} alt="" width={360} height={360} style={{ borderRadius: 20, background: '#fff', padding: 16, width: 'min(46vh, 78vw)', height: 'auto' }} />
        ) : (
          <div style={{ width: 'min(46vh, 78vw)', aspectRatio: '1', borderRadius: 20, background: '#111a26' }} />
        )}
        <div style={{ marginTop: 28, font: '600 clamp(28px, 5vw, 56px)/1 ui-monospace, monospace', letterSpacing: 10 }}>
          {code ?? '······'}
        </div>
        {error ? <div style={{ marginTop: 22, color: '#ff9b9b', fontSize: 16 }}>{error}</div> : null}
      </div>
    </Shell>
  )
}

const btn: React.CSSProperties = {
  padding: '16px 26px',
  borderRadius: 12,
  border: 0,
  background: '#7B1E2E',
  color: '#fff',
  font: '600 16px system-ui',
  cursor: 'pointer',
}

function Shell({ children, tone = '#0a0f16' }: { children: React.ReactNode; tone?: string }) {
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: tone,
        color: '#fff',
        transition: 'background .35s ease',
        // A door screen is never scrolled and never selected from.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {children}
    </main>
  )
}
