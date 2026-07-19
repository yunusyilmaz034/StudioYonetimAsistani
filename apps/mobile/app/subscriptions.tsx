import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { MemberSubscription } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, ProgressBar } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Loading, Pill, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

const STATUS_TR: Record<string, { label: string; tone: 'muted' | 'good' | 'warn' | 'danger' }> = {
  active: { label: 'Aktif', tone: 'good' },
  expired: { label: 'Süresi doldu', tone: 'muted' },
  exhausted: { label: 'Tükendi', tone: 'muted' },
  cancelled: { label: 'İptal', tone: 'danger' },
  frozen: { label: 'Donduruldu', tone: 'warn' },
}
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

export default function Subscriptions() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.subscriptions)
  if (loading && !data) return <Loading />

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      <Eyebrow>Aktif Aboneliklerin</Eyebrow>
      {data && data.active.length > 0 ? (
        data.active.map((s, i) => <SubCard key={s.entitlementId} sub={s} index={i} active />)
      ) : (
        <Card><Empty icon={<Ionicons name="ticket-outline" size={30} color={p.textFaint} />} text="Aktif aboneliğin yok." /></Card>
      )}

      <Eyebrow>Geçmiş</Eyebrow>
      {data && data.past.length > 0 ? (
        data.past.map((s, i) => <SubCard key={s.entitlementId} sub={s} index={i} />)
      ) : (
        <Card><Empty icon={<Ionicons name="time-outline" size={28} color={p.textFaint} />} text="Geçmiş aboneliğin yok." /></Card>
      )}
    </Screen>
  )
}

function SubCard({ sub, index, active }: { sub: MemberSubscription; index: number; active?: boolean }) {
  const p = usePalette()
  const st = STATUS_TR[sub.status] ?? { label: sub.status, tone: 'muted' as const }
  return (
    <FadeInUp index={index}>
      <Card style={active ? undefined : { opacity: 0.72 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Body strong numberOfLines={1}>{sub.productName}</Body>
            <Body muted style={{ fontSize: 13.5 }}>Alındı: {d(sub.purchasedAt)}</Body>
            <Body muted style={{ fontSize: 13.5 }}>Bitiş: {d(sub.validUntil)}</Body>
          </View>
          <Pill label={st.label} tone={st.tone} />
        </View>
        {active && sub.remaining !== null && sub.total ? (
          <View style={{ gap: 6 }}>
            <ProgressBar value={sub.remaining / Math.max(sub.total, 1)} color={p.accent} track={p.surfaceMuted} />
            <Body faint style={{ fontSize: 12.5 }}>{sub.remaining} / {sub.total} ders kaldı</Body>
          </View>
        ) : active && sub.remaining === null ? (
          <Pill label="Sınırsız kullanım" tone="gold" />
        ) : null}
      </Card>
    </FadeInUp>
  )
}
