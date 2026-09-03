import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useFocusEffect } from 'expo-router'

import type { MemberProfile, MemberSubscriptions, NotificationPrefs } from '@studio/core/client'
import { api } from '@/lib/api'
import { localDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { useAuth } from '@/lib/auth'
import { FadeInUp } from '@/components/motion'
import { Body, Screen, ScreenSkeleton, TopStrip } from '@/components/ui'
import { PremiumCard, SectionHeader, TextButton, Txt } from '@/components/kit'
import { space, typo as t, usePalette, trUpper } from '@/theme'

// ── BEN — her page, not a settings page (owner-approved, 2026-08-06) ─────────────────────────
//
// Üyeliğim, Cüzdanım and Profil were three tabs answering one question: what am I, where do I
// stand. They are one screen now, and the order encodes the answer — what is HERS at the top
// (membership, attendance), the administration underneath.
//
// The old screen opened with e-mail and date of birth: three fields nobody checks, all of them empty
// for most members, occupying the most valuable space on the page. It now opens with what she has
// left of her package.
//
// Nothing was removed. Wallet, contact, notification switches, edit, sign out and account deletion
// are all still here, further down and in one column of hairline rows instead of four stacked cards.

const CHANNELS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: 'push', label: 'Uygulama bildirimleri' },
  { key: 'email', label: 'E-posta' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'campaign', label: 'Kampanya / duyuru' },
]

const ATTENDED = new Set(['attended', 'auto_resolved', 'presumed_attended'])

