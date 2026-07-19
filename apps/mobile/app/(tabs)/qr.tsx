import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { Ionicons } from '@expo/vector-icons'

import { api } from '@/lib/api'
import { FadeInUp, PressableScale } from '@/components/motion'
import { Body, Card, Loading, Screen, Title } from '@/components/ui'
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
        <FadeInUp index={0} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Card style={{ alignItems: 'center', gap: space(3), width: '100%' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="scan" size={30} color={p.accent} />
            </View>
            <Body strong style={{ textAlign: 'center' }}>Kiosk kodunu tara</Body>
            <Body muted style={{ textAlign: 'center' }}>Stüdyodaki tabletin ekranındaki QR'ı telefon kameranla okutarak giriş yap. Kamera özelliği bir sonraki güncellemede açılıyor.</Body>
          </Card>
        </FadeInUp>
      )}
    </Screen>
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
