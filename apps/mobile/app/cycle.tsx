import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

import { cycleReading, feelPattern, type SessionFeel } from '@studio/core/client'
import { api } from '@/lib/api'
import { localDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import {
  PHASE_LABEL,
  addStart,
  dateOf,
  loadCycle,
  removeStart,
  setConsent,
  setFeel,
  sortedStarts,
  today,
  wipeCycle,
  type CycleStore,
} from '@/lib/cycle'
import { FadeInUp } from '@/components/motion'
import { Body, Button, Loading, Screen } from '@/components/ui'
import { FilterChip, PremiumCard, PrimaryButton, SectionHeader, StatusChip, Txt } from '@/components/kit'
import { radius, space, usePalette } from '@/theme'

// ── DÖNGÜ MODU (Faz 3.2) ────────────────────────────────────────────────────────────────────
//
// Two rules shape every line on this screen, and both come from the roadmap:
//
//  1. **The data never leaves the phone.** There is no API call here and there never will be. What
//     the screen needs from the server — which classes she attended — it takes from what the app
//     already fetches for her streak. The studio learns nothing new.
//
//  2. **It shows her pattern; it does not prescribe.** "Train hard in the follicular phase" has weak
//     evidence, so the app does not say it. The only claim it makes is built from her own one-tap
//     ratings, and it stays silent until that claim is strong enough to survive being questioned.

const FEELS: readonly { key: SessionFeel; label: string }[] = [
  { key: 'hard', label: 'Zordu' },
  { key: 'normal', label: 'Normaldi' },
  { key: 'good', label: 'İyi geldi' },
]

/** How far back a class can be and still be worth asking about. Older than this, she has forgotten. */
const RATE_WINDOW_DAYS = 7

export default function Cycle() {
  const p = usePalette()
  const [store, setStore] = useState<CycleStore | null>(null)
  // Her door check-ins — already on the wire for the streak strip, so this costs nothing extra and,
  // more importantly, adds no new thing the server has to know.
  const { data: fitness } = useFetch(api.fitness)

  useEffect(() => {
    void loadCycle().then(setStore)
  }, [])

  if (!store) return <Loading />
  if (!store.consent) return <Onay onAccept={async () => setStore(await setConsent(store, true))} />

  const bugun = today()
  const reading = cycleReading(store.starts, bugun)
  const pattern = feelPattern(store.starts, store.feels, bugun)
  const starts = sortedStarts(store)

  const rated = new Set(store.feels.map((f) => f.date))
  const sinir = new Date(Date.parse(`${bugun}T00:00:00Z`) - RATE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  // `recent` is her door check-ins, newest first — the same list the consistency strip is drawn from.
  const sorulacak = [...new Set((fitness?.recent ?? []).map((at) => dateOf(at)))]
    .filter((d) => d >= sinir && d <= bugun && !rated.has(d))
    .sort((a, b) => b.localeCompare(a))

  async function basladi() {
    if (!store) return
    const son = starts[0]
    const fark = son ? (Date.parse(`${bugun}T00:00:00Z`) - Date.parse(`${son}T00:00:00Z`)) / 86_400_000 : Infinity
    // Below a plausible cycle length this is almost always a second tap, and a stray entry quietly
    // poisons every prediction that follows it. So it is a question, not a refusal — she may have a
    // short cycle, and it is her body.
    if (fark < 21) {
      Alert.alert(
        'Son kaydın çok yakın',
        `${localDate(son as string)} tarihinde kaydetmişsin — ${Math.round(fark)} gün önce. Bugünü yine de ekleyeyim mi?`,
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Ekle', onPress: () => void addStart(store, bugun).then(setStore) },
        ],
      )
      return
    }
    setStore(await addStart(store, bugun))
  }

  function sil(date: string) {
    Alert.alert('Kaydı sil', `${localDate(date)} kaydı silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void (store && removeStart(store, date).then(setStore)) },
    ])
  }

  function hepsiniSil() {
    Alert.alert(
      'Döngü modunu kapat',
      'Bütün kayıtların bu telefondan silinecek. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sil', style: 'destructive', onPress: () => void wipeCycle().then(setStore) },
      ],
    )
  }

  return (
    <Screen header>
      <FadeInUp index={0}>
        <PremiumCard>
          {reading ? (
            <View style={{ gap: space(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt role="label" tone="muted">BUGÜN</Txt>
                <StatusChip label={PHASE_LABEL[reading.phase]} tone="brand" />
              </View>
              <Txt role="display">{reading.dayOfCycle}. gün</Txt>
              {reading.nextExpectedStart !== null && reading.daysUntilNext !== null ? (
                <Txt role="body" tone="secondary">
                  {reading.daysUntilNext >= 0
                    ? `Bir sonraki için tahmin: ${localDate(reading.nextExpectedStart)} (yaklaşık ${reading.daysUntilNext} gün)`
                    : `Tahmini tarih ${Math.abs(reading.daysUntilNext)} gün geçti. Gecikme olağandır; kaydetmeyi unutmuş da olabilirsin.`}
                </Txt>
              ) : (
                <Txt role="body" tone="secondary">Tahmin için en az iki döngü kaydı gerekiyor.</Txt>
              )}
              {reading.confidence === 'low' ? (
                <Txt role="caption" tone="muted">
                  Döngülerin değişken olduğu için bu tahmin gevşek — ortalaman {reading.averageLength} gün.
                </Txt>
              ) : null}
            </View>
          ) : (
            <View style={{ gap: space(2) }}>
              <Txt role="h2">Henüz kayıt yok</Txt>
              <Txt role="body" tone="secondary">
                Reglin başladığı gün aşağıdaki düğmeye bas. Birkaç ay sonra uygulama senin örüntünü
                gösterebilir hale gelir.
              </Txt>
            </View>
          )}
          <View style={{ marginTop: space(4) }}>
            <PrimaryButton label="Bugün başladı" icon="water-outline" onPress={() => void basladi()} full />
          </View>
        </PremiumCard>
      </FadeInUp>

      {pattern ? (
        <FadeInUp index={1}>
          <View>
            <SectionHeader>Senin örüntün</SectionHeader>
            <PremiumCard>
              <View style={{ gap: space(2) }}>
                <Txt role="bodyLarge">
                  Son aylarda dersleri en çok <Txt role="bodyLarge" tone="brand">{PHASE_LABEL[pattern.phase].toLocaleLowerCase('tr-TR')}</Txt>{' '}
                  döneminde “zor” işaretlemişsin.
                </Txt>
                {pattern.isNow ? (
                  <Txt role="body" tone="secondary">Şu an o dönemdesin. Zorlanıyorsan sen değil, zamanlaması.</Txt>
                ) : null}
                {/* The sample size is shown, not hidden: a claim about her body has to be checkable
                    by her. Four classes is a hint; twenty is a pattern, and she can tell them apart. */}
                <Txt role="caption" tone="muted">
                  {pattern.samples} ders üzerinden, %{Math.round(pattern.hardRate * 100)}'i zor işaretlenmiş. Yalnızca
                  senin kendi kayıtlarından.
                </Txt>
              </View>
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      {sorulacak.length > 0 ? (
        <FadeInUp index={2}>
          <View>
            <SectionHeader>Dersin nasıldı?</SectionHeader>
            <View style={{ gap: space(3) }}>
              {sorulacak.map((d) => (
                <PremiumCard key={d}>
                  <Txt role="h3">{localDate(d)}</Txt>
                  <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(3) }}>
                    {FEELS.map((f) => (
                      <FilterChip
                        key={f.key}
                        label={f.label}
                        active={false}
                        onPress={() => void setFeel(store, d, f.key).then(setStore)}
                      />
                    ))}
                  </View>
                </PremiumCard>
              ))}
            </View>
          </View>
        </FadeInUp>
      ) : null}

      {starts.length > 0 ? (
        <FadeInUp index={3}>
          <View>
            <SectionHeader>Kayıtlarım</SectionHeader>
            <PremiumCard>
              {starts.slice(0, 12).map((d, i) => (
                <View
                  key={d}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: space(2.5),
                    borderBottomWidth: i === Math.min(starts.length, 12) - 1 ? 0 : 1,
                    borderBottomColor: p.border,
                  }}
                >
                  <Txt role="body">{localDate(d)}</Txt>
                  <Ionicons name="trash-outline" size={18} color={p.textMuted} onPress={() => sil(d)} />
                </View>
              ))}
            </PremiumCard>
          </View>
        </FadeInUp>
      ) : null}

      <FadeInUp index={4}>
        <View style={{ gap: space(3) }}>
          <PremiumCard style={{ backgroundColor: p.surfaceMuted }}>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Ionicons name="lock-closed-outline" size={18} color={p.textSecondary} />
              <View style={{ flex: 1, gap: space(1.5) }}>
                <Txt role="h3">Bu bilgiler telefonunda kalır</Txt>
                <Txt role="caption" tone="secondary">
                  Stüdyo, eğitmenin ve biz göremeyiz — sunucuya hiç gönderilmez. Uygulamayı silersen
                  kayıtların da gider. Burada yazanlar tıbbi tavsiye değildir.
                </Txt>
              </View>
            </View>
          </PremiumCard>
          <Button label="Döngü modunu kapat ve verilerimi sil" tone="danger" onPress={hepsiniSil} />
        </View>
      </FadeInUp>
    </Screen>
  )
}

/**
 * The consent gate.
 *
 * Cycle data is special-category health data: consent has to be asked for on its own, in words she
 * can check, and it cannot be a condition of using the app. So this screen says what happens to the
 * data BEFORE she has entered any, and "Vazgeç" simply takes her back with nothing stored.
 */
function Onay({ onAccept }: { onAccept: () => Promise<void> }) {
  const p = usePalette()
  const maddeler: readonly string[] = [
    'Kayıtlarının tamamı yalnızca bu telefonda saklanır.',
    'Stüdyo, eğitmenin ve biz göremeyiz. Sunucumuza gönderilmez.',
    'İstediğin an tek dokunuşla hepsini silebilirsin.',
    'Uygulamayı silersen kayıtların da silinir.',
    'Uygulama tıbbi tavsiye vermez; sana yalnızca kendi kayıtlarını gösterir.',
  ]
  return (
    <Screen header>
      <FadeInUp index={0}>
        <View style={{ gap: space(3) }}>
          <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="flower-outline" size={26} color={p.primary} />
          </View>
          <Txt role="h1">Döngü modu</Txt>
          <Body muted>
            Reglinin başladığı günü işaretlersin; uygulama döngünün neresinde olduğunu gösterir ve
            zamanla, derslerini nasıl işaretlediğinden kendi örüntünü çıkarır.
          </Body>
        </View>
      </FadeInUp>

      <FadeInUp index={1}>
        <PremiumCard>
          <View style={{ gap: space(3) }}>
            {maddeler.map((m) => (
              <View key={m} style={{ flexDirection: 'row', gap: space(2.5) }}>
                <Ionicons name="checkmark-circle" size={18} color={p.success} />
                <Txt role="body" tone="secondary" style={{ flex: 1 }}>{m}</Txt>
              </View>
            ))}
          </View>
        </PremiumCard>
      </FadeInUp>

      <FadeInUp index={2}>
        <View style={{ gap: space(3) }}>
          <PrimaryButton label="Onaylıyorum, başlayalım" onPress={() => void onAccept()} full />
          <Button label="Şimdi değil" tone="muted" onPress={() => router.back()} />
        </View>
      </FadeInUp>
    </Screen>
  )
}
