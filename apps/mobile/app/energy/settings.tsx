import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { Redirect, router } from 'expo-router'

import type { EnergyState } from '@studio/core/client'
import { api } from '@/lib/api'
import { track } from '@/lib/analytics'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { ErrorState, PremiumCard, Txt } from '@/components/kit'
import { space, typo as t, usePalette } from '@/theme'

// ── KALORİ AYARLARI (owner, 2026-10-14 · 1.9.0) ──────────────────────────────────────────────
//
// Two switches and the truth about her data. "Rakamları gizle" exists because counting what one eats
// unsettles some people; with it on, meals are still recorded but no intake figure reaches her — the
// SERVER leaves it out, so no screen can show it by mistake.

export default function EnergySettings() {
  const p = usePalette()
  const { data, loading, reload } = useFetch(() => api.energy(1))
  const [fresh, setFresh] = useState<EnergyState | null>(null)
  const [busy, setBusy] = useState(false)
  const state = fresh ?? data
  if (loading && !state) return <Loading />
  if (!state) return <Screen header><ErrorState onRetry={reload} /></Screen>
  if (!state.started) return <Redirect href="/energy/start" />

  const mealsEnabled = state.profile.mealsEnabled !== false
  const hideIntake = state.profile.hideIntake === true

  async function setPrefs(next: { mealsEnabled: boolean; hideIntake: boolean }) {
    setBusy(true)
    try {
      const res = await api.energyAct({ action: 'meal_prefs', ...next })
      if (res.ok) {
        setFresh(res.value)
        track('energy_meal_prefs', next)
      } else Alert.alert('Kaydedilemedi', res.error.message ?? 'Lütfen tekrar dene.')
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
    } finally {
      setBusy(false)
    }
  }

  function stop() {
    Alert.alert('Takibi kapat', 'Kilo, boy ve yağ oranı bilgilerin ile öğünlerin dahil tüm günlük kayıtların silinir. Bu geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kapat ve sil',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            const res = await api.energyAct({ action: 'stop' })
            if (res.ok) {
              track('energy_stopped')
              router.replace('/(tabs)/training')
            } else Alert.alert('Kapatılamadı', res.error.message ?? 'Lütfen tekrar dene.')
          } catch {
            Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space(4), paddingHorizontal: space(4), paddingVertical: space(3.5), minHeight: 72 }

  return (
    <Screen header>
      <FadeInUp index={0}>
        <PremiumCard padded={false}>
          <View style={[row, { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt role="h3">Öğün takibi</Txt>
              <Txt role="caption" tone="secondary">Kapalıyken öğün eklenmez, "aldığın" görünmez</Txt>
            </View>
            <Switch value={mealsEnabled} disabled={busy} onValueChange={(v) => void setPrefs({ mealsEnabled: v, hideIntake })} trackColor={{ true: p.primary }} accessibilityLabel="Öğün takibi" />
          </View>
          <View style={row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt role="h3">Rakamları gizle</Txt>
              <Txt role="caption" tone="secondary">Öğünlerin kaydolur ama kalori sayısı gösterilmez</Txt>
            </View>
            <Switch value={hideIntake} disabled={busy || !mealsEnabled} onValueChange={(v) => void setPrefs({ mealsEnabled, hideIntake: v })} trackColor={{ true: p.primary }} accessibilityLabel="Rakamları gizle" />
          </View>
        </PremiumCard>
      </FadeInUp>

      <FadeInUp index={1}>
        <PremiumCard>
          <View style={{ gap: space(2.5) }}>
            <Txt role="h3">Verilerin</Txt>
            <Txt role="body">Öğün fotoğrafların okunduktan sonra silinir, hiçbir yerde saklanmaz.</Txt>
            <Txt role="body">Öğünlerini ve kalorilerini stüdyo personeli görmez; yalnızca sen görürsün.</Txt>
            <Txt role="body">Takibi kapatırsan öğünlerin dahil tüm kalori kayıtların silinir.</Txt>
          </View>
        </PremiumCard>
      </FadeInUp>

      <View style={{ gap: space(2) }}>
        <Pressable onPress={() => router.push('/energy/start?edit=1')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.primary }]}>Kilo, boy ve amacımı güncelle</Text>
        </Pressable>
        <Pressable onPress={stop} disabled={busy} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.error }]}>Kalori takibini kapat ve verilerimi sil</Text>
        </Pressable>
      </View>
    </Screen>
  )
}
