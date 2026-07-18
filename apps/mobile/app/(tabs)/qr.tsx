import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'

import { api } from '@/lib/api'
import { Body, Card, H1, Loading, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

// She DISPLAYS a short-lived signed QR; reception scans it (the same flow as the web portal). The token
// auto-refreshes a few seconds before it expires so what's on screen is always valid.
export default function Qr() {
  const p = usePalette()
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
    api
      .qrContext()
      .then(async (ctx) => {
        if (!alive) return
        const branch = ctx.branchId ?? 'main'
        setBranchId(branch)
        await refresh(branch)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [refresh])

  if (loading && !token) return <Loading />

  return (
    <Screen scroll={false}>
      <H1>Giriş QR</H1>
      <Body muted>Bu kodu resepsiyona okut. Kod güvenlik için sürekli yenilenir.</Body>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ alignItems: 'center', padding: space(6) }}>
          {token ? <QRCode value={token} size={240} color={p.text} backgroundColor={p.surface} /> : <Body muted>Kod hazırlanıyor…</Body>}
        </Card>
        {branchId ? <Body muted>Şube: {branchId}</Body> : null}
      </View>
    </Screen>
  )
}
