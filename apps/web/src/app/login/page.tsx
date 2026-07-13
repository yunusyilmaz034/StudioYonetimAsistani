import { redirect } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getMemberClaims, getTenantContext } from '@/server/auth'

import { LoginForm } from './login-form'

// Staff sign-in (email + password). Mobile-first: a single-column card centred at
// 375px, Design System tokens/components only, error + loading states in the form.
// Not a business screen.
//
// DEBT-012 — this page is now the ONLY place that decides whether a visitor already has a
// session, because it is the only place that can VERIFY one. The middleware used to bounce
// anyone holding a cookie away from here; a dead cookie therefore locked the user out of the
// product entirely. Presence is not validity, and only the server knows the difference.
export default async function LoginPage() {
  const ctx = await getTenantContext()
  if (ctx) {
    redirect('/')
  }
  // A MEMBER holds a valid session but is not staff: her door is the portal, not this form.
  if (await getMemberClaims()) {
    redirect('/portal')
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Studio Operating System</CardTitle>
          <CardDescription>Personel girişi</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
