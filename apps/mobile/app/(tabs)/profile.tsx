import { useEffect, useState } from 'react'
import { Switch, View } from 'react-native'

import type { NotificationPrefs } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { useAuth } from '@/lib/auth'
import { Body, Button, Card, H1, H2, Loading, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

const CHANNELS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: 'push', label: 'Uygulama bildirimleri' },
  { key: 'email', label: 'E-posta' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'campaign', label: 'Kampanya / duyuru' },
]

export default function Profile() {
  const p = usePalette()
  const { signOutMember } = useAuth()
  const { data: profile, loading } = useFetch(api.profile)
  const { data: loadedPrefs } = useFetch(api.prefs)
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)

  useEffect(() => {
    if (loadedPrefs) setPrefs(loadedPrefs)
  }, [loadedPrefs])

  if (loading && !profile) return <Loading />

  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      await api.setPrefs(next)
    } catch {
      setPrefs(prefs) // revert
    }
  }

  return (
    <Screen>
      <H1>Profil</H1>
      {profile ? (
        <Card>
          <Body>{profile.fullName}</Body>
          <Body muted>{profile.phone}</Body>
          {profile.email ? <Body muted>{profile.email}</Body> : null}
          {profile.emergencyName ? <Body muted>Acil durum: {profile.emergencyName} · {profile.emergencyPhone}</Body> : null}
        </Card>
      ) : null}

      <H2>Bildirim Tercihleri</H2>
      <Card>
        {prefs
          ? CHANNELS.map((c, i) => (
              <View
                key={c.key}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space(2), borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.border }}
              >
                <Body>{c.label}</Body>
                <Switch value={Boolean(prefs[c.key])} onValueChange={(v) => void toggle(c.key, v)} trackColor={{ true: p.accent }} />
              </View>
            ))
          : <Body muted>Yükleniyor…</Body>}
      </Card>

      <Button label="Çıkış Yap" tone="muted" onPress={() => void signOutMember()} />
    </Screen>
  )
}
