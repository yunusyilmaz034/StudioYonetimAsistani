import type { StaffRole } from '@studio/core'
import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTenantContext } from '@/server/auth'

import { LogoutButton } from './logout-button'

// Protected home. It proves authentication end to end — session → TenantContext —
// and nothing more. It is deliberately NOT a business dashboard (that is a later
// milestone). Unauthenticated requests are bounced to /login (also by middleware).
export default async function HomePage() {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Studio Operating System"
        description="Giriş başarılı."
        actions={<LogoutButton />}
      />
      <Card>
        <CardHeader>
          <CardTitle>Oturum</CardTitle>
          <CardDescription>
            Bu ekran yalnızca kimlik doğrulamayı gösterir; bir iş operasyon ekranı değildir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rol:</span>
            <Badge>{roleLabel(ctx.role)}</Badge>
          </div>
          <div className="text-muted-foreground">Stüdyo: {ctx.studioId}</div>
          <div className="text-muted-foreground">
            Şubeler: {ctx.branchIds.length > 0 ? ctx.branchIds.join(', ') : '—'}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'owner':
      return 'Sahip'
    case 'receptionist':
      return 'Resepsiyon'
    case 'trainer':
      return 'Eğitmen'
  }
}
