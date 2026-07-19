import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Studio Yönetim Paneli',
  description: 'Stüdyo yönetim paneli',
  applicationName: 'Studio Panel',
  manifest: '/manifest.webmanifest',
  // Installed to a phone/tablet home screen it runs full-screen like an app (iOS "Ana Ekrana Ekle").
  appleWebApp: { capable: true, title: 'Studio Panel', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#7A1F3D',
  // A calendar-heavy panel on a phone: let the user pinch-zoom, and fit the notch.
  viewportFit: 'cover',
}

// The root layout carries NO shell. Each surface brings its own:
//   • `(staff)/layout.tsx`      → the owner AppShell (sidebar + mobile bar)
//   • `portal/(member)/layout`  → the MemberPortalShell
//   • login / invite            → no shell at all
// Keeping the staff shell out of here is what makes it structurally impossible for a member to
// render an admin sidebar — hiding it with CSS would still have put it in her HTML.
// Sets the theme BEFORE first paint (PF-18), so there is no flash of light on a dark preference. Reads
// the saved choice, else the OS preference; the toggle later overwrites localStorage + data-theme. Runs
// synchronously as the first thing in <body>, so `data-theme` is on <html> before the page is painted.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={cn('font-sans', geist.variable)} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  )
}
