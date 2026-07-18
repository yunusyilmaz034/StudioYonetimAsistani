import { RefreshControl } from 'react-native'

import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { Body, Card, Empty, Loading, Pill, Screen } from '@/components/ui'
import { usePalette } from '@/theme'

export default function Messages() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.inbox)
  if (loading && !data) return <Loading />

  async function open(intentId: string) {
    try {
      await api.markRead(intentId)
      await reload()
    } catch {
      /* best-effort */
    }
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      {data && data.length > 0 ? (
        data.map((m) => (
          <Card key={m.intentId} style={{ opacity: m.readAt ? 0.6 : 1 }}>
            <Body>{m.title}</Body>
            <Body muted>{m.body}</Body>
            <Body muted>{dateTime(m.createdAt)}</Body>
            {!m.readAt ? <Pill label="Okundu olarak işaretle" tone="good" /> : null}
            {!m.readAt ? <Body muted onPress={() => void open(m.intentId)}>Dokun: okundu</Body> : null}
          </Card>
        ))
      ) : (
        <Empty text="Bildirimin yok." />
      )}
    </Screen>
  )
}
