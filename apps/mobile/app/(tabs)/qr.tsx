import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions } from 'expo-camera'

import { api } from '@/lib/api'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Button, Card, Loading, Screen, Title } from '@/components/ui'
import { radius, shadow, space, usePalette } from '@/theme'

export default function Qr() {
  const p = usePalette()
  const [tab, setTab] = useState<'show' | 'scan'>('show')
  const [branchId, setBranchId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (branch: string) => {
    const res = await api.mintQr(branch)
    setToken(res.token)
    const leadMs = Math.max(5000, res.ttlSeconds * 1000 - 5000)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void refresh(branch), leadMs)
  }, [])

  useEffect(() => {
    let alive = true
    api.qrContext().then(async (ctx) => {
      if (!alive) return
      const branch = ctx.branchId ?? 'main'
      setBranchId(branch)
      await refresh(branch)
    }).finally(() => alive && setLoading(false))
    return () => { alive = false; if (timer.current) clearTimeout(timer.current) }
  }, [refresh])

  if (loading && !token) return <Loading />

  return (
    <Screen scroll={false}>
      <Title sub="Stüdyoya girişini doğrula">Giriş</Title>

      <View style={{ flexDirection: 'row', backgroundColor: p.surfaceMuted, borderRadius: radius.pill, padding: 4, gap: 4 }}>
        <Segment label="Kodum" icon="qr-code" active={tab === 'show'} onPress={() => setTab('show')} />
        <Segment label="Tara" icon="scan" active={tab === 'scan'} onPress={() => setTab('scan')} />
      </View>

      {tab === 'show' ? (
        <FadeInUp index={0} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(4) }}>
          <View style={[{ backgroundColor: '#FFFFFF', padding: space(6), borderRadius: radius.xl }, shadow(2)]}>
            {token ? <QRCode value={token} size={230} color="#211A16" backgroundColor="#FFFFFF" /> : null}
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Body strong>Bu kodu resepsiyona okut</Body>
            <Body muted style={{ textAlign: 'center' }}>Kod güvenlik için sürekli yenilenir.{branchId ? `  ·  ${branchId}` : ''}</Body>
          </View>
        </FadeInUp>
      ) : (
        <Scanner />
      )}
    </Screen>
  )
}

function Scanner() {
  const p = usePalette()
  const [perm, requestPerm] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const handled = useRef(false)

  async function onScan(data: string) {
    if (handled.current || busy) return
    handled.current = true
    setBusy(true)
    try {
      const res = await api.checkin(data)
      if (res.ok) Alert.alert('Giriş yapıldı ✓', 'Hoş geldin! Stüdyoya girişin kaydedildi.')
      else Alert.alert('Giriş yapılamadı', res.error.code === 'qr_expired' ? 'Kodun süresi doldu, tekrar tara.' : 'Geçersiz ya da kullanılmış kod.')
    } catch { Alert.alert('Hata', 'Giriş yapılamadı, tekrar dene.') }
    finally { setBusy(false); setTimeout(() => { handled.current = false }, 2500) }
  }

  if (!perm) return <Loading />
  if (!perm.granted) {
    return (
      <FadeInUp index={0} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ alignItems: 'center', gap: space(3), width: '100%' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="camera" size={30} color={p.accent} />
          </View>
          <Body strong style={{ textAlign: 'center' }}>Kamera izni gerekli</Body>
          <Body muted style={{ textAlign: 'center' }}>Kiosk ekranındaki QR'ı okutmak için kamerana erişim izni ver.</Body>
          <Button label="İzin Ver" onPress={() => void requestPerm()} />
        </Card>
      </FadeInUp>
    )
  }

  return (
    <FadeInUp index={0} style={{ flex: 1, gap: space(3) }}>
      <View style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onScan(data)}
        />
        {/* framing overlay */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 220, height: 220, borderRadius: radius.lg, borderWidth: 3, borderColor: '#FFFFFFCC' }} />
        </View>
      </View>
      <Body muted style={{ textAlign: 'center' }}>{busy ? 'Giriş yapılıyor…' : 'Kioskun ekranındaki QR kodunu çerçeveye getir.'}</Body>
    </FadeInUp>
  )
}

function Segment({ label, icon, active, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; active: boolean; onPress: () => void }) {
  const p = usePalette()
  return (
    <PressableScale onPress={onPress} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: space(2.5), borderRadius: radius.pill, backgroundColor: active ? p.surface : 'transparent' }}>
        <Ionicons name={icon} size={16} color={active ? p.accent : p.textMuted} />
        <Body style={{ fontWeight: '700', color: active ? p.text : p.textMuted }}>{label}</Body>
      </View>
    </PressableScale>
  )
}
