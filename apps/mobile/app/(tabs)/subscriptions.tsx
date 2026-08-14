import { RefreshControl, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import type { MemberSubscription } from '@studio/core/client'
import { api } from '@/lib/api'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Body, Hero, Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, StatusChip, Txt, type ChipTone } from '@/components/kit'
import { space, typo as t, usePalette } from '@/theme'

const STATUS_TR: Record<string, { label: string; tone: ChipTone }> = {
  active: { label: 'Aktif', tone: 'success' },
  expired: { label: 'Süresi doldu', tone: 'neutral' },
  exhausted: { label: 'Tükendi', tone: 'neutral' },
  cancelled: { label: 'İptal', tone: 'error' },
  frozen: { label: 'Donduruldu', tone: 'warning' },
}
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

export default function Subscriptions() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(api.subscriptions)
  if (loading && !data) return <Loading />

  // NO `header` prop: this is a TAB, and there is no stack header above it. Passing `header` told the
  // screen to skip the top safe-area inset, so the title ran up under the notch and read as "the
  // header disappeared" (owner, 2026-08-02).
  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={p.accent} />}>
      {/* Owner: only ACTIVE subscriptions — the member has no reason to see expired/cancelled ones. */}
      <SectionHeader>Aktif aboneliklerin</SectionHeader>
      {data && data.active.length > 0 ? (
        data.active.map((s, i) => <SubCard key={s.entitlementId} sub={s} index={i} active />)
      ) : (
        <EmptyState icon="ticket-outline" title="Aktif aboneliğin yok" body="Paket alarak derslere yer ayırtabilirsin." />
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
      <View style={{ marginBottom: space(3), opacity: active ? 1 : 0.72 }}>
      <PremiumCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space(2) }}>
          <View style={{ flex: 1, gap: space(1) }}>
            <Txt role="h3" numberOfLines={2}>{sub.productName}</Txt>
            <Txt role="caption" tone="muted">Alındı: {d(sub.purchasedAt)}</Txt>
            <Txt role="caption" tone="muted">Bitiş: {d(sub.validUntil)}</Txt>
          </View>
          <StatusChip label={st.label} tone={st.tone} />
        </View>
        {active && sub.remaining !== null && sub.total ? (
          <View style={{ gap: space(2), marginTop: space(3) }}>
            <ProgressBar value={sub.remaining / Math.max(sub.total, 1)} color={p.primary} track={p.surfaceMuted} />
            <Txt role="caption" tone="muted">{sub.remaining} / {sub.total} ders kaldı</Txt>
          </View>
        ) : active && sub.fitnessEntry ? (
          <View style={{ gap: space(2), marginTop: space(3) }}>
            <ProgressBar value={Math.max(0, sub.fitnessEntry.allowance - sub.fitnessEntry.used) / Math.max(sub.fitnessEntry.allowance, 1)} color={p.primary} track={p.surfaceMuted} />
            <Txt role="caption" tone="muted">
              {sub.fitnessEntry.used >= sub.fitnessEntry.allowance
                ? `Giriş hakkı doldu (${sub.fitnessEntry.used}/${sub.fitnessEntry.allowance})`
                : `${Math.max(0, sub.fitnessEntry.allowance - sub.fitnessEntry.used)} / ${sub.fitnessEntry.allowance} giriş kaldı`}
            </Txt>
          </View>
        ) : active && sub.remaining === null ? (
          <View style={{ flexDirection: 'row', marginTop: space(3) }}>
            <StatusChip label="Sınırsız kullanım" tone="brand" />
          </View>
        ) : null}
      </PremiumCard>
      </View>
    </FadeInUp>
  )
}
