import { Redirect } from 'expo-router'

import { useAuth } from '@/lib/auth'
import { Loading } from '@/components/ui'

// The gate: while Firebase restores the persisted session we show a spinner, then send her to the app
// or to login. Every protected screen lives under (tabs); login is the only other door.
export default function Index() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  return <Redirect href={user ? '/(tabs)' : '/login'} />
}
