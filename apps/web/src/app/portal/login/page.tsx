import { Suspense } from 'react'

import { MemberLoginForm } from './member-login-form'

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
