import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'

import type { MealPortion, MealSlot } from '@studio/core/client'
import { api } from '@/lib/api'
import { track } from '@/lib/analytics'
import { PORTIONS, PORTION_LABEL, SLOTS, SLOT_LABEL, kcalText, mealLineKcal, newMealId, slotForHour } from '@/lib/energy'
import { screenPhotoBase64 } from '@/lib/photo'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { FilterChip, PremiumCard, PrimaryButton, SecondaryButton, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

// ── ÖĞÜN (owner, 2026-10-14 · 1.9.0) ──────────────────────────────────────────────────────────
//
// *"Öğün fotoğrafı çek, kalorisini hesaplayalım."* A plate is read into lines — one per food, each
// with a normal-portion estimate — and SHE confirms: unlike the cardio photo, nothing is saved until
// she taps. A plate is much harder to read than a machine's screen, so the reading is a proposal.
//
// She can change a portion (Az / Normal / Çok), remove a line, add one the photo missed by writing
// it, and change the slot. Under "Rakamları gizle" every figure on this screen is left out — the
// lines and portions still work, because the habit is the point and the number is optional.
//
// Entry: `?mode=camera|library|text&date=…` to add, `?mode=edit&date=…&id=mel_…` to correct.

type Line = { key: string; name: string; portion: MealPortion; kcalNormal: number | null }
type Phase = 'reading' | 'review' | 'write'

let lineSeq = 0
const toLines = (items: readonly { name: string; kcalNormal: number | null; portion?: MealPortion }[]): Line[] =>
  items.map((i) => ({ key: `l${++lineSeq}`, name: i.name, portion: i.portion ?? 'normal', kcalNormal: i.kcalNormal }))

export default function MealScreen() {
  const p = usePalette()
  const params = useLocalSearchParams<{ mode?: string; date?: string; id?: string }>()
  const mode = params.mode ?? 'text'
  const { data } = useFetch(() => api.energy(8))
  const entryId = useRef(params.id ?? newMealId())
  const [phase, setPhase] = useState<Phase>(mode === 'camera' || mode === 'library' ? 'reading' : mode === 'edit' ? 'review' : 'write')
  const [lines, setLines] = useState<Line[]>([])
  const [slot, setSlot] = useState<MealSlot>(slotForHour(new Date().getHours()))
  const [source, setSource] = useState<'photo' | 'text'>(mode === 'text' ? 'text' : 'photo')
  const [fail, setFail] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<'read' | 'save' | 'remove' | null>(null)
  const loadedEdit = useRef(false)

  const state = data?.started ? data : null
  const date = params.date ?? state?.today ?? ''
  const hide = state?.profile.hideIntake === true

  async function readPhoto(src: 'camera' | 'library') {
    setFail(null)
    const image = await screenPhotoBase64(src)
    if (image === 'denied') {
      setFail('Kamera izni yok. Galeriden seçebilir ya da ne yediğini yazabilirsin.')
      setPhase('write')
      return
    }
    if (!image) {
      // She closed the camera. With nothing on the screen yet, there is nothing to return to here.
      if (lines.length === 0) router.back()
      return
    }
    setPhase('reading')
    try {
      const res = await api.energyMealRead({ action: 'meal_photo', image })
      track('energy_meal_read', { via: 'photo', ok: res.ok })
      if (res.ok) {
        setLines(toLines(res.value.items))
        setSource('photo')
        setPhase('review')
      } else {
        setFail(res.error.message ?? 'Fotoğraftan yemeği seçemedik.')
        setPhase('write')
      }
    } catch {
      setFail('Bağlantı kurulamadı. İnternetini kontrol edip yeniden dene ya da ne yediğini yaz.')
      setPhase('write')
    }
  }

  // A sentence → lines. First time it IS the meal; from the review screen it ADDS what the photo missed.
  async function readText(append: boolean) {
    const said = text.trim()
    if (said.length < 2) return
    setBusy('read')
    try {
      const res = await api.energyMealRead({ action: 'meal_text', text: said })
      track('energy_meal_read', { via: 'text', ok: res.ok })
      if (res.ok) {
        setLines((prev) => (append ? [...prev, ...toLines(res.value.items)] : toLines(res.value.items)))
        if (!append) setSource('text')
        setText('')
        setAdding(false)
        setFail(null)
        setPhase('review')
      } else {
        Alert.alert('Hesaplayamadık', res.error.message ?? 'Yeniden dene.')
      }
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (mode === 'camera' || mode === 'library') void readPhoto(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Editing: the meal as it was saved.
  useEffect(() => {
    if (mode !== 'edit' || loadedEdit.current || !state) return
    const meal = state.days.find((d) => d.date === date)?.meals?.find((m) => m.id === params.id)
    if (!meal) return
    loadedEdit.current = true
    setLines(toLines(meal.items))
    setSlot(meal.slot)
    setSource(meal.source)
  }, [mode, state, date, params.id])

  async function save() {
    if (lines.length === 0 || !date) return
    setBusy('save')
    try {
      const items = lines.map((l) => ({ name: l.name, portion: l.portion, kcalNormal: l.kcalNormal }))
      const res =
        mode === 'edit'
          ? await api.energyAct({ action: 'meal_update', date, entryId: entryId.current, slot, items })
          : await api.energyAct({
              action: 'meal_add',
              date,
              entryId: entryId.current,
              slot,
              source,
              // A new meal's lines all came from a reading, so every one carries its estimate.
              items: items.map((i) => ({ ...i, kcalNormal: i.kcalNormal ?? 0 })),
            })
      if (res.ok) {
        if (mode !== 'edit') track('energy_meal_added', { source, slot, lines: lines.length })
        router.back()
      } else {
        Alert.alert('Kaydedilemedi', res.error.message ?? 'Lütfen tekrar dene.')
      }
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
    } finally {
      setBusy(null)
    }
  }

  function remove() {
    Alert.alert('Öğünü sil', 'Bu öğün günden çıkarılır.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setBusy('remove')
          try {
            const res = await api.energyAct({ action: 'meal_remove', date, entryId: entryId.current })
            if (res.ok) router.back()
            else Alert.alert('Silinemedi', res.error.message ?? 'Lütfen tekrar dene.')
          } catch {
            Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  const total = lines.reduce((n, l) => n + (l.kcalNormal === null ? 0 : mealLineKcal(l.kcalNormal, l.portion)), 0)
  const input = { backgroundColor: p.surfaceElevated, borderColor: p.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3.5), paddingVertical: space(3), fontSize: 16, color: p.textPrimary, fontFamily: t.body.fontFamily, minHeight: 88, textAlignVertical: 'top' as const }

  if (!data) return <Loading />

  if (phase === 'reading') {
    return (
      <Screen header>
        <View style={{ alignItems: 'center', gap: space(4), paddingTop: space(16) }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="restaurant-outline" size={36} color={p.primary} />
          </View>
          <Txt role="h2" align="center">Tabağına bakıyoruz…</Txt>
          <Txt role="body" tone="secondary" align="center">Yiyecekleri ve porsiyonları tahmin ediyoruz. Birkaç saniye sürer.</Txt>
          <ActivityIndicator color={p.primary} />
        </View>
      </Screen>
    )
  }

  const SlotPicker = (
    <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
      {SLOTS.map((s) => (
        <FilterChip key={s} label={SLOT_LABEL[s]} active={slot === s} onPress={() => setSlot(s)} />
      ))}
    </View>
  )

  if (phase === 'write') {
    return (
      <Screen header>
        {fail ? (
          <FadeInUp index={0}>
            <View style={{ backgroundColor: p.warningSoft, borderRadius: radius.md, padding: space(4), gap: space(3) }}>
              <Txt role="body">{fail}</Txt>
              <SecondaryButton label="Yeniden çek" icon="camera-outline" onPress={() => void readPhoto('camera')} />
            </View>
          </FadeInUp>
        ) : null}
        <FadeInUp index={1}>
          <View style={{ gap: space(3) }}>
            <Txt role="h2">Ne yedin?</Txt>
            <TextInput
              style={input}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus={!fail}
              maxLength={500}
              placeholder="1 kase mercimek çorbası, 2 dilim tam buğday ekmeği"
              placeholderTextColor={p.textMuted}
            />
            <Txt role="caption" tone="muted">Miktarı yazarsan tahmin daha yakın olur.</Txt>
            {SlotPicker}
            <PrimaryButton label="Kalorisini hesapla" onPress={() => void readText(false)} disabled={text.trim().length < 2} loading={busy === 'read'} full />
          </View>
        </FadeInUp>
        <Txt role="caption" tone="muted">Yazdığın yalnızca hesaplamak için kullanılır, saklanmaz. Stüdyo öğünlerini görmez.</Txt>
      </Screen>
    )
  }

  return (
    <Screen header>
      <FadeInUp index={0}>
        <View style={{ gap: space(1) }}>
          <Txt role="h2">{mode === 'edit' ? 'Öğünü düzelt' : source === 'photo' ? 'Tabakta bunları gördük' : 'Yazdıklarından bunları çıkardık'}</Txt>
          <Txt role="caption" tone="secondary">Yanlışsa porsiyonu değiştir ya da sil.</Txt>
        </View>
      </FadeInUp>

      <FadeInUp index={1}>{SlotPicker}</FadeInUp>

      <FadeInUp index={2}>
        <PremiumCard padded={false}>
          {lines.map((l) => (
            <View key={l.key} style={{ paddingHorizontal: space(4), paddingVertical: space(3), gap: space(2), borderBottomWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(3) }}>
                <Txt role="h3" style={{ flex: 1 }}>{l.name}</Txt>
                {!hide && l.kcalNormal !== null ? (
                  <Text style={[t.numSm, { color: p.textPrimary, fontSize: 16 }]}>{kcalText(mealLineKcal(l.kcalNormal, l.portion))} kcal</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                {PORTIONS.map((pt) => (
                  <FilterChip key={pt} label={PORTION_LABEL[pt]} active={l.portion === pt} onPress={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, portion: pt } : x)))} />
                ))}
                <View style={{ flex: 1 }} />
                <Pressable
                  hitSlop={10}
                  accessibilityLabel={`${l.name} satırını sil`}
                  onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="trash-outline" size={18} color={p.textMuted} />
                </Pressable>
              </View>
            </View>
          ))}
          {adding ? (
            <View style={{ padding: space(4), gap: space(3), backgroundColor: p.surfaceMuted }}>
              <TextInput style={[input, { minHeight: 60 }]} value={text} onChangeText={setText} multiline autoFocus maxLength={500} placeholder="1 bardak ayran" placeholderTextColor={p.textMuted} />
              <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
                <PrimaryButton label="Ekle" onPress={() => void readText(true)} disabled={text.trim().length < 2} loading={busy === 'read'} />
                <Pressable onPress={() => { setAdding(false); setText('') }} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={[t.button, { color: p.textSecondary }]}>Vazgeç</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setAdding(true)} style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space(4) }}>
              <Text style={[t.button, { color: p.primary }]}>+ Gözden kaçanı ekle</Text>
            </Pressable>
          )}
        </PremiumCard>
      </FadeInUp>

      {!hide ? (
        <FadeInUp index={3}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Txt role="body" tone="secondary">Toplam · yaklaşık</Txt>
            <Text style={[t.numSm, { color: p.textPrimary, fontSize: 26 }]}>{kcalText(total)} kcal</Text>
          </View>
        </FadeInUp>
      ) : null}
      <Txt role="caption" tone="muted">
        {source === 'photo' ? 'Fotoğraftan tahmindir. Yağ, sos ve şeker görünmez; gerçek değer biraz farklı olabilir.' : 'Yazdığından tahmindir; gerçek değer biraz farklı olabilir.'}
      </Txt>

      <View style={{ gap: space(3) }}>
        <PrimaryButton
          label={mode === 'edit' ? 'Değişiklikleri kaydet' : `${SLOT_LABEL[slot]} olarak ekle`}
          onPress={() => void save()}
          disabled={lines.length === 0 || busy !== null}
          loading={busy === 'save'}
          full
        />
        {mode === 'edit' ? (
          <Pressable onPress={remove} disabled={busy !== null} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[t.button, { color: p.error }]}>Öğünü sil</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  )
}
