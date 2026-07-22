'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import {
  ActivityIcon,
  BanknoteIcon,
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  LayersIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  MessageCircleIcon,
  ImageIcon,
  LightbulbIcon,
  SparklesIcon,
  ShieldIcon,
  TargetIcon,
  ShoppingCartIcon,
  WalletIcon,
  CalendarIcon,
  ClipboardCheckIcon,
  DumbbellIcon,
  DoorOpenIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PackageIcon,
  FileTextIcon,
  SearchIcon,
  SettingsIcon,
  UploadIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

import { MenuIcon } from 'lucide-react'

import { ShortcutHint } from '@/components/shortcut-hint'
import { ThemeToggle } from '@/components/theme-toggle'
import { clientAuth } from '@/lib/firebase-client'
import type { PrincipalRole } from '@studio/core'

import { canSee, type Area } from '@/lib/permissions'
import { destroySession } from '@/server/actions/session'
import { CommandPalette } from '@/components/command-palette'
import { QuickBooking } from '@/components/quick-booking'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export interface NavItem {
  // The route IS the permission key. There is no second list to keep in step, and therefore no way
  // for the nav and the guard to disagree — which is how a trainer ends up with a link to the kasa.
  readonly href: Area
  readonly label: string
  readonly icon: LucideIcon
}
export interface NavGroup {
  readonly label?: string
  readonly items: readonly NavItem[]
}

// The persistent owner navigation (v1.19, elevated to the DS v2 language in v1.20).
// Grouped: overview, then daily operations, then management. Same destinations on desktop
// (left rail) and mobile (bottom bar). Calm active state (soft tint, not a saturated
// fill) for all-day comfort; token-driven, no hex (DS-1).
// Exported so the ⌘K command palette (Phase 2) navigates from the SAME source of truth as the rail —
// one list, so the two can never drift.
export const GROUPS: readonly NavGroup[] = [
  { items: [{ href: '/', label: 'Genel Görünüm', icon: LayoutDashboardIcon }] },
  {
    // The trainer's whole product. It sits alone, and it is filtered in for her and out for
    // reception by the same matrix as everything else.
    items: [
      { href: '/my-classes', label: 'Derslerim', icon: ClipboardCheckIcon },
      // Plus Phase 9 — the trainer's own earnings (owner + trainer; read-only for her).
      { href: '/my-payroll', label: 'Hakedişim', icon: BanknoteIcon },
    ],
  },
  {
    label: 'Operasyon',
    items: [
      { href: '/schedule', label: 'Ders Ajandası', icon: CalendarIcon },
      { href: '/reservations', label: 'Rezervasyon Ajandası', icon: CalendarClockIcon },
      { href: '/checkin', label: 'Check-in', icon: DoorOpenIcon },
      // Plus Phase 8 — occupancy & entry reports (owner + reception).
      { href: '/fitness', label: 'Katılım', icon: GaugeIcon },
      { href: '/attendance', label: 'Yoklama', icon: ClipboardCheckIcon },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { href: '/members', label: 'Üyeler', icon: UsersIcon },
      { href: '/packages', label: 'Paketler', icon: PackageIcon },
      // Plus Phase 7 — the training workspace (owner + trainer; reception is filtered out). For the owner
      // it is a management surface (exercise library + templates), so it lives here (PF-16 nav fix).
      { href: '/training', label: 'Antrenman', icon: DumbbellIcon },
      { href: '/finance', label: 'Kasa', icon: WalletIcon },
      { href: '/retail', label: 'Ürün Sat', icon: ShoppingCartIcon },
      { href: '/crm', label: 'Satış Hunisi', icon: TargetIcon },
      { href: '/conversations', label: 'Sohbetler', icon: MessageCircleIcon },
      { href: '/calendar', label: 'Takvim', icon: CalendarDaysIcon },
      { href: '/activity', label: 'Hareket Merkezi', icon: ActivityIcon },
      { href: '/notifications', label: 'Bildirim Merkezi', icon: BellIcon },
      { href: '/knowledge', label: 'Bilgi Merkezi', icon: BookOpenIcon },
      { href: '/media', label: 'Medya Merkezi', icon: ImageIcon },
    ],
  },
  {
    label: 'Sahip',
    items: [
      { href: '/patron', label: 'Patron Asistanı', icon: SparklesIcon },
      { href: '/engagement', label: 'Stüdyodan', icon: MegaphoneIcon },
      { href: '/advisor', label: 'Öneriler', icon: LightbulbIcon },
      { href: '/ai-report', label: 'AI Rapor', icon: BarChart3Icon },
      { href: '/operations', label: 'Operasyonlar', icon: LayersIcon },
      // Plus Phase 9 — trainer payroll & commission. Owner-confidential.
      { href: '/payroll', label: 'Bordro', icon: BanknoteIcon },
      { href: '/reports', label: 'Raporlar', icon: FileTextIcon },
      { href: '/analytics', label: 'Analiz', icon: BarChart3Icon },
      { href: '/staff', label: 'Personel', icon: UserCogIcon },
      { href: '/settings', label: 'Ayarlar', icon: SettingsIcon },
      { href: '/audit', label: 'Denetim Kaydı', icon: ShieldIcon },
      { href: '/feedback', label: 'Geri Bildirim', icon: MessageSquareWarningIcon },
      // The cutover tool. It stays in the nav after cutover rather than being hidden behind a flag:
      // it is idempotent (a phone is unique — I-21), it refuses a dirty file, and a tool the owner
      // cannot find is a tool she will ask us to run for her.
      { href: '/import', label: 'Üye İçe Aktar', icon: UploadIcon },
    ],
  },
]

