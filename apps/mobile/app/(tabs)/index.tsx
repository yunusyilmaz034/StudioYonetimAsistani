import { Image, RefreshControl, useWindowDimensions, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, Easing } from 'react-native-reanimated'
import { useEffect, useState } from 'react'

import type { HomeBanner } from '@/lib/api'
import { api } from '@/lib/api'
import { dateTime, formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Body, Card, Eyebrow, Empty, GradientFill, Hero, Pill, Screen, ScreenSkeleton } from '@/components/ui'
import { CampaignPopup } from '@/components/campaign-popup'
import { radius, shadow, space, typo as t, usePalette } from '@/theme'

const todayTr = () => new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })

// Greeting AND hero tint by the hour on the phone — dawn rosé, bright midday mahogany, sunset, then a
// deep night. `hi` is the salutation; `from`/`to` retint the hero band to match the moment.
function timeOfDay(): { hi: string; from: string; to: string } {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return { hi: 'Günaydın', from: '#9C4A63', to: '#57192F' } // sabah — sıcak şafak
  if (h >= 12 && h < 18) return { hi: 'Tünaydın', from: '#7A1F3D', to: '#4E1226' } // öğle — marka mahogany
  if (h >= 18 && h < 22) return { hi: 'İyi akşamlar', from: '#611A38', to: '#330C1E' } // akşam — gün batımı
  return { hi: 'İyi geceler', from: '#3E1224', to: '#180610' } // gece — koyu, dingin
}
const OCC: Record<string, { label: string; tone: 'good' | 'warn' | 'danger' }> = {
  quiet: { label: 'Sakin', tone: 'good' },
  moderate: { label: 'Orta', tone: 'good' },
  busy: { label: 'Yoğun', tone: 'warn' },
  very_busy: { label: 'Çok yoğun', tone: 'danger' },
}

