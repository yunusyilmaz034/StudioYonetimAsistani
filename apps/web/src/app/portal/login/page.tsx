import { Suspense } from 'react'
import type { Metadata } from 'next'

import { MemberLoginForm } from './member-login-form'

// The member's first screen is often the one she installs from — point it at the MEMBER manifest so
// "Ana Ekrana Ekle" here yields an icon that opens her portal, not the staff panel.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}): Promise<Metadata> {
  const { s } = await searchParams
  return {
    title: 'Üye Girişi',
    manifest: `/portal/manifest.webmanifest?s=${encodeURIComponent(s ?? '')}`,
  }
}

// The form reads the studio from the query string (the link reception sends), so it needs a
// Suspense boundary — `useSearchParams` bails out of prerendering otherwise.
export default function MemberLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense fallback={null}>
        <MemberLoginForm />
      </Suspense>
    </main>
  )
}
