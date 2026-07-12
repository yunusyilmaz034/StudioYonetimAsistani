import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Studio Yönetim Asistanı',
  description: 'Phase 1',
}

// The root layout carries NO shell. Each surface brings its own:
//   • `(staff)/layout.tsx`      → the owner AppShell (sidebar + mobile bar)
//   • `portal/(member)/layout`  → the MemberPortalShell
//   • login / invite            → no shell at all
// Keeping the staff shell out of here is what makes it structurally impossible for a member to
// render an admin sidebar — hiding it with CSS would still have put it in her HTML.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={cn('font-sans', geist.variable)}>
      <body>
        {children}
      </body>
    </html>
  )
}
