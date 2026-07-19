import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Card, Empty, Loading, Screen } from '@/components/ui'
import { space, usePalette } from '@/theme'

export default function Messages() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.inbox)
  if (loading && !data) return <Loading />

  async function open(intentId: string) {
    try { await api.markRead(intentId); await reload() } catch { /* best-effort */ }
  }

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      {data && data.length > 0 ? (
        data.map((m, i) => (
          <FadeInUp key={m.intentId} index={i}>
            <Card onPress={m.read ? undefined : () => void open(m.intentId)} style={{ opacity: m.read ? 0.62 : 1, borderLeftWidth: m.read ? 0 : 3, borderLeftColor: p.accent }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={m.read ? 'mail-open-outline' : 'mail'} size={18} color={m.read ? p.textMuted : p.accent} />
                <Body strong style={{ flex: 1 }} numberOfLines={1}>{m.subject}</Body>
                {!m.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} /> : null}
              </View>
              <Body muted>{m.body}</Body>
              <Body faint style={{ fontSize: 12 }}>{dateTime(m.at)}</Body>
            </Card>
          </FadeInUp>
        ))
      ) : (
        <Card><Empty icon={<Ionicons name="notifications-off-outline" size={30} color={p.textFaint} />} text="Bildirimin yok." /></Card>
      )}
    </Screen>
  )
}
