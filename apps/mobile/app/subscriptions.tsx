import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import type { MemberSubscription } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Hero, Loading, Pill, Screen } from '@/components/ui'
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
      {/* Owner: only ACTIVE subscriptions — the member has no reason to see expired/cancelled ones. */}
      <Eyebrow>Aktif Aboneliklerin</Eyebrow>
      {data && data.active.length > 0 ? (
        data.active.map((s, i) => <SubCard key={s.entitlementId} sub={s} index={i} active />)
      ) : (
        <Card><Empty icon={<Ionicons name="ticket-outline" size={30} color={p.textFaint} />} text="Aktif aboneliğin yok." /></Card>
      )}

      {/* Offered HERE because this is the screen she opens to see how many classes are left — the
          same moment she finds out there are none. Anywhere else and she has to go looking for it at
          exactly the wrong time.

          Given the HERO treatment (owner: "çok basit kalmış, görülmüyor") rather than a plain row.
          It is the one action on this screen and the studio's whole renewal flow depends on it being
          noticed; a muted list item competing with the cards above it is a button nobody presses. */}
      <FadeInUp index={(data?.active.length ?? 0) + 1}>
        <PressableScale onPress={() => router.push('/buy')}>
          <Hero>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Body strong style={{ color: p.onGrad, fontSize: 19 }}>Paket al / yenile</Body>
                <Body style={{ color: p.onGradMuted, fontSize: 13.5 }}>
                  Kartınla öde, paketin ödeme onaylanır onaylanmaz tanımlansın.
                </Body>
              </View>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: '#FFFFFF22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="arrow-forward" size={20} color={p.onGrad} />
              </View>
            </View>
          </Hero>
        </PressableScale>
      </FadeInUp>
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
        ) : active && sub.fitnessEntry ? (
          <View style={{ gap: 6 }}>
            <ProgressBar value={Math.max(0, sub.fitnessEntry.allowance - sub.fitnessEntry.used) / Math.max(sub.fitnessEntry.allowance, 1)} color={p.accent} track={p.surfaceMuted} />
            <Body faint style={{ fontSize: 12.5 }}>
              {sub.fitnessEntry.used >= sub.fitnessEntry.allowance
                ? `Giriş hakkı doldu (${sub.fitnessEntry.used}/${sub.fitnessEntry.allowance})`
                : `${Math.max(0, sub.fitnessEntry.allowance - sub.fitnessEntry.used)} / ${sub.fitnessEntry.allowance} giriş kaldı`}
            </Body>
          </View>
        ) : active && sub.remaining === null ? (
          <Pill label="Sınırsız kullanım" tone="gold" />
        ) : null}
      </Card>
    </FadeInUp>
  )
}
