import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2Icon, ClockIcon, LogOutIcon, XCircleIcon } from 'lucide-react'

import { domainErrorMessage } from '@/lib/domain-error'
import { getMemberClaims, requireMemberContext } from '@/server/auth'
import { checkInByPosterToken } from '@/server/actions/qr'
import { loadPortalProfile } from '@/server/portal-query'

// What the member's phone opens when she scans the sheet on the wall.
//
// This page lives OUTSIDE `/portal/(member)`, and that is not an accident. The guarded layout
// bounces a visitor with no session to `/portal/login` and drops everything it knew — including
// WHICH SHEET she scanned. She would then log in and land on a dashboard, having checked in to
// nothing, with no way to tell that it failed. So this route is public, checks the session itself,
// and hands the token to the login screen to come back to.
//
// The check-in happens on RENDER, server-side. No button: she has already made her intent clear by
// pointing a camera at a QR code, and the only thing a confirm button adds is one more tap between
// a woman holding a gym bag and the door.

export const dynamic = 'force-dynamic'

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

function Frame({ tone, children }: { tone: 'ok' | 'bad'; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <div
        className={`flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border-2 p-8 ${
          tone === 'ok' ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5'
        }`}
      >
        {children}
      </div>
      <Link href="/portal" className="text-sm font-medium text-muted-foreground underline underline-offset-4">
        Üyelik sayfama git
      </Link>
    </main>
  )
}

export default async function PosterCheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ s?: string }>
}) {
  const { token } = await params
  const { s } = await searchParams

  const claims = await getMemberClaims()
  if (!claims) {
    // Carry the sheet through the login. `next` is a path on this origin and is validated on the
    // other side — a scanned QR must never become an open redirect.
    const back = `/g/${encodeURIComponent(token)}${s ? `?s=${encodeURIComponent(s)}` : ''}`
    redirect(`/portal/login?s=${encodeURIComponent(s ?? '')}&next=${encodeURIComponent(back)}`)
  }

  const { ctx, memberId } = await requireMemberContext()
  const [profile, res] = await Promise.all([
    loadPortalProfile(ctx, memberId),
    checkInByPosterToken(ctx, memberId, decodeURIComponent(token)),
  ])
  const firstName = profile.fullName.split(' ')[0] ?? ''

  if (!res.ok) {
    return (
      <Frame tone="bad">
        <XCircleIcon className="size-14 text-danger" />
        <p className="text-h2 font-semibold">Giriş alınamadı</p>
        <p className="text-sm text-muted-foreground">{domainErrorMessage(res.error)}</p>
        <p className="text-xs text-muted-foreground">
          Resepsiyondaki kâğıt bugüne ait olmayabilir. Lütfen görevliye söyleyin.
        </p>
      </Frame>
    )
  }

  // A second scan is a check-OUT, not a failure — the door has always worked as a toggle.
  if (res.value.direction === 'out') {
    return (
      <Frame tone="ok">
        <LogOutIcon className="size-14 text-muted-foreground" />
        <p className="text-h2 font-semibold">Görüşmek üzere {firstName} 👋</p>
        <p className="text-sm text-muted-foreground">Çıkışınız alındı.</p>
      </Frame>
    )
  }

  const att = res.value.attendance
  const entry = res.value.entry

  return (
    <Frame tone="ok">
      <CheckCircle2Icon className="size-14 text-success" />
      <p className="text-h2 font-semibold">Hoş geldin {firstName} 🌸</p>
      <p className="text-sm text-muted-foreground">Girişin alındı.</p>

      {/* Said plainly, because the credit moved and she should learn that here rather than
          discover it in her wallet tomorrow. */}
      {att ? (
        <p className="flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-sm font-medium text-success">
          <ClockIcon className="size-4" />
          {hhmm(att.sessionStartsAt)} dersin için yoklaman alındı
          {att.creditConsumed ? ' · 1 ders hakkı kullanıldı' : ''}
        </p>
      ) : null}

      {entry ? (
        <p className="text-sm text-muted-foreground">
          Fitness girişi: {entry.used}/{entry.allowance}
        </p>
      ) : null}
    </Frame>
  )
}
