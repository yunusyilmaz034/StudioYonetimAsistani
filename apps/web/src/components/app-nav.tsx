'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import {
  CalendarClockIcon,
  CalendarIcon,
  ClipboardCheckIcon,
  DoorOpenIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PackageIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

import { clientAuth } from '@/lib/firebase-client'
import { destroySession } from '@/server/actions/session'

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: LucideIcon
}

// The persistent owner navigation (v1.19). Same destinations on desktop (left rail) and
// mobile (bottom bar). Styling is intentionally plain — the premium visual pass is v1.20.
const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Genel Görünüm', icon: LayoutDashboardIcon },
  { href: '/schedule', label: 'Ders Ajandası', icon: CalendarIcon },
  { href: '/reservations', label: 'Rezervasyon Ajandası', icon: CalendarClockIcon },
  { href: '/members', label: 'Üyeler', icon: UsersIcon },
  { href: '/checkin', label: 'Check-in', icon: DoorOpenIcon },
  { href: '/attendance', label: 'Yoklama', icon: ClipboardCheckIcon },
  { href: '/packages', label: 'Paketler', icon: PackageIcon },
]

const isActive = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

// Screens that render without the shell (their own full-page layout).
const BARE = (pathname: string): boolean => pathname === '/login' || pathname.startsWith('/design-system')

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (BARE(pathname)) return <>{children}</>
  return (
    <div className="min-h-dvh pb-16 md:pb-0 md:pl-56">
      <DesktopRail pathname={pathname} />
      <BottomBar pathname={pathname} />
      {children}
    </div>
  )
}

function useLogout() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const logout = async () => {
    setLoading(true)
    await destroySession()
    await signOut(clientAuth())
    router.replace('/login')
  }
  return { logout, loading }
}

function DesktopRail({ pathname }: { pathname: string }) {
  const { logout, loading } = useLogout()
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-surface md:flex">
      <div className="px-4 py-4">
        <p className="text-sm font-semibold text-foreground">Studio</p>
        <p className="text-xs text-muted-foreground">Yönetim Asistanı</p>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {ITEMS.map((it) => {
          const Icon = it.icon
          const on = isActive(pathname, it.href)
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {it.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={logout}
          disabled={loading}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOutIcon className="size-4 shrink-0" />
          Çıkış Yap
        </button>
      </div>
    </aside>
  )
}

function BottomBar({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-border bg-surface md:hidden">
      {ITEMS.map((it) => {
        const Icon = it.icon
        const on = isActive(pathname, it.href)
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex min-w-[4.5rem] flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] ${
              on ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="size-5" />
            <span className="max-w-full truncate">{it.label.split(' ')[0]}</span>
          </Link>
        )
      })}
    </nav>
  )
}
