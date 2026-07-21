import { useCallback, useEffect, useState } from 'react'
import { Image, Pressable, Switch, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useFocusEffect } from 'expo-router'

import type { MemberProfile, NotificationPrefs } from '@studio/core/client'
import { api } from '@/lib/api'
import { localDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { useAuth } from '@/lib/auth'
import { FadeInUp } from '@/components/motion'
import { Body, Button, Card, Eyebrow, Hero, Loading, Screen } from '@/components/ui'
import { radius, space, typo as t, usePalette } from '@/theme'

const CHANNELS: { key: keyof NotificationPrefs; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'push', label: 'Uygulama bildirimleri', icon: 'notifications-outline' },
  { key: 'email', label: 'E-posta', icon: 'mail-outline' },
  { key: 'sms', label: 'SMS', icon: 'chatbubble-outline' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { key: 'campaign', label: 'Kampanya / duyuru', icon: 'megaphone-outline' },
]

export default function Profile() {
  const p = usePalette()
  const { signOutMember } = useAuth()
  const { data: profile, loading, reload } = useFetch(api.profile)
  const { data: loadedPrefs } = useFetch(api.prefs)
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  useEffect(() => { if (loadedPrefs) setPrefs(loadedPrefs) }, [loadedPrefs])
  // Re-fetch when the tab regains focus — so a photo (or info) changed on the edit screen shows here.
  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  if (loading && !profile) return <Loading />
  const pr = profile as MemberProfile | null

  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try { await api.setPrefs(next) } catch { setPrefs(prefs) }
  }

  const initials = (pr?.fullName ?? '').split(' ').map((s) => s[0]).slice(0, 2).join('').toLocaleUpperCase('tr')

  return (
    <Screen>
      <FadeInUp index={0}>
        <Hero>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
            {pr?.avatarUrl ? (
              <Image source={{ uri: pr.avatarUrl }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF25' }} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF25', alignItems: 'center', justifyContent: 'center' }}>
                <Body style={{ color: p.onGrad, fontSize: 24, fontWeight: '800' }}>{initials}</Body>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={[t.h1, { color: p.onGrad }]} numberOfLines={1}>{pr?.fullName}</Body>
              <Body style={{ color: p.onGradMuted }}>{pr?.phone}</Body>
            </View>
          </View>
        </Hero>
      </FadeInUp>

      <FadeInUp index={1}>
        <Card>
          <Row icon="mail-outline" label="E-posta" value={pr?.email ?? '—'} />
          <Divider />
          <Row icon="calendar-outline" label="Doğum tarihi" value={pr?.birthDate ? localDate(pr.birthDate) : '—'} />
          <Divider />
          <Row icon="medkit-outline" label="Acil durum" value={pr?.emergencyName ? `${pr.emergencyName} · ${pr.emergencyPhone}` : '—'} />
        </Card>
        <Button label="Bilgilerimi Düzenle" tone="muted" icon={<Ionicons name="create-outline" size={18} color={p.text} />} onPress={() => router.push('/profile-edit')} />
      </FadeInUp>

      <FadeInUp index={2}>
        <Eyebrow>Hesabım</Eyebrow>
        <Card inset>
          <LinkRow icon="ticket-outline" label="Aboneliklerim" onPress={() => router.push('/subscriptions')} />
          <Divider />
          <LinkRow icon="call-outline" label="İletişim" onPress={() => router.push('/contact')} />
        </Card>
      </FadeInUp>

      <FadeInUp index={3}>
        <Eyebrow>Bildirim Tercihleri</Eyebrow>
        <Card inset>
          {prefs
            ? CHANNELS.map((c, i) => (
                <View key={c.key}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5) }}>
                    <Ionicons name={c.icon} size={19} color={p.textMuted} />
                    <Body style={{ flex: 1 }}>{c.label}</Body>
                    <Switch value={Boolean(prefs[c.key])} onValueChange={(v) => void toggle(c.key, v)} trackColor={{ true: p.accent, false: p.surfaceMuted }} />
                  </View>
                </View>
              ))
            : <Body muted>Yükleniyor…</Body>}
        </Card>
      </FadeInUp>

      <FadeInUp index={4}>
        <Button label="Çıkış Yap" tone="muted" icon={<Ionicons name="log-out-outline" size={18} color={p.danger} />} onPress={() => void signOutMember()} />
      </FadeInUp>
    </Screen>
  )
}

function LinkRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const p = usePalette()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5) }}>
        <Ionicons name={icon} size={19} color={p.textMuted} />
        <View style={{ flex: 1 }}><Body strong>{label}</Body></View>
        <Ionicons name="chevron-forward" size={18} color={p.textFaint} />
      </View>
    </Pressable>
  )
}

function Row({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(1.5) }}>
      <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: p.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={p.textMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Body faint style={{ fontSize: 12 }}>{label}</Body>
        <Body strong numberOfLines={1}>{value}</Body>
      </View>
    </View>
  )
}
function Divider() {
  const p = usePalette()
  return <View style={{ height: 1, backgroundColor: p.hairline }} />
}