export default function Home() {
  const p = usePalette()
  const dash = useFetch(api.dashboard)
  const inbox = useFetch(api.inbox)
  const home = useFetch(api.home)
  const fitness = useFetch(api.fitness)

  if (dash.loading && !dash.data) return <ScreenSkeleton />
  const d = dash.data
  const next = d?.upcoming[0] ?? null
  const pkg = d?.packages[0] ?? null
  const announcement = (inbox.data ?? []).find((m) => !m.read) ?? (inbox.data ?? [])[0] ?? null
  const banners = home.data?.banners ?? (home.data?.banner ? [home.data.banner] : [])
  const occ = home.data?.occupancyLevel ? OCC[home.data.occupancyLevel] : null
  const tod = timeOfDay()
  const brand = home.data?.branding ?? null

  return (
    <Screen refreshControl={<RefreshControl refreshing={dash.loading} onRefresh={() => { void dash.reload(); void inbox.reload(); void home.reload(); void fitness.reload() }} tintColor={p.accent} />}>
      <CampaignPopup campaign={home.data?.campaign ?? null} />
      <FadeInUp index={0}>
        <Hero gradient={{ from: tod.from, to: tod.to }}>
          {/* brand header — date on the left, the studio name + logo on the right (from admin) */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
            <Body style={[t.caption, { color: p.onGradMuted }]}>{todayTr()}</Body>
            {brand?.appName || brand?.logoUrl ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexShrink: 1 }}>
                {brand?.appName ? <Body numberOfLines={1} style={{ color: p.onGrad, fontSize: 13, fontWeight: '800', letterSpacing: 0.2 }}>{brand.appName}</Body> : null}
                {brand?.logoUrl ? <Image source={{ uri: brand.logoUrl }} style={{ width: 34, height: 34, borderRadius: 10 }} resizeMode="contain" /> : null}
              </View>
            ) : null}
          </View>
          <Body style={[t.display, { color: p.onGrad }]}>{tod.hi}, {d ? d.memberName.split(' ')[0] : ''}</Body>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(1) }}>
            <Chip icon="calendar-outline" text={`${d?.upcoming.length ?? 0} yaklaşan ders`} />
            {pkg ? <Chip icon="ticket-outline" text={pkg.remaining === null ? 'Sınırsız' : `${pkg.remaining} ders`} /> : null}
          </View>
        </Hero>
      </FadeInUp>

      {banners.length > 0 ? <FadeInUp index={1}><BannerCarousel banners={banners} /></FadeInUp> : null}

      <FadeInUp index={2}>
        <Eyebrow>Stüdyodan</Eyebrow>
        {announcement ? (
          <Card level={1} onPress={() => router.push('/messages')} style={{ borderLeftWidth: 3, borderLeftColor: p.accent }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="megaphone-outline" size={18} color={p.accent} />
              <Body strong style={{ flex: 1 }} numberOfLines={1}>{announcement.subject}</Body>
              {!announcement.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} /> : null}
            </View>
            <Body muted numberOfLines={2}>{announcement.body}</Body>
          </Card>
        ) : (
          <Card inset><Body muted>Şu an yeni bir duyuru yok.</Body></Card>
        )}
        {occ ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space(2), paddingHorizontal: space(1) }}>
            <Ionicons name="people-outline" size={16} color={p.textMuted} />
            <Body muted style={{ fontSize: 13.5 }}>Salon yoğunluğu:</Body>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: occ.tone === 'good' ? p.good : occ.tone === 'warn' ? p.warn : p.danger }} />
            <Body strong style={{ fontSize: 13.5 }}>{occ.label}</Body>
          </View>
        ) : null}
      </FadeInUp>

      <FadeInUp index={3}>
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
              <Ionicons name="chevron-forward" size={20} color={p.textFaint} />
            </View>
          </Card>
        ) : (
          <Card><Empty icon={<Ionicons name="calendar-clear-outline" size={30} color={p.textFaint} />} text="Yaklaşan dersin yok. Ajanda'dan bir ders ayırt." /></Card>
        )}
      </FadeInUp>

      <FadeInUp index={4}>
        <Eyebrow>Katılımın</Eyebrow>
        <AttendanceCard visits={fitness.data?.visits ?? []} streak={fitness.data?.currentStreak ?? 0} last30={fitness.data?.last30Count ?? 0} />
      </FadeInUp>

      {d && d.packages.length > 0 ? (
        <FadeInUp index={5}>
          <Eyebrow right={<Body style={{ color: p.accent, fontWeight: '700', fontSize: 13 }} onPress={() => router.push('/subscriptions')}>Tümü</Body>}>
            {d.packages.length > 1 ? 'Aboneliklerin' : 'Aboneliğin'}
          </Eyebrow>
          <View style={{ gap: space(2.5) }}>
            {d.packages.map((pk) => (
              <Card key={pk.entitlementId} onPress={() => router.push('/subscriptions')}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Body strong numberOfLines={1}>{pk.productName}</Body>
                    <Body muted>Geçerli: {new Date(pk.validUntil).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</Body>
                  </View>
                  {pk.balanceDue > 0 ? <Pill label={`${formatKurus(pk.balanceDue)} borç`} tone="danger" /> : <Pill label="Ödendi" tone="good" />}
                </View>
                {pk.remaining !== null ? (
                  <View style={{ gap: 6 }}>
                    <ProgressBar value={pk.remaining / Math.max(pk.remaining, 8)} color={p.accent} track={p.surfaceMuted} />
                    <Body faint style={{ fontSize: 12.5 }}>{pk.remaining} ders kaldı</Body>
                  </View>
                ) : <Pill label="Sınırsız kullanım" tone="gold" />}
              </Card>
            ))}
          </View>
        </FadeInUp>
      ) : null}
    </Screen>
  )
}

function Chip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF22', paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: 999 }}>
      <Ionicons name={icon} size={15} color={p.onGrad} />
      <Body style={{ color: p.onGrad, fontWeight: '700', fontSize: 13 }}>{text}</Body>
    </View>
  )
}

// Tap a banner → its detail screen (image + full text + contact). Data rides in query params so the
// screen needs no extra fetch. `id` keys the gradient so two banners on one screen never collide.
function openBanner(b: HomeBanner) {
  router.push({ pathname: '/banner', params: { title: b.title, body: b.body, detail: b.detail ?? '', image: b.imageUrl ?? '', tone: b.tone } })
}

