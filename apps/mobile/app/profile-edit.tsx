import { useEffect, useState } from 'react'
import { Alert, Image, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { api } from '@/lib/api'
import { pickPhotoDataUrl } from '@/lib/photo'
import { useFetch } from '@/lib/useFetch'
import { PressableScale } from '@/components/motion'
import { Body, Button, Card, Loading, Screen } from '@/components/ui'
import { radius, space, usePalette } from '@/theme'

export default function ProfileEdit() {
  const p = usePalette()
  const { data: profile, loading } = useFetch(api.profile)
  const [email, setEmail] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (profile) {
      setEmail(profile.email ?? '')
      setEmergencyName(profile.emergencyName ?? '')
      setEmergencyPhone(profile.emergencyPhone ?? '')
      setAvatar(profile.avatarUrl ?? null)
    }
  }, [profile])

  if (loading && !profile) return <Loading />

  async function changePhoto() {
    try {
      const dataUrl = await pickPhotoDataUrl()
      if (!dataUrl) return
      setUploading(true)
      const res = await api.uploadPhoto(dataUrl)
      if (res.ok) { setAvatar(res.value.avatarUrl); Alert.alert('Fotoğraf güncellendi ✓') }
      else Alert.alert('Yüklenemedi', 'Tekrar dene.')
    } catch { Alert.alert('Hata', 'Fotoğraf yüklenemedi.') } finally { setUploading(false) }
  }

  async function save() {
    setBusy(true)
    try {
      const res = await api.updateProfile({ email: email.trim() || null, emergencyName: emergencyName.trim() || null, emergencyPhone: emergencyPhone.trim() || null })
      if (res.ok) { Alert.alert('Kaydedildi ✓', 'Bilgilerin güncellendi.'); router.back() }
      else Alert.alert('Kaydedilemedi', res.error.code === 'invalid_phone' ? 'Acil durum telefonu geçersiz.' : 'Lütfen tekrar dene.')
    } catch { Alert.alert('Hata', 'Kaydedilemedi.') } finally { setBusy(false) }
  }

  const input = { backgroundColor: p.bg, borderColor: p.hairline, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(3.25), fontSize: 16, color: p.text } as const

  return (
    <Screen header>
      <Card style={{ alignItems: 'center', gap: space(3) }}>
        <PressableScale onPress={() => void changePhoto()}>
          <View>
            {avatar ? (
              <Image source={{ uri: avatar }} style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: p.surfaceMuted }} />
            ) : (
              <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: p.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person" size={44} color={p.textFaint} />
              </View>
            )}
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: p.surface }}>
              <Ionicons name={uploading ? 'hourglass' : 'camera'} size={16} color={p.accentText} />
            </View>
          </View>
        </PressableScale>
        <Body muted>{uploading ? 'Yükleniyor…' : 'Fotoğrafını değiştirmek için dokun'}</Body>
      </Card>

      <Card>
        <Body muted style={{ fontSize: 13.5 }}>Ad, telefon ve doğum tarihi stüdyo kaydından gelir; onları resepsiyon günceller. Sen fotoğraf, e-posta ve acil durum kişini düzenleyebilirsin.</Body>
      </Card>

      <Field label="E-posta"><TextInput style={input} value={email} onChangeText={setEmail} placeholder="ornek@eposta.com" placeholderTextColor={p.textFaint} keyboardType="email-address" autoCapitalize="none" /></Field>
      <Field label="Acil durum kişisi"><TextInput style={input} value={emergencyName} onChangeText={setEmergencyName} placeholder="Ad Soyad" placeholderTextColor={p.textFaint} /></Field>
      <Field label="Acil durum telefonu"><TextInput style={input} value={emergencyPhone} onChangeText={setEmergencyPhone} placeholder="05xx xxx xx xx" placeholderTextColor={p.textFaint} keyboardType="phone-pad" /></Field>

      <Button label="Kaydet" onPress={() => void save()} loading={busy} />
    </Screen>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePalette()
  return (
    <View style={{ gap: space(1.5) }}>
      <Body strong style={{ color: p.textMuted, fontSize: 13 }}>{label}</Body>
      {children}
    </View>
  )
}
