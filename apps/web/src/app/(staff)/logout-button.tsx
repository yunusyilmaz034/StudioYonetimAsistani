'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'

import { Button } from '@/components/ui/button'
import { clientAuth } from '@/lib/firebase-client'
import { destroySession } from '@/server/actions/session'

export function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function onLogout() {
    setLoading(true)
    await destroySession()
    await signOut(clientAuth())
    router.replace('/login')
  }

  return (
    <Button variant="outline" onClick={onLogout} disabled={loading}>
      Çıkış Yap
    </Button>
  )
}