// The home banner(s) as a swipeable, admin-managed carousel. One banner → a plain card; several →
// paged horizontal scroll with a dot indicator.
function BannerCarousel({ banners }: { banners: readonly HomeBanner[] }) {
  const p = usePalette()
  const { width } = useWindowDimensions()
  const [idx, setIdx] = useState(0)
  const gap = space(3)
  const cardW = width - space(5) * 2 // Screen adds space(5) padding on each side
  if (banners.length === 1) return <BannerCard banner={banners[0]} onPress={() => openBanner(banners[0])} />
  return (
    <View style={{ gap: space(2.5) }}>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + gap}
        snapToAlignment="start"
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / (cardW + gap)))}
      >
        {banners.map((b, i) => (
          <View key={b.id ?? i} style={{ width: cardW, marginRight: gap }}>
            <BannerCard banner={b} onPress={() => openBanner(b)} />
          </View>
        ))}
      </Animated.ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        {banners.map((b, i) => (
          <View key={b.id ?? i} style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === idx ? p.accent : p.hairline }} />
        ))}
      </View>
    </View>
  )
}

function BannerCard({ banner, onPress }: { banner: HomeBanner; onPress?: () => void }) {
  const p = usePalette()
  const bg = banner.tone === 'gold' ? p.gold : banner.tone === 'good' ? p.good : p.accent
  const hasImage = Boolean(banner.imageUrl)
  const gid = `banner-${banner.id ?? banner.title}`
  const inner = (
    <View style={[{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: bg, minHeight: hasImage ? 148 : undefined, justifyContent: 'flex-end' }, shadow(2)]}>
      {hasImage ? (
        <>
          <Image source={{ uri: banner.imageUrl! }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" />
          {/* dark gradient (real opacity, not hex-alpha) so the text stays readable over any photo */}
          <GradientFill id={gid} vertical from="#000000" to="#000000" fromOpacity={0.05} toOpacity={0.82} />
        </>
      ) : (
        <View style={{ position: 'absolute', top: -40, right: -20, width: 130, height: 130, borderRadius: 65, backgroundColor: '#FFFFFF', opacity: 0.12 }} />
      )}
      <View style={{ padding: space(4.5), gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={18} color="#FFFFFF" />
          <Body style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 16, flex: 1 }} numberOfLines={1}>{banner.title}</Body>
        </View>
        <Body style={{ color: '#FFFFFFEE', fontSize: 14 }} numberOfLines={3}>{banner.body}</Body>
      </View>
    </View>
  )
  return onPress ? <PressableScale onPress={onPress}>{inner}</PressableScale> : inner
}

// A small weekly attendance bar chart — the last 6 weeks, animated on mount.
function AttendanceCard({ visits, streak, last30 }: { visits: readonly { at: number }[]; streak: number; last30: number }) {
  const p = usePalette()
  const weeks = 6
  const now = Date.now()
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const from = now - (weeks - i) * 7 * 86_400_000
    const to = now - (weeks - 1 - i) * 7 * 86_400_000
    return visits.filter((v) => v.at >= from && v.at < to).length
  })
  const max = Math.max(1, ...buckets)
  const hasData = visits.length > 0

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space(4) }}>
        <View style={{ minWidth: 70 }}>
          <Body style={[t.num, { color: p.accent }]}>{streak}</Body>
          <Body faint style={{ fontSize: 12 }}>hafta seri</Body>
          <Body strong style={{ marginTop: space(2), fontSize: 20 }}>{last30}</Body>
          <Body faint style={{ fontSize: 12 }}>son 30 gün</Body>
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {hasData ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2), height: 90 }}>
              {buckets.map((c, i) => <Bar key={i} ratio={c / max} index={i} color={p.accent} track={p.surfaceMuted} />)}
            </View>
          ) : (
            <View style={{ height: 90, alignItems: 'center', justifyContent: 'center' }}>
              <Body faint style={{ textAlign: 'center', fontSize: 13 }}>Katılımların burada grafiğe dönüşecek. İlk dersini işaretlet!</Body>
            </View>
          )}
        </View>
      </View>
    </Card>
  )
}

function Bar({ ratio, index, color, track }: { ratio: number; index: number; color: string; track: string }) {
  const h = useSharedValue(0)
  useEffect(() => { h.value = withDelay(300 + index * 90, withTiming(Math.max(0.06, ratio), { duration: 650, easing: Easing.out(Easing.cubic) })) }, [h, ratio, index])
  const style = useAnimatedStyle(() => ({ height: `${h.value * 100}%` }))
  return (
    <View style={{ flex: 1, height: '100%', backgroundColor: track, borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' }}>
      <Animated.View style={[{ backgroundColor: color, borderRadius: 8 }, style]} />
    </View>
  )
}
