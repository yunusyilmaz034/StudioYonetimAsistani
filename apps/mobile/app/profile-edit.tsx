import { useEffect, useState } from 'react'
import { Alert, TextInput, View } from 'react-native'
import { router } from 'expo-router'

import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { Body, Button, Card, Loading, Screen } from '@/components/ui'
import { radius, space, usePalette } from '@/theme'

export default function ProfileEdit() {
  const p = usePalette()
  const { data: profile, loading } = useFetch(api.profile)
  const [email, setEmail] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (profile) {
      setEmail(profile.email ?? '')
      setEmergencyName(profile.emergencyName ?? '')
      setEmergencyPhone(profile.emergencyPhone ?? '')
    }
  }, [profile])

  if (loading && !profile) return <Loading />

  async function save() {
    setBusy(true)
    try {
      const res = await api.updateProfile({
        email: email.trim() || null,
        emergencyName: emergencyName.trim() || null,
        emergencyPhone: emergencyPhone.trim() || null,
      })
      if (res.ok) { Alert.alert('Kaydedildi ✓', 'Bilgilerin güncellendi.'); router.back() }
      else Alert.alert('Kaydedilemedi', res.error.code === 'invalid_phone' ? 'Acil durum telefonu geçersiz.' : 'Lütfen tekrar dene.')
    } catch { Alert.alert('Hata', 'Kaydedilemedi.') }
    finally { setBusy(false) }
  }

  const input = {
    backgroundColor: p.bg, borderColor: p.hairline, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space(3.5), paddingVertical: space(3.25), fontSize: 16, color: p.text,
  } as const

  return (
    <Screen>
      <Card>
        <Body muted style={{ fontSize: 13.5 }}>Ad, telefon ve doğum tarihi stüdyo kaydından gelir; onları resepsiyon günceller. Sen e-posta ve acil durum kişini düzenleyebilirsin.</Body>
      </Card>

      <Field label="E-posta">
        <TextInput style={input} value={email} onChangeText={setEmail} placeholder="ornek@eposta.com" placeholderTextColor={p.textFaint} keyboardType="email-address" autoCapitalize="none" />
      </Field>
      <Field label="Acil durum kişisi">
        <TextInput style={input} value={emergencyName} onChangeText={setEmergencyName} placeholder="Ad Soyad" placeholderTextColor={p.textFaint} />
      </Field>
      <Field label="Acil durum telefonu">
        <TextInput style={input} value={emergencyPhone} onChangeText={setEmergencyPhone} placeholder="05xx xxx xx xx" placeholderTextColor={p.textFaint} keyboardType="phone-pad" />
      </Field>

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
