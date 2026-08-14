import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, Txt } from '@/components/kit'
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
            <View style={{ marginBottom: space(3), opacity: m.read ? 0.68 : 1 }}>
              <PremiumCard onPress={m.read ? undefined : () => void open(m.intentId)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(2) }}>
                  <Ionicons name={m.read ? 'mail-open-outline' : 'mail'} size={18} color={m.read ? p.textMuted : p.primary} />
                  <Txt role="h3" style={{ flex: 1 }} numberOfLines={1}>{m.subject}</Txt>
                  {!m.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.primary }} /> : null}
                </View>
                <Txt role="bodyLarge" tone="secondary">{m.body}</Txt>
                <Txt role="caption" tone="muted" style={{ marginTop: space(2) }}>{dateTime(m.at)}</Txt>
              </PremiumCard>
            </View>
          </FadeInUp>
        ))
      ) : (
        <EmptyState icon="notifications-off-outline" title="Bildirimin yok" body="Stüdyo sana yazdığında burada görünür." />
      )}
    </Screen>
  )
}
