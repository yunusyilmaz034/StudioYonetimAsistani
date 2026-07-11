import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import { AppShell } from '@/components/app-nav'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Studio Yönetim Asistanı',
  description: 'Phase 1',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={cn('font-sans', geist.variable)}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
