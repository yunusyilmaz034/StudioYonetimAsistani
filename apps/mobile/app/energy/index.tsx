import { useCallback, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router'

import type { CardioMachine, EnergyDayWire, EnergyState } from '@studio/core/client'
import { api, type EnergyActionBody } from '@/lib/api'
import { track } from '@/lib/analytics'
import { MACHINES, MACHINE_LABEL, SLOT_LABEL, clockTime, dayLabel, kcalText, parseNum, trNum } from '@/lib/energy'
import { screenPhotoBase64 } from '@/lib/photo'
import { useFetch } from '@/lib/useFetch'
import { EnergyLegend, EnergyRing, WeekBars } from '@/components/energy'
import { FadeInUp } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { ErrorState, FilterChip, PremiumCard, PrimaryButton, SecondaryButton, SectionHeader, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

// ── GÜN DETAYI (owner, 2026-10-13) ──────────────────────────────────────────────────────────
//
// One day of her energy account: the total, what it is made of, and the three things she can add —
// steps, a cardio session, a correction to how long her programme day took.
//
// A photo of a machine's screen is read and ADDED without asking her to confirm (*"kullanıcıya sorma
// bir daha"*). She is TOLD what was added, and the line carries a remove button — the correction is
// hers to make, the typing is not.
//
// Every write answers with the fresh state, so this screen never computes a calorie itself: the
// arithmetic lives in one place, on the server.

type Editing = { kind: 'steps' } | { kind: 'cardio' } | { kind: 'workout'; workoutLogId: string; minutes: number } | null

export default function EnergyDay() {
  const p = usePalette()
  const params = useLocalSearchParams<{ date?: string }>()
  const { data, loading, error, reload } = useFetch(() => api.energy(30))
  const [fresh, setFresh] = useState<EnergyState | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Back from the meal screen (or any other) the day may have changed: read it again, quietly.
  useFocusEffect(
    useCallback(() => {
      setFresh(null)
      void reload()
    }, [reload]),
  )

  const state = fresh ?? data
  if (loading && !state) return <Loading />
  if (!state) return <Screen header><ErrorState onRetry={reload} /></Screen>
  if (!state.started) return <Redirect href="/energy/start" />

  const date = picked ?? params.date ?? state.today
  const day = state.days.find((d) => d.date === date) ?? state.days[0]
  if (!day) return <Loading />
  const isToday = day.date === state.today

  async function act(body: EnergyActionBody, label: string): Promise<boolean> {
    setBusy(label)
    try {
      const res = await api.energyAct(body)
      if (res.ok) {
        setFresh(res.value)
        setEditing(null)
        return true
      }
      Alert.alert('Kaydedilemedi', res.error.message ?? 'Lütfen tekrar dene.')
      return false
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function photo(source: 'camera' | 'library') {
    const image = await screenPhotoBase64(source)
    if (image === 'denied') {
      Alert.alert('Kamera izni yok', 'Fotoğrafı galeriden seçebilir ya da değerleri elle girebilirsin.')
      return
    }
    if (!image || !day) return
    setBusy('photo')
    try {
      const res = await api.energyPhoto(day.date, image)
      if (res.ok) {
        const a = res.value.added
        track('energy_cardio_photo', { machine: a.machine, hadKcal: a.displayedKcal !== null })
        setFresh(res.value.state)
        // Told, not asked: this is what was read, and it is already in her day.
        Alert.alert('Eklendi', `${MACHINE_LABEL[a.machine]} · ${trNum(Math.round(a.minutes))} dk · yaklaşık ${kcalText(a.kcal)} kcal`)
      } else {
        Alert.alert('Okuyamadık', res.error.message ?? 'Fotoğraf okunamadı.', [
          { text: 'Elle gir', onPress: () => setEditing({ kind: 'cardio' }) },
          { text: 'Tamam', style: 'cancel' },
        ])
      }
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
    } finally {
      setBusy(null)
    }
  }

  function addCardio() {
    Alert.alert('Kardiyo ekle', 'Aletin ekranını fotoğrafla; süreyi ve kaloriyi biz okuyalım.', [
      { text: 'Fotoğraf çek', onPress: () => void photo('camera') },
      { text: 'Galeriden seç', onPress: () => void photo('library') },
      { text: 'Elle gir', onPress: () => setEditing({ kind: 'cardio' }) },
      { text: 'Vazgeç', style: 'cancel' },
    ])
  }

  const mealsOn = state.profile.mealsEnabled !== false
  const hide = state.profile.hideIntake === true
  const meals = day.meals ?? []

  function addMeal() {
    const go = (mode: 'camera' | 'library' | 'text') => router.push(`/energy/meal?mode=${mode}&date=${day!.date}`)
    Alert.alert('Öğün ekle', 'Tabağın üstten, tamamı görünecek şekilde çek. Fotoğrafın saklanmaz.', [
      { text: 'Fotoğraf çek', onPress: () => go('camera') },
      { text: 'Galeriden seç', onPress: () => go('library') },
      { text: 'Yazarak ekle', onPress: () => go('text') },
      { text: 'Vazgeç', style: 'cancel' },
    ])
  }

  function stop() {
    Alert.alert('Takibi kapat', 'Kilo, boy ve yağ oranı bilgilerin ile tüm günlük kayıtların silinir. Bu geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kapat ve sil',
        style: 'destructive',
        onPress: () =>
          void act({ action: 'stop' }, 'stop').then((ok) => {
            if (ok) {
              track('energy_stopped')
              router.replace('/(tabs)/training')
            }
          }),
      },
    ])
  }

  return (
    <Screen header refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { setFresh(null); reload() }} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <View style={{ alignItems: 'center', gap: space(4) }}>
          <Txt role="caption" tone="muted">{isToday ? `Bugün · ${dayLabel(day.date)}` : dayLabel(day.date)}</Txt>
          <EnergyRing day={day} />
          <View style={{ alignSelf: 'stretch' }}>
            <EnergyLegend day={day} />
          </View>
        </View>
      </FadeInUp>

      <FadeInUp index={1}>
        <View>
          <SectionHeader action="Geçmiş" onAction={() => router.push('/energy/history')}>Son 7 gün</SectionHeader>
          <PremiumCard>
            <WeekBars days={state.days} selected={day.date} onSelect={(d) => { setPicked(d); setEditing(null) }} />
          </PremiumCard>
        </View>
      </FadeInUp>

      <FadeInUp index={2}>
        <View>
          <SectionHeader>Günün dökümü</SectionHeader>
          <PremiumCard padded={false}>
            <Line title="Dinlenme" note="Vücudunun gün boyu harcadığı" kcal={day.basalKcal} />
            <Line
              title="Adım"
              note={day.steps ? `${trNum(day.steps.count)} adım · elle girdin` : 'Henüz girmedin'}
              kcal={day.stepsKcal}
              onPress={day.editable ? () => setEditing({ kind: 'steps' }) : undefined}
            />
            {editing?.kind === 'steps' ? (
              <NumberEditor
                label="Bugünkü toplam adımın"
                initial={day.steps ? String(day.steps.count) : ''}
                unit="adım"
                busy={busy === 'steps'}
                onCancel={() => setEditing(null)}
                onSave={(n) => void act({ action: 'steps', date: day.date, steps: Math.round(n) }, 'steps')}
              />
            ) : null}
            {day.workouts.map((w) => (
              <View key={w.workoutLogId}>
                <Line
                  title="Antrenman"
                  note={`${w.label} · ${trNum(w.minutes)} dk${w.estimated ? ' (tahmini)' : ''}`}
                  kcal={w.kcal}
                  onPress={day.editable ? () => setEditing({ kind: 'workout', workoutLogId: w.workoutLogId, minutes: w.minutes }) : undefined}
                />
                {editing?.kind === 'workout' && editing.workoutLogId === w.workoutLogId ? (
                  <NumberEditor
                    label="Antrenman kaç dakika sürdü?"
                    initial={String(w.minutes)}
                    unit="dk"
                    busy={busy === 'workout'}
                    onCancel={() => setEditing(null)}
                    onSave={(n) => void act({ action: 'workout_minutes', date: day.date, workoutLogId: w.workoutLogId, minutes: Math.round(n) }, 'workout')}
                  />
                ) : null}
              </View>
            ))}
            {day.cardio.map((c) => (
              <Line
                key={c.id}
                title="Kardiyo"
                note={`${MACHINE_LABEL[c.machine]} · ${trNum(Math.round(c.minutes))} dk · ${c.source === 'photo' ? 'ekrandan okundu' : 'elle girdin'}`}
                kcal={c.kcal}
                trailing={
                  day.editable ? (
                    <Pressable
                      hitSlop={10}
                      accessibilityLabel="Bu kardiyo kaydını sil"
                      onPress={() =>
                        Alert.alert('Kaydı sil', 'Bu kardiyo kaydı günden çıkarılır.', [
                          { text: 'Vazgeç', style: 'cancel' },
                          { text: 'Sil', style: 'destructive', onPress: () => void act({ action: 'remove_cardio', date: day.date, entryId: c.id }, 'remove') },
                        ])
                      }
                    >
                      <Ionicons name="trash-outline" size={18} color={p.textMuted} />
                    </Pressable>
                  ) : null
                }
              />
            ))}
            {editing?.kind === 'cardio' ? (
              <CardioEditor
                busy={busy === 'cardio'}
                onCancel={() => setEditing(null)}
                onSave={(v) => void act({ action: 'cardio', date: day.date, distanceKm: null, ...v }, 'cardio')}
              />
            ) : null}
          </PremiumCard>
        </View>
      </FadeInUp>

      {mealsOn ? (
        <FadeInUp index={3}>
          <View>
            <SectionHeader>{hide || day.intakeKcal == null ? 'Aldığın' : `Aldığın · yaklaşık ${kcalText(day.intakeKcal)} kcal`}</SectionHeader>
            <PremiumCard padded={false}>
              {meals.length === 0 ? (
                <View style={{ paddingHorizontal: space(4), paddingVertical: space(4) }}>
                  <Txt role="body" tone="secondary">{day.editable ? 'Henüz öğün eklemedin.' : 'Bu gün için öğün yok.'}</Txt>
                </View>
              ) : (
                meals.map((m) => (
                  <Pressable key={m.id} disabled={!day.editable} onPress={() => router.push(`/energy/meal?mode=edit&date=${day.date}&id=${m.id}`)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3.5), borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border, minHeight: 60 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt role="caption" tone="muted">{`${SLOT_LABEL[m.slot]} · ${clockTime(m.loggedAt)}`}</Txt>
                        <Txt role="h3" numberOfLines={2}>{m.items.map((i) => i.name).join(', ')}</Txt>
                        <Txt role="caption" tone="secondary">{m.source === 'photo' ? 'fotoğraftan' : 'yazarak'}</Txt>
                      </View>
                      {m.kcal !== null ? <Text style={[t.numSm, { color: p.textPrimary, fontSize: 17 }]}>{kcalText(m.kcal)}</Text> : null}
                      {day.editable ? <Ionicons name="create-outline" size={16} color={p.textMuted} /> : null}
                    </View>
                  </Pressable>
                ))
              )}
              {day.editable ? (
                <Pressable onPress={addMeal} style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space(4) }}>
                  <Text style={[t.button, { color: p.primary }]}>+ Öğün ekle</Text>
                </Pressable>
              ) : null}
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      {day.editable ? (
        <FadeInUp index={3}>
          {busy === 'photo' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(3), minHeight: 52 }}>
              <ActivityIndicator color={p.primary} />
              <Txt role="body" tone="secondary">Ekran okunuyor…</Txt>
            </View>
          ) : (
            <View style={{ gap: space(3) }}>
              {mealsOn ? <PrimaryButton label="Öğün fotoğrafı" icon="restaurant-outline" onPress={() => router.push(`/energy/meal?mode=camera&date=${day.date}`)} full /> : null}
              <View style={{ flexDirection: 'row', gap: space(3) }}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton label={day.steps ? 'Adımı düzelt' : 'Adım gir'} icon="walk-outline" onPress={() => setEditing({ kind: 'steps' })} full />
                </View>
                <View style={{ flex: 1 }}>
                  <SecondaryButton label="Kardiyo ekle" icon="camera-outline" onPress={addCardio} full />
                </View>
              </View>
            </View>
          )}
        </FadeInUp>
      ) : (
        <Txt role="caption" tone="muted" align="center">Yalnızca bugün ve son 7 gün düzenlenebilir.</Txt>
      )}

      <FadeInUp index={4}>
        <View style={{ backgroundColor: p.primarySoft, borderRadius: radius.md, padding: space(4), gap: space(1) }}>
          <Txt role="h3" tone="brand">Günün özeti</Txt>
          <Txt role="body">
            {(day.activeKcal > 0
              ? `${isToday ? 'Bugün' : 'Bu gün'} yaklaşık ${kcalText(day.totalKcal)} kcal yaktın; bunun ${kcalText(day.activeKcal)} kadarı hareketten.`
              : meals.length > 0
                ? `${isToday ? 'Bugün' : 'Bu gün'} yaklaşık ${kcalText(day.totalKcal)} kcal yaktın.`
                : `${isToday ? 'Bugün' : 'Bu gün'} için giriş yok. Dinlenirken yaklaşık ${kcalText(day.basalKcal)} kcal harcarsın.`) +
              // No verdict — only the two figures side by side, when she chose to see them.
              (!hide && meals.length > 0 && day.intakeKcal != null ? ` Öğünlerinden yaklaşık ${kcalText(day.intakeKcal)} kcal aldın.` : '')}
          </Txt>
        </View>
      </FadeInUp>

      <View style={{ gap: space(3) }}>
        <Txt role="caption" tone="muted">Antrenman, adım ve öğün değerleri tahmindir; saat, alet ya da etiketle birebir tutmayabilir.</Txt>
        <Pressable onPress={() => router.push('/energy/settings')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.primary }]}>Kalori ayarları</Text>
        </Pressable>
        <Pressable onPress={stop} hitSlop={8} disabled={busy === 'stop'} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.error }]}>Takibi kapat ve verilerimi sil</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

