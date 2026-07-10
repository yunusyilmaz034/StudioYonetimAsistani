import { redirect } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getTenantContext } from '@/server/auth'

import { LoginForm } from './login-form'

// Staff sign-in (email + password). Mobile-first: a single-column card centred at
// 375px, Design System tokens/components only, error + loading states in the form.
// Not a business screen.
export default async function LoginPage() {
  const ctx = await getTenantContext()
  if (ctx) {
    redirect('/')
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