export default function Ben() {
  const p = usePalette()
  const { signOutMember } = useAuth()
  const { data: profile, loading, reload } = useFetch(api.profile)
  const { data: loadedPrefs } = useFetch(api.prefs)
  const subs = useFetch(api.subscriptions)
  const fitness = useFetch(api.fitness)
  const reservations = useFetch(api.reservations)
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  useEffect(() => {
    if (loadedPrefs) setPrefs(loadedPrefs)
  }, [loadedPrefs])
  // Re-fetch when the tab regains focus — so a photo (or info) changed on the edit screen shows here.
  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  if (loading && !profile) return <ScreenSkeleton />
  const pr = profile as MemberProfile | null
  const active = (subs.data as MemberSubscriptions | null)?.active ?? []
  const pack = active[0] ?? null

  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      await api.setPrefs(next)
    } catch {
      setPrefs(prefs)
    }
  }

  const initials = (pr?.fullName ?? '').split(' ').map((s) => s[0]).slice(0, 2).join('').toLocaleUpperCase('tr')

  // Her attendance, from her own record. The 21 squares are the last three weeks: a day she came is
  // filled. No new data is collected — all of this was already in the system and simply never shown
  // to her, which is the whole reason it is here.
  const past = reservations.data?.past ?? []
  const attendedDays = new Set(
    past.filter((r) => ATTENDED.has(r.status)).map((r) => new Date(r.startsAt).toDateString()),
  )
  const days = Array.from({ length: 21 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (20 - i))
    return attendedDays.has(d.toDateString())
  })
  const thisYear = past.filter((r) => ATTENDED.has(r.status) && new Date(r.startsAt).getFullYear() === new Date().getFullYear()).length

  return (
    <Screen>
      <FadeInUp index={0}>
        <View style={{ gap: space(5) }}>
          <TopStrip label="Üyelik" onQr={() => router.push('/qr')} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3.5) }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: p.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Body style={[t.h1, { color: p.primary, fontSize: 19 }]}>{initials}</Body>
            </View>
            <View style={{ flex: 1, gap: space(1) }}>
              <Txt role="h1" numberOfLines={1}>{pr?.fullName}</Txt>
              <Txt role="caption" tone="muted">{pr?.phone}</Txt>
            </View>
          </View>
        </View>
      </FadeInUp>

      {pack ? (
        <FadeInUp index={1}>
          <View>
            <SectionHeader>Üyeliğim</SectionHeader>
            <PremiumCard onPress={() => router.push('/subscriptions')}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space(3) }}>
              <View style={{ flex: 1, gap: space(1) }}>
                <Txt role="h3" numberOfLines={2}>{pack.productName}</Txt>
                <Txt role="caption" tone="muted">
                  {new Date(pack.validUntil).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}&apos;e kadar geçerli
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Body style={[t.num, { color: p.textPrimary }]}>{pack.remaining === null ? '∞' : pack.remaining}</Body>
                <Body style={[t.label, { color: p.textMuted }]}>{trUpper(pack.remaining === null ? 'sınırsız' : 'ders kaldı')}</Body>
              </View>
            </View>
            {/* How much of the package is left, as a line rather than a number repeated. */}
            {pack.remaining !== null && pack.total ? (
              <View style={{ height: 4, borderRadius: 2, backgroundColor: p.surfaceMuted, overflow: 'hidden', marginTop: space(3) }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: p.primary, width: `${Math.round((pack.remaining / pack.total) * 100)}%` }} />
              </View>
            ) : null}
            {/* HİBRİTİN ÖBÜR YARISI (owner, 2026-09-03). Bu kart tek bir sayı gösterir — paketin
                "kaç ders" yüzü. Bir demette ikinci bir yüz daha var (fitness girişi), ve demet artık
                TEK kart olarak geldiği için "tümünü gör" bağlantısı da kaybolmuştu: üye giriş
                hakkını hiçbir yerde göremez olurdu. Bir satır, yalnızca gerçekten varsa. */}
            {pack.fitnessEntry ? (
              <Txt role="caption" tone="muted" style={{ marginTop: space(2) }}>
                {`+ ${Math.max(0, pack.fitnessEntry.allowance - pack.fitnessEntry.used)} / ${pack.fitnessEntry.allowance} fitness girişi`}
              </Txt>
            ) : null}
            {active.length > 1 || (pack.components?.length ?? 1) > 1 ? (
              <View style={{ marginTop: space(3) }}>
                <TextButton
                  label={active.length > 1 ? `${active.length} aktif paketin var — tümünü gör` : 'Paketimin ayrıntısı'}
                  onPress={() => router.push('/subscriptions')}
                />
              </View>
            ) : null}
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      {thisYear > 0 ? (
        <FadeInUp index={2}>
          <View>
            <SectionHeader>Bu yıl</SectionHeader>
            <PremiumCard>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2.5) }}>
              <Body style={[t.num, { color: p.textPrimary }]}>{thisYear}</Body>
              <Body style={[t.body, { flex: 1, color: p.textSecondary }]}>
                derse geldin{(fitness.data?.stats?.currentStreakWeeks ?? 0) > 1 ? ` · şu an ${fitness.data?.stats?.currentStreakWeeks} haftalık serin var` : ''}
              </Body>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: 7 * 15, marginTop: space(3) }}>
              {days.map((came, i) => (
                <View key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: came ? p.primary : p.surfaceMuted }} />
              ))}
            </View>
            <Txt role="caption" tone="muted" style={{ marginTop: space(2) }}>Son üç hafta</Txt>
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      <FadeInUp index={3}>
        <View>
          <SectionHeader action="Düzenle" onAction={() => router.push('/profile-edit')}>Bilgilerim</SectionHeader>
          <PremiumCard>
            <InfoRow label="E-posta" value={pr?.email ?? '—'} />
            <InfoRow label="Doğum tarihi" value={pr?.birthDate ? localDate(pr.birthDate) : '—'} />
            <InfoRow label="Acil durum" value={pr?.emergencyName ? `${pr.emergencyName} · ${pr.emergencyPhone}` : '—'} last />
          </PremiumCard>
        </View>
      </FadeInUp>

      <FadeInUp index={4}>
        <View>
          <SectionHeader>Hesap</SectionHeader>
          <PremiumCard>
            <LinkRow icon="mail-outline" label="Mesajlarım" onPress={() => router.push('/messages')} />
            <LinkRow icon="time-outline" label="Geçmiş rezervasyonlarım" onPress={() => router.push('/reservations')} />
            <LinkRow icon="wallet-outline" label="Cüzdanım" onPress={() => router.push('/wallet')} />
            <LinkRow icon="call-outline" label="İletişim" onPress={() => router.push('/contact')} last />
          </PremiumCard>
        </View>
      </FadeInUp>

      <FadeInUp index={5}>
        <View>
          <SectionHeader>Bildirimler</SectionHeader>
          <PremiumCard>
            {prefs ? (
              CHANNELS.map((c, i) => (
                <View
                  key={c.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(3),
                    paddingVertical: space(2.5),
                    borderBottomWidth: i === CHANNELS.length - 1 ? 0 : StyleSheet.hairlineWidth * 2,
                    borderColor: p.border,
                  }}
                >
                  <Txt role="body" style={{ flex: 1 }}>{c.label}</Txt>
                  <Switch
                    value={Boolean(prefs[c.key])}
                    onValueChange={(v) => void toggle(c.key, v)}
                    trackColor={{ true: p.primary, false: p.surfaceMuted }}
                  />
                </View>
              ))
            ) : (
              <Txt role="body" tone="muted">Yükleniyor…</Txt>
            )}
          </PremiumCard>
        </View>
      </FadeInUp>

      <FadeInUp index={6}>
        <View style={{ marginTop: space(2) }}>
          <Pressable onPress={() => void signOutMember()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: space(3.5) })}>
            <Txt role="h3" tone="brand">Çıkış yap</Txt>
          </Pressable>
          {/* App Store guideline 5.1.1(v) — an app with accounts must let her delete hers from inside
              it. Placed LAST and styled quietly on purpose: it is a real, irreversible action and it
              should not sit where a thumb lands by accident. Two taps, and the second one spells out
              what will and will not be deleted — a confirmation that only says "emin misiniz?" tells
              her nothing. */}
          <Pressable
            onPress={() =>
              Alert.alert(
                'Hesabını sil',
                'Girişin kalıcı olarak silinir ve uygulamaya bir daha giremezsin.\n\n' +
                  'Ödeme ve fatura kayıtların, yasal saklama süresi boyunca stüdyoda kalır — bunu ' +
                  'silmek yasal olarak mümkün değil. Kişisel bilgilerinin silinmesi için stüdyoya ' +
                  'talebin iletilir.\n\nDevam etmek istiyor musun?',
                [
                  { text: 'Vazgeç', style: 'cancel' },
                  {
                    text: 'Hesabımı sil',
                    style: 'destructive',
                    onPress: () => {
                      void (async () => {
                        try {
                          await api.deleteAccount()
                        } catch {
                          // Her login may already be gone (a second tap, a slow network). Signing out
                          // is right either way — leaving her inside a deleted account is the one
                          // outcome that would be wrong.
                        }
                        await signOutMember()
                      })()
                    },
                  },
                ],
              )
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingBottom: space(4) })}
          >
            <Txt role="caption" tone="muted">Hesabımı sil</Txt>
          </Pressable>
        </View>
      </FadeInUp>
    </Screen>
  )
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const p = usePalette()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: space(3),
        paddingVertical: space(2.5),
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: p.border,
      }}
    >
      <Txt role="body" tone="secondary" style={{ flex: 1 }}>{label}</Txt>
      <Txt role="h3" numberOfLines={1}>{value}</Txt>
    </View>
  )
}

function LinkRow({ icon, label, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; last?: boolean }) {
  const p = usePalette()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingVertical: space(3),
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: p.border,
        }}
      >
        <Ionicons name={icon} size={17} color={p.textMuted} />
        <View style={{ flex: 1 }}><Txt role="body">{label}</Txt></View>
        <Ionicons name="chevron-forward" size={16} color={p.textMuted} />
      </View>
    </Pressable>
  )
}
