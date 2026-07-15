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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* A warm golden-hour wash for the first screen anyone sees (Doc 33). Token-driven, no hex:
          a blush bloom and a honey bloom over the porcelain ground. Decorative, so aria-hidden. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 -z-10 size-[42rem] -translate-x-1/2 rounded-full bg-primary-soft opacity-60 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 -bottom-1/4 -z-10 size-[30rem] rounded-full bg-gold-soft opacity-50 blur-3xl"
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary font-heading text-xl font-medium text-primary-foreground shadow-md">
            S
          </span>
          <h1 className="font-heading text-2xl font-medium text-foreground">Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">Yönetim Asistanı</p>
        </div>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <CardTitle>Personel Girişi</CardTitle>
            <CardDescription>Hesabınla giriş yap</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">Premium stüdyo yönetimi</p>
      </div>
    </main>
  )
}
