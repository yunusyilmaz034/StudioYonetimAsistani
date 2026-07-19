import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { api } from '@/lib/api'
import { dateTime, formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, ProgressBar } from '@/components/motion'
import { Body, Card, Eyebrow, Empty, Hero, Loading, Pill, Screen } from '@/components/ui'
import { space, typo as t, usePalette } from '@/theme'

const todayTr = () => new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function Home() {
  const p = usePalette()
  const dash = useFetch(api.dashboard)
  const inbox = useFetch(api.inbox)

  if (dash.loading && !dash.data) return <Loading />
  const d = dash.data
  const next = d?.upcoming[0] ?? null
  const pkg = d?.packages[0] ?? null
  const announcement = (inbox.data ?? []).find((m) => !m.readAt) ?? (inbox.data ?? [])[0] ?? null

  return (
    <Screen refreshControl={<RefreshControl refreshing={dash.loading} onRefresh={() => { void dash.reload(); void inbox.reload() }} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <Hero>
          <Body style={[t.caption, { color: p.onGradMuted }]}>{todayTr()}</Body>
          <Body style={[t.display, { color: p.onGrad }]}>Merhaba, {d ? d.memberName.split(' ')[0] : ''} 👋</Body>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(1) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF22', paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999 }}>
              <Ionicons name="calendar-outline" size={15} color={p.onGrad} />
              <Body style={{ color: p.onGrad, fontWeight: '700', fontSize: 13 }}>{d?.upcoming.length ?? 0} yaklaşan ders</Body>
            </View>
            {pkg ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF22', paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999 }}>
                <Ionicons name="ticket-outline" size={15} color={p.onGrad} />
                <Body style={{ color: p.onGrad, fontWeight: '700', fontSize: 13 }}>{pkg.remaining === null ? 'Sınırsız' : `${pkg.remaining} ders`}</Body>
              </View>
            ) : null}
          </View>
        </Hero>
      </FadeInUp>

      {announcement ? (
        <FadeInUp index={1}>
          <Eyebrow>Stüdyodan</Eyebrow>
          <Card level={1} onPress={() => router.push('/messages')} style={{ borderLeftWidth: 3, borderLeftColor: p.accent }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="megaphone-outline" size={18} color={p.accent} />
              <Body strong style={{ flex: 1 }} numberOfLines={1}>{announcement.title}</Body>
              {!announcement.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} /> : null}
            </View>
            <Body muted numberOfLines={2}>{announcement.body}</Body>
          </Card>
        </FadeInUp>
      ) : null}

      <FadeInUp index={2}>
        <Eyebrow right={<Body style={{ color: p.accent, fontWeight: '700', fontSize: 13 }} onPress={() => router.push('/reservations')}>Tümü</Body>}>Sıradaki Dersin</Eyebrow>
        {next ? (
          <Card onPress={() => router.push('/reservations')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="barbell" size={22} color={p.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Body strong numberOfLines={1}>{next.serviceName}</Body>
                <Body muted>{dateTime(next.startsAt)}</Body>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: space(2) }}>
              {next.trainerName ? <Pill label={next.trainerName} icon={<Ionicons name="person" size={11} color={p.textMuted} />} /> : null}
              {next.roomName ? <Pill label={next.roomName} /> : null}
            </View>
          </Card>
        ) : (
          <Card><Empty icon={<Ionicons name="calendar-clear-outline" size={30} color={p.textFaint} />} text="Yaklaşan dersin yok. Ajanda'dan yeni bir ders ayırt." /></Card>
        )}
      </FadeInUp>

      {pkg ? (
        <FadeInUp index={3}>
          <Eyebrow>Aboneliğin</Eyebrow>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Body strong numberOfLines={1}>{pkg.productName}</Body>
                <Body muted>Geçerli: {new Date(pkg.validUntil).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</Body>
              </View>
              {pkg.balanceDue > 0 ? <Pill label={`${formatKurus(pkg.balanceDue)} borç`} tone="danger" /> : <Pill label="Ödendi" tone="good" />}
            </View>
            {pkg.remaining !== null ? (
              <View style={{ gap: 6 }}>
                <ProgressBar value={pkg.remaining / Math.max(pkg.remaining, 8)} color={p.accent} track={p.surfaceMuted} />
                <Body faint style={{ fontSize: 12.5 }}>{pkg.remaining} ders kaldı</Body>
              </View>
            ) : (
              <Pill label="Sınırsız kullanım" tone="gold" />
            )}
          </Card>
        </FadeInUp>
      ) : null}
    </Screen>
  )
}
