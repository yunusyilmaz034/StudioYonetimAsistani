'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import {
  BellIcon,
  CalendarPlusIcon,
  ClipboardListIcon,
  DumbbellIcon,
  GaugeIcon,
  HomeIcon,
  LogOutIcon,
  QrCodeIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react'

import { ThemeToggle } from '@/components/theme-toggle'
import { clientAuth } from '@/lib/firebase-client'
import { destroySession } from '@/server/actions/session'

// The MEMBER portal shell. It shares the design system with the staff app and NOTHING else: no
// sidebar, no owner navigation, no staff header. Those live in `(staff)/layout.tsx` and never
// enter this render tree — a member's HTML does not contain them at all, which is a far stronger
// guarantee than hiding them with CSS.
//
// Mobile: a bottom bar (she is on a phone, standing in the studio).
// Desktop: the same destinations as a quiet top nav; the bottom bar is not rendered at all.
const ITEMS: readonly { href: string; label: string; short: string; icon: LucideIcon }[] = [
  { href: '/portal', label: 'Ana Sayfa', short: 'Ana', icon: HomeIcon },
  { href: '/portal/agenda', label: 'Rezervasyon Yap', short: 'Rezervasyon', icon: CalendarPlusIcon },
  { href: '/portal/reservations', label: 'Rezervasyonlarım', short: 'Rezervasyonlarım', icon: ClipboardListIcon },
  { href: '/portal/training', label: 'Antrenmanım', short: 'Antrenman', icon: DumbbellIcon },
  { href: '/portal/fitness', label: 'Katılımım', short: 'Katılım', icon: GaugeIcon },
  { href: '/portal/qr', label: 'QR Kodum', short: 'QR', icon: QrCodeIcon },
  { href: '/portal/wallet', label: 'Cüzdanım', short: 'Cüzdan', icon: WalletIcon },
  { href: '/portal/messages', label: 'Bildirimler', short: 'Bildirim', icon: BellIcon },
  { href: '/portal/profile', label: 'Profil', short: 'Profil', icon: UserIcon },
]

const isActive = (pathname: string, href: string) =>
  href === '/portal' ? pathname === '/portal' : pathname.startsWith(href)

export function MemberPortalShell({
  studioId,
  memberName,
  children,
}: {
  studioId: string
  memberName: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await destroySession()
    await signOut(clientAuth())
    // Her door — never the staff login.
    router.replace(`/portal/login?s=${encodeURIComponent(studioId)}`)
  }

  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal" className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-xs">
              S
            </span>
            <span className="text-sm font-semibold text-foreground">Studio</span>
          </Link>

          {/* Desktop: the destinations live up here, which is why no bottom bar is needed. Eight labelled
              links crowd a narrow desktop — a single scrollable row keeps them tidy (PF-10). */}
          <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ITEMS.map((it) => {
              const on = isActive(pathname, it.href)
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={on ? 'page' : undefined}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    on
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {it.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle className="text-muted-foreground" />
            <Link
              href="/portal/profile"
              className="hidden max-w-40 truncate text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              {memberName}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOutIcon className="size-4" />
              <span className="hidden sm:inline">Çıkış</span>
            </button>
          </div>
        </div>
      </header>

      {children}

      {/* Mobile only — not rendered at md and above. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden">
        {ITEMS.map((it) => {
          const Icon = it.icon
          const on = isActive(pathname, it.href)
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={on ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[10px] font-medium transition-colors ${
                on ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className={`grid size-7 place-items-center rounded-lg ${on ? 'bg-primary-soft' : ''}`}>
                <Icon className="size-[1.15rem]" />
              </span>
              <span className="max-w-full truncate">{it.short}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