function Line({ title, note, kcal, onPress, trailing }: { title: string; note: string; kcal: number; onPress?: () => void; trailing?: ReactNode }) {
  const p = usePalette()
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3.5), borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border, minHeight: 60 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt role="h3">{title}</Txt>
        <Txt role="caption" tone="secondary">{note}</Txt>
      </View>
      <Text style={[t.numSm, { color: p.textPrimary, fontSize: 17 }]}>{kcalText(kcal)}</Text>
      {trailing}
      {onPress ? <Ionicons name="create-outline" size={16} color={p.textMuted} /> : null}
    </View>
  )
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body
}

function useInput() {
  const p = usePalette()
  return { backgroundColor: p.surfaceElevated, borderColor: p.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3.5), minHeight: 50, fontSize: 17, color: p.textPrimary, fontFamily: t.body.fontFamily } as const
}

function NumberEditor({ label, initial, unit, busy, onSave, onCancel }: { label: string; initial: string; unit: string; busy: boolean; onSave: (n: number) => void; onCancel: () => void }) {
  const p = usePalette()
  const input = useInput()
  const [text, setText] = useState(initial)
  const n = parseNum(text)
  return (
    <View style={{ padding: space(4), gap: space(3), backgroundColor: p.surfaceMuted, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border }}>
      <Txt role="caption" tone="secondary">{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <TextInput style={[input, { flex: 1 }]} value={text} onChangeText={setText} keyboardType="number-pad" autoFocus placeholder="0" placeholderTextColor={p.textMuted} />
        <Txt role="body" tone="muted">{unit}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
        <PrimaryButton label="Kaydet" onPress={() => n !== null && onSave(n)} disabled={n === null} loading={busy} />
        <Pressable onPress={onCancel} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.textSecondary }]}>Vazgeç</Text>
        </Pressable>
      </View>
    </View>
  )
}

