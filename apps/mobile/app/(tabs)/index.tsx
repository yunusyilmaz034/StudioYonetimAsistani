import { Image, RefreshControl, useWindowDimensions, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, Easing } from 'react-native-reanimated'
import { useEffect, useMemo, useState } from 'react'

import { compareMeasurements } from '@studio/core/client'
import type { HomeBanner } from '@/lib/api'
import { api } from '@/lib/api'
import { dateTime, formatKurus, shortDate } from '@/lib/format'
import { motivationLine } from '@/lib/motivation'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Figure, GradientFill, Pill, Screen, ScreenSkeleton, TopStrip } from '@/components/ui'
import { DynamicBanner, EmptyState, MetricCard, PremiumCard, SectionHeader, StatusChip, StudioMessageCard, Txt } from '@/components/kit'
import { CampaignPopup } from '@/components/campaign-popup'
import { ConsistencyStrip } from '@/components/consistency-strip'
import { radius, shadow, space, typo as t, usePalette } from '@/theme'

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const dayKeyTr = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
// "Bugün" / "Yarın" / "Cuma, 7 Ağustos" — the class time means more with a human day beside it.
const relDayTr = (ms: number): string => {
  if (dayKeyTr(ms) === dayKeyTr(Date.now())) return 'Bugün'
  if (dayKeyTr(ms) === dayKeyTr(Date.now() + 86_400_000)) return 'Yarın'
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' })
}

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
  // Her own past classes — the only thing the line under her name is allowed to speak from.
  const reservations = useFetch(api.reservations)
  // Still fetched: `booksClasses` is derived from it, and the hero needs to know she books at all.
  const agenda = useFetch(api.agenda)
  // Her body, and what she is working on. Both live on other tabs in full; Bugün shows one line of
  // each, because a member who never opens a tab never learns the tab exists.
  const training = useFetch(api.training)
  // WHICH programme this line speaks for. A member can hold more than one active programme — the
  // test account has two — and "the first active one" silently picked the wrong one, which would
  // have told a member who trains three times a week that she has never trained at all.
  //
  // The one she is actually ON is the one she has trained most recently. `lastWorkoutProgramId` is
  // her own answer to that; the server's `activeProgram` is only the fallback for someone who has
  // not started yet.
  const activeProgramId =
    training.data?.lastWorkoutProgramId ?? training.data?.activeProgram?.id ?? training.data?.programs?.[0]?.id ?? null
  // No programme ⇒ an empty cycle rather than a null loader: `useFetch` always runs, and a hook
  // that sometimes exists is how a render order bug gets in.
  const workout = useFetch(
    useMemo(
      () =>
        activeProgramId
          ? () => api.workout(activeProgramId)
          : async () => ({ cycle: { completed: 0, nextDayOrder: 1, rounds: 0 }, logs: [], dayCount: 0 }),
      [activeProgramId],
    ),
    [activeProgramId],
  )

  if (dash.loading && !dash.data) return <ScreenSkeleton />
  const d = dash.data
  const next = d?.upcoming[0] ?? null
  const announcement = (inbox.data ?? []).find((m) => !m.read) ?? (inbox.data ?? [])[0] ?? null
  const banners = home.data?.banners ?? (home.data?.banner ? [home.data.banner] : [])
  const occ = home.data?.occupancyLevel ? OCC[home.data.occupancyLevel] : null
  const tod = timeOfDay()
  const brand = home.data?.branding ?? null
  const motivation = motivationLine(reservations.data?.past ?? [], Date.now())


  // ── TWO MEMBERS, TWO DAYS (owner, 2026-08-06) ─────────────────────────────────────────────
  //
  // The studio has two daily rhythms and this screen used to answer only one of them.
  //
  //   · a PILATES member books. Her question is "when is my class, is there a seat".
  //   · a FITNESS member books NOTHING — the membership is unlimited entry, resolved at the door.
  //     Her agenda is empty and always will be, so a screen built around a reservation is not
  //     empty today, it is empty forever. That is why the test account looked bare ("anasayfa çok
  //     boş kaldı") — not a rendering fault, a wrong premise.
  //
  // `booksClasses` decides which day this member has, and it is derived from what the SERVER lets
  // her see rather than guessed from a category name: if she has a reservation or the agenda offers
  // her a session, she is someone who books. A hybrid member gets the booking screen, correctly —
  // she has both.
  const booksClasses =
    next !== null || (agenda.data?.sessions ?? []).some((sn) => sn.startsAt > Date.now())

  // Her last reading and the change since the one before it. `compareMeasurements` is the SAME
  // function the Ölçümlerim table uses — one arithmetic, so the two screens can never disagree.
  const measurements = training.data?.measurements ?? []
  const lastM = measurements[0] ?? null
  const mChange = compareMeasurements(measurements)
  const weightDelta = mChange?.rows.find((r) => r.key === 'weightKg')?.diff ?? null

  // What she has ACCUMULATED on her programme — never what she missed (OR-33). Silent until she has
  // actually done one, because "0 antrenman" is a scoreboard, not an encouragement.
  const wc = workout.data?.cycle ?? null
  const workoutLine =
    wc && wc.completed > 0
      ? `${wc.rounds > 0 ? `${wc.rounds}. turdasın` : 'İlk turundasın'} · toplam ${wc.completed} antrenman`
      : null

  return (
    <Screen refreshControl={<RefreshControl refreshing={dash.loading} onRefresh={() => { void dash.reload(); void inbox.reload(); void home.reload(); void fitness.reload(); void agenda.reload(); void training.reload(); void workout.reload() }} tintColor={p.accent} />}>
      <CampaignPopup campaign={home.data?.campaign ?? null} />
      {/* The opening. A gradient band with her name in it became bone paper with her name ON it —
          and one true sentence underneath, which is the whole point of this screen (owner: "üyeye
          motivasyon bildirimi gönderebileceğimiz bir alan vardı, o güzel"). The line speaks only
          from her own attendance and says NOTHING when it cannot stand behind what it would say;
          see lib/motivation.ts. */}
      <FadeInUp index={0}>
        <View style={{ gap: space(4) }}>
          <TopStrip label={todayTr()} onQr={() => router.push('/qr')} />
          <View style={{ gap: space(2) }}>
            <Body style={[t.display, { color: p.text }]}>
              {tod.hi}, {d ? d.memberName.split(' ')[0] : ''}
            </Body>
            {motivation ? <Body style={[t.voice, { color: p.textMuted }]}>{motivation}</Body> : null}
          </View>
        </View>
      </FadeInUp>

      {/* THE ORDER IS THE OWNER'S (2026-08-14). Greeting, then the studio's own two cards — the
          campaign and the note somebody at the desk wrote — then how busy the room is, and only
          then her own things. What the STUDIO is saying comes before what the app has computed. */}
      {banners.length > 0 ? <FadeInUp index={4}><BannerCarousel banners={banners} /></FadeInUp> : null}
      {/* The note from the studio. This box already carried the Notification Centre's message — the
          same one reception writes and sends — but it never said WHO it was from, so it read as a
          system notice rather than someone at the desk writing to her. A named sender is the whole
          difference between an alert and a note (owner: "Pilates Fitness by Işıl'dan sana not").
          The name comes from branding, so a second studio signs its own messages. */}
      {announcement ? (
        <FadeInUp index={5}>
          {/* The card writes "…'dan sana not" itself — pass the NAME only, or it says it twice. */}
          <StudioMessageCard
            sender={brand?.appName ?? 'Stüdyo'}
            title={announcement.subject}
            body={announcement.body}
            unread={!announcement.read}
            onPress={() => router.push('/messages')}
          />
        </FadeInUp>
      ) : null}

      {/* Occupancy sits directly under the studio's note, for everyone. It used to be a footnote for
          members who book and a headline for those who do not; one place, one treatment. */}
      {occ ? (
        <FadeInUp index={2}>
          <PremiumCard onPress={() => router.push('/(tabs)/agenda')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: occ.tone === 'good' ? p.success : occ.tone === 'warn' ? p.warning : p.error }} />
              <Txt role="h3" style={{ flex: 1 }} numberOfLines={1}>{occ.label}</Txt>
              <Txt role="caption" tone="muted">salon</Txt>
            </View>
          </PremiumCard>
        </FadeInUp>
      ) : null}

      {/* HER NEXT CLASS — the first thing she came for. A card now, because the Board's language is
          layered surfaces; the figure still leads and the block is still the link. */}
      {booksClasses && next ? (
        <FadeInUp index={3}>
          <View>
            <SectionHeader action="Tümü" onAction={() => router.push('/reservations')}>Sıradaki dersin</SectionHeader>
            <PremiumCard onPress={() => router.push('/reservations')}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(4) }}>
                <View>
                  <Txt role="body" tone="brand" numberOfLines={1} style={[t.num, { fontSize: 30 }]}>{hhmm(next.startsAt)}</Txt>
                  <Txt role="caption" tone="muted">{relDayTr(next.startsAt)}</Txt>
                </View>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Txt role="h3" numberOfLines={1}>{next.serviceName}</Txt>
                  {[next.trainerName, next.roomName].filter(Boolean).length > 0 ? (
                    <Txt role="caption" tone="muted" numberOfLines={1}>
                      {[next.trainerName, next.roomName].filter(Boolean).join(' · ')}
                    </Txt>
                  ) : null}
                  <View style={{ flexDirection: 'row', marginTop: space(1.5) }}>
                    <StatusChip label="Katılıyorum" tone="success" />
                  </View>
                </View>
              </View>
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : booksClasses ? (
        <FadeInUp index={3}>
          <EmptyState
            icon="calendar-outline"
            title="Yaklaşan dersin yok"
            body="Uygun dersleri görüp yerini ayırtabilirsin."
            cta="Ders ara"
            onCta={() => router.push('/(tabs)/agenda')}
          />
        </FadeInUp>
      ) : null}

      {/* GELİŞİMİN. Her last reading and the movement since the one before — the number a member
          actually comes back to look at, previously parked on a tab she may never open. The delta is
          a DIRECTION, never a verdict: a member who traded fat for muscle must not be told she got
          worse, which is why sage means "moved" and not "improved". */}
      {lastM && lastM.weightKg !== null ? (
        <FadeInUp index={3}>
          <View>
            <SectionHeader>Gelişimin</SectionHeader>
            <MetricCard
              label="Son ölçümün"
              value={String(lastM.weightKg).replace('.', ',')}
              unit="kg"
              delta={
                weightDelta !== null && weightDelta !== 0
                  ? `${weightDelta > 0 ? '↑' : '↓'} ${String(Math.abs(weightDelta)).replace('.', ',')}`
                  : null
              }
              note={mChange ? `${mChange.days} gün önceye göre` : shortDate(lastM.takenOn)}
              onPress={() => router.push('/(tabs)/training')}
            />
          </View>
        </FadeInUp>
      ) : null}

      {/* Two figures she reads as facts about herself: what is left, and what she did. */}
      {/* DEVAMLILIK — the door, and only the door. Renders only once there is a pattern worth
          showing; see components/consistency-strip.tsx for why an empty chart is worse than none. */}
      {(fitness.data?.recent?.length ?? 0) >= 3 ? (
        <FadeInUp index={4}>
          <View>
            <SectionHeader>Devamlılığın</SectionHeader>
            <PremiumCard>
              <ConsistencyStrip recent={fitness.data?.recent ?? []} now={Date.now()} />
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      {/* ANTRENMAN — her own declaration, deliberately a separate block with its own label. One
          line rather than a chart: two logged workouts do not make a graph, they make decoration.
          The history lives on the Antrenman tab, which this row opens. */}
      {workoutLine ? (
        <FadeInUp index={4}>
          <View>
            <SectionHeader>Antrenmanın</SectionHeader>
            <PremiumCard onPress={() => router.push('/(tabs)/training')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <Ionicons name="barbell-outline" size={19} color={p.primary} />
                <Txt role="h3" style={{ flex: 1 }}>{workoutLine}</Txt>
                <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
              </View>
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      {/* ÜYELİĞİN — a door, not a summary (owner, 2026-08-06). It stood second on the page with the
          package name, the days left and a figure; that is the Aboneliklerim screen's whole job, said
          twice, and the second telling was the one with less room to say it properly. So it drops to
          the foot of the page and carries one thing: the way in. What is left is genuinely useful,
          but "84 gün geçerli" is not why she opened the app at 18:00 on a Thursday. */}
      <FadeInUp index={7}>
        <PremiumCard onPress={() => router.push('/subscriptions')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Ionicons name="ticket-outline" size={19} color={p.textSecondary} />
            <Txt role="h3" style={{ flex: 1 }}>Aboneliklerim</Txt>
            <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
          </View>
        </PremiumCard>
      </FadeInUp>


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
