import { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native'
import { Redirect } from 'expo-router'

import { fetchBranding, type Branding } from '@/lib/api'
import { track } from '@/lib/analytics'
import { Body, Button, H1 } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { radius, space, usePalette } from '@/theme'

export default function Login() {
  const p = usePalette()
  const { user, signIn } = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brand, setBrand] = useState<Branding | null>(null)

  useEffect(() => { fetchBranding().then(setBrand).catch(() => {}) }, [])

  if (user) return <Redirect href="/(tabs)" />

  async function submit() {
    setError(null)
    if (phone.trim().length < 7 || password.length < 1) { setError('Telefon ve parolanı gir.'); return }
    setBusy(true)
    try {
      await signIn(phone.trim(), password)
      track('login_success', { surface: 'mobile' })
    } catch (e) {
      track('login_failure', { surface: 'mobile' })
      const code = (e as Error).message
      setError(code === 'invalid_phone' ? 'Telefon numarası geçersiz.' : 'Giriş yapılamadı. Bilgilerini kontrol et.')
    } finally { setBusy(false) }
  }

  const input = {
    backgroundColor: p.surface, borderColor: p.hairline, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space(3.5), paddingVertical: space(3.5), fontSize: 16, color: p.text,
  } as const

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: space(6), gap: space(4) }}>
        <View style={{ alignItems: 'center', gap: space(3), marginBottom: space(2) }}>
          {brand?.logoUrl ? (
            <Image source={{ uri: brand.logoUrl }} style={{ width: 96, height: 96, borderRadius: radius.lg }} resizeMode="contain" />
          ) : (
            <View style={{ width: 88, height: 88, borderRadius: radius.lg, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: p.accentText, fontSize: 34, fontWeight: '800' }}>{(brand?.appName ?? 'P')[0]}</Text>
            </View>
          )}
          <H1>{brand?.appName ?? 'Pilates Fitness By Işıl'}</H1>
          <Body muted>Üye girişi</Body>
        </View>
        <TextInput style={input} value={phone} onChangeText={setPhone} placeholder="Telefon (05xx xxx xx xx)" placeholderTextColor={p.textFaint} keyboardType="phone-pad" autoComplete="tel" />
        <TextInput style={input} value={password} onChangeText={setPassword} placeholder="Parola" placeholderTextColor={p.textFaint} secureTextEntry autoComplete="password" />
        {error ? <Text style={{ color: p.danger, fontSize: 14 }}>{error}</Text> : null}
        <Button label="Giriş Yap" onPress={() => void submit()} loading={busy} />
        <Body muted>Parolanı bilmiyorsan stüdyodan davet/sıfırlama iste.</Body>
      </View>
    </KeyboardAvoidingView>
  )
}
