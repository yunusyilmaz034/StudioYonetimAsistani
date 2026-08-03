import { useEffect, useState, type ComponentProps } from 'react'
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Redirect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { fetchBranding, type Branding } from '@/lib/api'
import { track } from '@/lib/analytics'
import { Body, Button, GradientFill, HeroFigure } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { radius, shadow, space, typo as t, usePalette } from '@/theme'

export default function Login() {
  const p = usePalette()
  const insets = useSafeAreaInsets()
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* premium mahogany hero — the app's face on first open */}
        <View style={{ overflow: 'hidden', paddingTop: insets.top + space(10), paddingBottom: space(9), paddingHorizontal: space(6), borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl }}>
          <GradientFill from={p.gradFrom} to={p.gradTo} vertical />
          <View style={{ position: 'absolute', top: -70, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: '#FFFFFF', opacity: 0.08 }} />
          <View style={{ position: 'absolute', right: -10, bottom: -14 }} pointerEvents="none"><HeroFigure gold={p.gold} /></View>
          <View style={{ gap: space(3) }}>
            {brand?.logoUrl ? (
              <Image source={{ uri: brand.logoUrl }} style={{ width: 72, height: 72, borderRadius: radius.lg, backgroundColor: '#FFFFFF20' }} resizeMode="contain" />
            ) : (
              <View style={{ width: 72, height: 72, borderRadius: radius.lg, backgroundColor: '#FFFFFF20', alignItems: 'center', justifyContent: 'center' }}>
                <Body style={{ color: p.onGrad, fontSize: 30, fontWeight: '800' }}>{(brand?.appName ?? 'P')[0]}</Body>
              </View>
            )}
            <View style={{ gap: 4 }}>
              <Body style={[t.display, { color: p.onGrad }]} numberOfLines={2}>{brand?.appName ?? 'Pilates Fitness By Işıl'}</Body>
              <Body style={{ color: p.onGradMuted }}>Üye girişi</Body>
            </View>
          </View>
        </View>

        {/* form */}
        <View style={{ flex: 1, padding: space(6), gap: space(3.5) }}>
          <InputRow icon="call-outline" value={phone} onChangeText={setPhone} placeholder="Telefon (05xx xxx xx xx)" keyboardType="phone-pad" autoComplete="tel" />
          <InputRow icon="lock-closed-outline" reveal value={password} onChangeText={setPassword} placeholder="Parola" autoComplete="password" />
          {error ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="alert-circle" size={16} color={p.danger} />
              <Body style={{ color: p.danger, fontSize: 14 }}>{error}</Body>
            </View>
          ) : null}
          <Button label="Giriş Yap" onPress={() => void submit()} loading={busy} icon={<Ionicons name="log-in-outline" size={18} color={p.accentText} />} />
          <Body muted style={{ textAlign: 'center', marginTop: space(1) }}>Parolanı bilmiyorsan stüdyodan davet/sıfırlama iste.</Body>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// PF-44 (owner, 2026-08-02) — `reveal` puts an eye inside the field. Typing a password you cannot
// see is a guessing game, and on a phone it is one people lose silently: three wrong tries and she
// gives up, and nothing anywhere records that she tried.
//
// Default hidden, and NO auto-hide timer: a field that re-hides itself the moment she looks away is
// worse than one that never showed her anything. The label says the state, because to a screen
// reader the icon says nothing. 44px of touch target, the studio's mobile floor.
function InputRow({
  icon,
  reveal,
  ...props
}: { icon: keyof typeof Ionicons.glyphMap; reveal?: boolean } & ComponentProps<typeof TextInput>) {
  const p = usePalette()
  const [shown, setShown] = useState(false)
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: p.surface, borderColor: p.hairline, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(4) }, shadow(1)]}>
      <Ionicons name={icon} size={20} color={p.textMuted} />
      <TextInput
        style={{ flex: 1, paddingVertical: space(4), fontSize: 16, color: p.text }}
        placeholderTextColor={p.textFaint}
        {...props}
        secureTextEntry={reveal ? !shown : props.secureTextEntry}
      />
      {reveal ? (
        <Pressable
          onPress={() => setShown((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Parolayı gizle' : 'Parolayı göster'}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={p.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}
