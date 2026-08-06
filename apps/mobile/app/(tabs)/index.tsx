import { Image, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, Easing } from 'react-native-reanimated'
import { useEffect, useState } from 'react'

import { compareMeasurements } from '@studio/core/client'
import type { HomeBanner } from '@/lib/api'
import { api } from '@/lib/api'
import { dateTime, formatKurus, shortDate } from '@/lib/format'
import { motivationLine } from '@/lib/motivation'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Body, Card, Empty, Eyebrow, Figure, GradientFill, Pill, Rule, Screen, ScreenSkeleton, SectionLabel, TopStrip } from '@/components/ui'
import { CampaignPopup } from '@/components/campaign-popup'
import { radius, shadow, space, typo as t, usePalette, trUpper } from '@/theme'

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
const dayKeyTr = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' })
// "Bugün" / "Yarın" / "Cuma, 7 Ağustos" — the class time means more with a human day beside it.
const relDayTr = (ms: number): string => {
  if (dayKeyTr(ms) === dayKeyTr(Date.now())) return 'Bugün'
  if (dayKeyTr(ms) === dayKeyTr(Date.now() + 86_400_000)) return 'Yarın'
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' })
}

const todayTr = () => new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
// "Bugün" / "Yarın" / "Cuma" — the heading over the timetable strip, one word wide.
const dayWordTr = (ms: number): string => {
  if (dayKeyTr(ms) === dayKeyTr(Date.now())) return 'Bugün'
  if (dayKeyTr(ms) === dayKeyTr(Date.now() + 86_400_000)) return 'Yarın'
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' })
}

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
  // What the studio is running next — see the timetable strip below.
  const agenda = useFetch(api.agenda)
  // Her body, and what she is working on. Both live on other tabs in full; Bugün shows one line of
  // each, because a member who never opens a tab never learns the tab exists.
  const training = useFetch(api.training)

  if (dash.loading && !dash.data) return <ScreenSkeleton />
  const d = dash.data
  const next = d?.upcoming[0] ?? null
  const pkg = d?.packages[0] ?? null
  const announcement = (inbox.data ?? []).find((m) => !m.read) ?? (inbox.data ?? [])[0] ?? null
  const banners = home.data?.banners ?? (home.data?.banner ? [home.data.banner] : [])
  const occ = home.data?.occupancyLevel ? OCC[home.data.occupancyLevel] : null
  const tod = timeOfDay()
  const brand = home.data?.branding ?? null
  const motivation = motivationLine(reservations.data?.past ?? [], Date.now())

  // The next day the studio is actually open, and what runs on it. Four rows at most — this is a
  // glance, and Ajanda is one tap away for the rest.
  const upcomingSessions = (agenda.data?.sessions ?? []).filter((s) => s.startsAt > Date.now()).sort((a, b) => a.startsAt - b.startsAt)
  const stripDayKey = upcomingSessions[0] ? dayKeyTr(upcomingSessions[0].startsAt) : null
  const strip = stripDayKey ? upcomingSessions.filter((s) => dayKeyTr(s.startsAt) === stripDayKey).slice(0, 4) : []

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
  const booksClasses = next !== null || upcomingSessions.length > 0

  // What is left, said the way each kind of package actually counts: a credit package counts
  // lessons, a period membership counts days. `null` remaining ⇒ unlimited ⇒ days are the story.
  const daysLeft = pkg ? Math.ceil((pkg.validUntil - Date.now()) / 86_400_000) : null
  const pkgRunningOut =
    pkg !== null && ((pkg.remaining !== null && pkg.remaining <= 2) || (daysLeft !== null && daysLeft <= 7))

  // Her last reading and the change since the one before it. `compareMeasurements` is the SAME
  // function the Ölçümlerim table uses — one arithmetic, so the two screens can never disagree.
  const measurements = training.data?.measurements ?? []
  const lastM = measurements[0] ?? null
  const mChange = compareMeasurements(measurements)
  const weightDelta = mChange?.rows.find((r) => r.key === 'weightKg')?.diff ?? null

  return (
    <Screen refreshControl={<RefreshControl refreshing={dash.loading} onRefresh={() => { void dash.reload(); void inbox.reload(); void home.reload(); void fitness.reload(); void agenda.reload(); void training.reload() }} tintColor={p.accent} />}>
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

      {/* THE BLOCK THAT CHANGES. For a member who books, it is her next class — the largest thing on
          the page, because it is why she opened the app. For a fitness member it is how busy the
          room is right now, which is the same question in her world: "is now a good time to go".
          Occupancy used to be a six-word line at the very bottom; for half the membership it was the
          most useful fact on the screen, set in the smallest type. */}
      {booksClasses ? (
        <FadeInUp index={1}>
          <View style={{ gap: space(3) }}>
            <Rule />
            <SectionLabel right={next ? <Body style={{ color: p.accent, fontWeight: '700', fontSize: 12.5 }} onPress={() => router.push('/reservations')}>Tümü</Body> : undefined}>
              Sıradaki dersin
            </SectionLabel>
            {next ? (
              <Pressable onPress={() => router.push('/reservations')}>
                <View style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2.5) }}>
                    <Body style={[t.num, { color: p.text }]}>{hhmm(next.startsAt)}</Body>
                    <Body strong muted>{relDayTr(next.startsAt)}</Body>
                  </View>
                  <Body strong style={{ fontSize: 16 }}>{next.serviceName}</Body>
                  <Body muted style={{ fontSize: 13 }}>
                    {[next.trainerName, next.roomName].filter(Boolean).join(' · ') || 'Detaylar rezervasyonlarında'}
                  </Body>
                </View>
              </Pressable>
            ) : (
              <Body muted>Yaklaşan dersin yok — aşağıdan bir ders seçebilirsin.</Body>
            )}
          </View>
        </FadeInUp>
      ) : occ ? (
        <FadeInUp index={1}>
          <View style={{ gap: space(3) }}>
            <Rule />
            <SectionLabel>Salon şu an</SectionLabel>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: occ.tone === 'good' ? p.good : occ.tone === 'warn' ? p.warn : p.danger }} />
                <Body style={[t.h1, { color: p.text }]}>{occ.label}</Body>
              </View>
              {/* One sentence of judgement, not a second data point. She came for the answer, not
                  the reading. */}
              <Body muted style={{ fontSize: 13.5 }}>
                {occ.tone === 'good'
                  ? 'Gelmek için iyi bir zaman.'
                  : occ.tone === 'warn'
                    ? 'Biraz hareketli — aletlerde sıra olabilir.'
                    : 'Şu an kalabalık. Biraz sonrası daha rahat olur.'}
              </Body>
            </View>
          </View>
        </FadeInUp>
      ) : null}

      {/* ÜYELİĞİN. What she has left, counted the way her package counts: a credit package counts
          lessons, a period membership counts days. It sat three taps away on Ben, which meant the
          member most likely to renew — the one about to run out — was the least likely to know. */}
      {pkg ? (
        <FadeInUp index={2}>
          <Pressable onPress={() => router.push('/subscriptions')}>
            <View style={{ gap: space(2.5) }}>
              <SectionLabel right={<Body style={{ color: p.accent, fontWeight: '700', fontSize: 12.5 }}>Tümü</Body>}>Üyeliğin</SectionLabel>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(3) }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Body strong style={{ fontSize: 15 }} numberOfLines={1}>{pkg.productName}</Body>
                  <Body style={{ fontSize: 13, color: pkgRunningOut ? p.warn : p.textMuted, fontWeight: pkgRunningOut ? '700' : '400' }}>
                    {pkg.remaining !== null ? `${pkg.remaining} ders hakkın kaldı` : 'Sınırsız kullanım'}
                    {daysLeft !== null && daysLeft > 0 ? ` · ${daysLeft} gün geçerli` : ''}
                  </Body>
                </View>
                {pkg.remaining !== null ? <Figure value={String(pkg.remaining)} unit="ders" /> : null}
              </View>
            </View>
          </Pressable>
        </FadeInUp>
      ) : null}

      {/* GELİŞİMİN. Her last reading and the movement since the one before — the number a member
          actually comes back to look at, previously parked on a tab she may never open. The delta is
          a DIRECTION, never a verdict: a member who traded fat for muscle must not be told she got
          worse, which is why sage means "moved" and not "improved". */}
      {lastM && lastM.weightKg !== null ? (
        <FadeInUp index={3}>
          <Pressable onPress={() => router.push('/(tabs)/training')}>
            <View style={{ gap: space(2.5) }}>
              <SectionLabel right={<Body style={{ color: p.accent, fontWeight: '700', fontSize: 12.5 }}>Tümü</Body>}>Gelişimin</SectionLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(3) }}>
                <Body style={[t.numSm, { color: p.text, fontSize: 22 }]}>{String(lastM.weightKg).replace('.', ',')}</Body>
                <Body faint style={{ fontSize: 12.5 }}>kg</Body>
                {weightDelta !== null && weightDelta !== 0 ? (
                  <Body style={{ fontSize: 13, fontWeight: '700', color: p.good }}>
                    {weightDelta > 0 ? '↑' : '↓'} {String(Math.abs(weightDelta)).replace('.', ',')}
                  </Body>
                ) : null}
                <Body faint style={{ flex: 1, fontSize: 12, textAlign: 'right' }}>
                  {mChange ? `${mChange.days} gün önceye göre` : shortDate(lastM.takenOn)}
                </Body>
              </View>
            </View>
          </Pressable>
        </FadeInUp>
      ) : null}

      {/* The studio's own day, in four lines. Her own class carries the mahogany rail, exactly as it
          does in Ajanda — the same mark for the same fact, on both screens. */}
      {strip.length > 0 && booksClasses ? (
        <FadeInUp index={4}>
          <View style={{ gap: space(3) }}>
            <SectionLabel right={<Body style={{ color: p.accent, fontWeight: '700', fontSize: 12.5 }} onPress={() => router.push('/agenda')}>Ajanda</Body>}>
              {dayWordTr(strip[0].startsAt)} stüdyoda
            </SectionLabel>
            <Pressable onPress={() => router.push('/agenda')}>
              {strip.map((s, i) => {
                const seatsLeft = Math.max(0, s.capacity - s.bookedCount)
                return (
                  <View
                    key={s.sessionId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: space(3),
                      paddingVertical: space(2.5),
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth * 2,
                      borderColor: p.hairline,
                      borderLeftWidth: s.alreadyBooked ? 2 : 0,
                      borderLeftColor: p.accent,
                      paddingLeft: s.alreadyBooked ? space(3) : 0,
                    }}
                  >
                    <Body style={[t.numSm, { width: 54, color: s.alreadyBooked ? p.accent : p.text }]}>{hhmm(s.startsAt)}</Body>
                    <Body strong style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>{s.serviceName}</Body>
                    <Body faint style={{ fontSize: 11.5 }}>
                      {s.alreadyBooked ? 'Senin' : seatsLeft === 0 ? 'Dolu' : `${seatsLeft} yer`}
                    </Body>
                  </View>
                )
              })}
            </Pressable>
          </View>
        </FadeInUp>
      ) : null}

      {/* Two figures she reads as facts about herself: what is left, and what she did. */}
      {(fitness.data?.last30Count ?? 0) > 0 ? (
        <FadeInUp index={4}>
          <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth * 2, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.hairline, paddingVertical: space(4) }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Figure value={String(fitness.data?.last30Count ?? 0)} unit="ders" />
              <Body faint style={{ fontSize: 11.5 }}>Son 30 gün</Body>
            </View>
          </View>
        </FadeInUp>
      ) : null}

      {banners.length > 0 ? <FadeInUp index={4}><BannerCarousel banners={banners} /></FadeInUp> : null}

      {/* The note from the studio. This box already carried the Notification Centre's message — the
          same one reception writes and sends — but it never said WHO it was from, so it read as a
          system notice rather than someone at the desk writing to her. A named sender is the whole
          difference between an alert and a note (owner: "Pilates Fitness by Işıl'dan sana not").
          The name comes from branding, so a second studio signs its own messages. */}
      {announcement ? (
        <FadeInUp index={5}>
          <Pressable onPress={() => router.push('/messages')}>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <View style={{ width: 2, borderRadius: 2, backgroundColor: p.accent }} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <Body style={[t.eyebrow, { flex: 1, fontSize: 9.5, color: p.accent }]} numberOfLines={1}>
                    {trUpper(`${brand?.appName ?? 'Stüdyo'}'dan sana not`)}
                  </Body>
                  {!announcement.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.accent }} /> : null}
                </View>
                <Body strong style={{ fontSize: 14.5 }} numberOfLines={1}>{announcement.subject}</Body>
                <Body muted numberOfLines={2} style={{ fontSize: 13.5 }}>{announcement.body}</Body>
              </View>
            </View>
          </Pressable>
        </FadeInUp>
      ) : null}

      {/* For a member who books, occupancy stays a footnote — her day is decided by her reservation,
          not by the room. For everyone else it is already the headline above, and printing it twice
          would say it matters less, not more. */}
      {occ && booksClasses ? (
        <FadeInUp index={6}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body faint style={{ fontSize: 13 }}>Salon yoğunluğu</Body>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: occ.tone === 'good' ? p.good : occ.tone === 'warn' ? p.warn : p.danger }} />
            <Body strong style={{ fontSize: 13 }}>{occ.label}</Body>
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