// The nav is DERIVED from the matrix, never from a second list of flags. Offering someone a link she
// cannot follow is a broken promise; a nav that lies is worse than one that is short.
const groupsFor = (role: PrincipalRole): readonly NavGroup[] =>
  GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(role, i.href)) })).filter(
    (g) => g.items.length > 0,
  )

const isActive = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

// No "bare route" escape hatch any more: this shell is mounted ONLY by `(staff)/layout.tsx`.
// Login, the design-system showcase, the member portal and the invite link live in other
// branches of the route tree, so they cannot render it even by accident.
export function AppShell({ children, role }: { children: ReactNode; role: PrincipalRole }) {
  const pathname = usePathname()
  const groups = groupsFor(role)
  return (
    <div data-slot="app-shell" className="min-h-dvh pb-16 md:pb-0 md:pl-60">
      <DesktopRail pathname={pathname} groups={groups} />
      <MobileNav pathname={pathname} groups={groups} />
      {/* ⌘K anywhere — the operations command palette (Phase 2 §1). */}
      <CommandPalette role={role} />
      {/* "N" or ⌘K → the quick-booking modal (Phase 2 §2). */}
      <QuickBooking />
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

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 py-1">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading text-base font-medium text-primary-foreground shadow-sm">
        S
      </span>
      <span className="leading-tight">
        {/* Editorial serif wordmark (Doc 33) — the brand's premium signal, top-left of every screen. */}
        <span className="block font-heading text-[0.95rem] font-medium text-foreground">Studio</span>
        <span className="block text-xs text-muted-foreground">Yönetim Asistanı</span>
      </span>
    </Link>
  )
}

function RailLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={() => onClick?.()}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-primary-soft font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="size-[1.05rem] shrink-0" />
      {item.label}
    </Link>
  )
}

function DesktopRail({ pathname, groups }: { pathname: string; groups: readonly NavGroup[] }) {
  const { logout, loading } = useLogout()
  return (
    <aside
      data-slot="app-shell-nav"
      className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-sidebar md:flex"
    >
      <div className="flex items-center justify-between gap-1 px-3 pt-4 pb-2">
        <Brand />
        <ThemeToggle className="shrink-0 text-muted-foreground" />
      </div>
      {/* The ⌘K palette's visible handle — reception's fastest path to a member or a screen. */}
      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('sos:open-command'))}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <SearchIcon className="size-4 shrink-0" />
          <span>Ara…</span>
          <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
            <ShortcutHint letter="K" />
          </kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.label ? (
              <p className="px-3 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground/70 uppercase">
                {group.label}
              </p>
            ) : null}
            {group.items.map((it) => (
              <RailLink key={it.href} item={it} active={isActive(pathname, it.href)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={logout}
          disabled={loading}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <LogOutIcon className="size-[1.05rem] shrink-0" />
          Çıkış Yap
        </button>
      </div>
    </aside>
  )
}

// The bottom bar carries at most FOUR primary destinations + a "Menü" button; the full grouped nav
// lives in a slide-out drawer. A phone can't fairly show twenty-five icons in a scroll strip — the
// owner's tenth screen is unreachable without a horizontal drag nobody discovers. Reception lives on
// the operational four (agenda, reservations, check-in); the drawer holds the rest, grouped exactly
// like the desktop rail (one source of truth — `groups`).
const MOBILE_PRIMARY: readonly Area[] = ['/', '/my-classes', '/schedule', '/reservations', '/checkin', '/members']

function MobileNav({ pathname, groups }: { pathname: string; groups: readonly NavGroup[] }) {
  const [open, setOpen] = useState(false)
  const items = groups.flatMap((g) => g.items)
  // Role-adaptive: keep only the primaries this role can actually see, in priority order, capped at 4.
  const primary = MOBILE_PRIMARY.map((href) => items.find((it) => it.href === href))
    .filter((it): it is NavItem => Boolean(it))
    .slice(0, 4)

  return (
    <>
      <nav
        data-slot="app-shell-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-sidebar/95 backdrop-blur md:hidden"
      >
        {primary.map((it) => {
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
              <span className="max-w-full truncate">{it.label.split(' ')[0]}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-[10px] font-medium text-muted-foreground transition-colors"
        >
          <span className="grid size-7 place-items-center rounded-lg">
            <MenuIcon className="size-[1.15rem]" />
          </span>
          <span>Menü</span>
        </button>
      </nav>

      <MobileDrawer open={open} onOpenChange={setOpen} pathname={pathname} groups={groups} />
    </>
  )
}

function MobileDrawer({
  open,
  onOpenChange,
  pathname,
  groups,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pathname: string
  groups: readonly NavGroup[]
}) {
  const { logout, loading } = useLogout()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[17rem] p-0">
        <SheetHeader className="flex-row items-center justify-between gap-1 border-b border-border px-3 py-3">
          <SheetTitle className="p-0">
            <Brand />
          </SheetTitle>
          <ThemeToggle className="shrink-0 text-muted-foreground" />
        </SheetHeader>
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              window.dispatchEvent(new Event('sos:open-command'))
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <SearchIcon className="size-4 shrink-0" />
            <span>Ara…</span>
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.label ? (
                <p className="px-3 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground/70 uppercase">
                  {group.label}
                </p>
              ) : null}
              {group.items.map((it) => (
                <RailLink
                  key={it.href}
                  item={it}
                  active={isActive(pathname, it.href)}
                  onClick={() => onOpenChange(false)}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={logout}
            disabled={loading}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <LogOutIcon className="size-[1.05rem] shrink-0" />
            Çıkış Yap
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