function CardioEditor({ busy, onSave, onCancel }: { busy: boolean; onSave: (v: { machine: CardioMachine; minutes: number; displayedKcal: number | null }) => void; onCancel: () => void }) {
  const p = usePalette()
  const input = useInput()
  const [machine, setMachine] = useState<CardioMachine>('treadmill')
  const [minutes, setMinutes] = useState('')
  const [kcal, setKcal] = useState('')
  const m = parseNum(minutes)
  return (
    <View style={{ padding: space(4), gap: space(3), backgroundColor: p.surfaceMuted }}>
      <Txt role="caption" tone="secondary">Hangi alet?</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
        {MACHINES.map((k) => (
          <FilterChip key={k} label={MACHINE_LABEL[k]} active={machine === k} onPress={() => setMachine(k)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space(3) }}>
        <View style={{ flex: 1, gap: space(1.5) }}>
          <Txt role="caption" tone="secondary">Süre (dk)</Txt>
          <TextInput style={input} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" placeholder="20" placeholderTextColor={p.textMuted} />
        </View>
        <View style={{ flex: 1, gap: space(1.5) }}>
          <Txt role="caption" tone="secondary">Kalori · isteğe bağlı</Txt>
          <TextInput style={input} value={kcal} onChangeText={setKcal} keyboardType="number-pad" placeholder="—" placeholderTextColor={p.textMuted} />
        </View>
      </View>
      <Txt role="caption" tone="muted">Ekranda kalori yoksa boş bırak; süreye ve kilona göre biz hesaplarız.</Txt>
      <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
        <PrimaryButton label="Güne ekle" onPress={() => m !== null && onSave({ machine, minutes: m, displayedKcal: parseNum(kcal) })} disabled={m === null} loading={busy} />
        <Pressable onPress={onCancel} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.button, { color: p.textSecondary }]}>Vazgeç</Text>
        </Pressable>
      </View>
    </View>
  )
}
