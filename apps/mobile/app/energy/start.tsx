import { useEffect, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Redirect, router, useLocalSearchParams } from 'expo-router'

import type { EnergyGoal } from '@studio/core/client'
import { api } from '@/lib/api'
import { track } from '@/lib/analytics'
import { GOALS, parseNum } from '@/lib/energy'
import { shortDate } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp, PressableScale, ProgressBar } from '@/components/motion'
import { Loading, Screen } from '@/components/ui'
import { PrimaryButton, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

// ── KALORİ TAKİBİ SİHİRBAZI (owner, 2026-10-13) ─────────────────────────────────────────────
//
// Two steps: her body, then her aim. The same screen edits an existing profile (`?edit=1`), because
// "the form she filled in" and "the form she corrects" being two screens is how they drift apart.
//
// Nothing is validated here beyond "is it a number": the RANGES live on the server, beside the rule,
// and its refusal names the field. A second copy of the limits in the app is a copy that goes stale
// the first time one of them moves.
//
// Sex is not asked — this studio is women-only and the server supplies it.

const str = (n: number | null | undefined): string => (n === null || n === undefined ? '' : String(n).replace('.', ','))

export default function EnergyStart() {
  const p = usePalette()
  const { edit } = useLocalSearchParams<{ edit?: string }>()
  const editing = edit === '1'
  const { data, loading } = useFetch(() => api.energy(1))
  const [step, setStep] = useState<1 | 2>(1)
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [fat, setFat] = useState('')
  const [goal, setGoal] = useState<EnergyGoal>('maintain')
  const [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    if (data.started) {
      setWeight(str(data.profile.weightKg))
      setHeight(str(data.profile.heightCm))
      setBirthYear(str(data.profile.birthYear))
      setFat(str(data.profile.bodyFatPercent))
      setGoal(data.profile.goal)
      setConsent(true)
    } else {
      setWeight(str(data.prefill.weightKg))
      setHeight(str(data.prefill.heightCm))
      setBirthYear(str(data.prefill.birthYear))
      setFat(str(data.prefill.bodyFatPercent))
    }
  }, [data])

  if (loading && !data) return <Loading />
  // She has already started and did not come here to edit: there is nothing to set up.
  if (data?.started && !editing) return <Redirect href="/energy" />

  const measuredOn = data && !data.started ? data.prefill.measuredOn : null
  const body = { weightKg: parseNum(weight), heightCm: parseNum(height), birthYear: parseNum(birthYear), bodyFatPercent: parseNum(fat) }
  const stepOneReady = body.weightKg !== null && body.heightCm !== null && body.birthYear !== null && (editing || consent)

  async function finish() {
    if (body.weightKg === null || body.heightCm === null || body.birthYear === null) return
    setBusy(true)
    try {
      const profile = { weightKg: body.weightKg, heightCm: body.heightCm, birthYear: body.birthYear, bodyFatPercent: body.bodyFatPercent, goal }
      const res = await api.energyAct(editing ? { action: 'update', ...profile } : { action: 'start', consent, ...profile })
      if (res.ok) {
        track(editing ? 'energy_profile_updated' : 'energy_started', { hasBodyFat: profile.bodyFatPercent !== null })
        router.replace('/energy')
      } else {
        // The server's sentence names the field. If it is one of step one's, take her back to it.
        Alert.alert('Kontrol eder misin?', res.error.message ?? 'Lütfen bilgilerini kontrol et.')
        if (res.error.code === 'energy_profile_invalid' || res.error.code === 'energy_consent_required') setStep(1)
      }
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternetini kontrol edip tekrar dene.')
    } finally {
      setBusy(false)
    }
  }

  const input = {
    backgroundColor: p.surfaceElevated,
    borderColor: p.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    minHeight: 52,
    fontSize: 17,
    color: p.textPrimary,
    fontFamily: t.body.fontFamily,
  } as const

  return (
    <Screen header>
      <View style={{ gap: space(2) }}>
        <Txt role="caption" tone="muted">Adım {step} / 2</Txt>
        <ProgressBar value={step / 2} color={p.primary} track={p.surfaceMuted} height={4} />
      </View>

      {step === 1 ? (
        <FadeInUp key="one">
          <View style={{ gap: space(5) }}>
            <View style={{ gap: space(1.5) }}>
              <Txt role="h1">{editing ? 'Bilgilerini güncelle' : 'Seni biraz tanıyalım'}</Txt>
              <Txt role="body" tone="secondary">Kalori hesabı kilona, boyuna ve yaşına göre yapılır.</Txt>
            </View>

            {measuredOn ? (
              <View style={{ backgroundColor: p.successSoft, borderRadius: radius.md, padding: space(3.5) }}>
                <Txt role="caption" tone="success">Kilo ve yağ oranını {shortDate(measuredOn)} tarihli stüdyo ölçümünden aldık. İstersen değiştir.</Txt>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Field label="Kilo (kg)">
                <TextInput style={input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="64,0" placeholderTextColor={p.textMuted} />
              </Field>
              <Field label="Boy (cm)">
                <TextInput style={input} value={height} onChangeText={setHeight} keyboardType="number-pad" placeholder="165" placeholderTextColor={p.textMuted} />
              </Field>
            </View>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Field label="Doğum yılı">
                <TextInput style={input} value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="1992" placeholderTextColor={p.textMuted} maxLength={4} />
              </Field>
              <Field label="Yağ oranı (%) · isteğe bağlı">
                <TextInput style={input} value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={p.textMuted} />
              </Field>
            </View>
            <Txt role="caption" tone="muted">Yağ oranını bilmiyorsan boş bırak. Verirsen hesabı daha net yaparız.</Txt>

            {!editing ? (
              <View style={{ gap: space(2) }}>
                <Pressable onPress={() => setConsent((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }} style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start', minHeight: 44 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: consent ? p.primary : p.border, backgroundColor: consent ? p.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    {consent ? <Ionicons name="checkmark" size={16} color={p.onPrimary} /> : null}
                  </View>
                  <Txt role="caption" tone="secondary" style={{ flex: 1 }}>Kilo, boy ve yağ oranı bilgilerimin kalori hesabı için işlenmesine izin veriyorum.</Txt>
                </Pressable>
                <Pressable onPress={() => setNotice((v) => !v)} hitSlop={8} style={{ marginLeft: space(9) }}>
                  <Text style={[t.caption, { color: p.primary }]}>{notice ? 'Aydınlatma metnini gizle' : 'Aydınlatma metni'}</Text>
                </Pressable>
                {notice ? (
                  <View style={{ marginLeft: space(9), gap: space(1.5) }}>
                    <Txt role="caption" tone="muted">Kilo, boy, doğum yılı ve yağ oranı bilgilerin yalnızca kalori hesabı için kullanılır; stüdyo dışında kimseyle paylaşılmaz.</Txt>
                    <Txt role="caption" tone="muted">Kardiyo aleti fotoğrafların, üzerindeki rakamların okunması için bir yapay zekâ hizmetine gönderilir ve saklanmaz.</Txt>
                    <Txt role="caption" tone="muted">Takibi istediğin an kapatabilirsin; kapattığında bu bilgiler ve günlük kayıtların silinir.</Txt>
                  </View>
                ) : null}
              </View>
            ) : null}

            <PrimaryButton label="Devam et" onPress={() => setStep(2)} disabled={!stepOneReady} full />
          </View>
        </FadeInUp>
      ) : (
        <FadeInUp key="two">
          <View style={{ gap: space(5) }}>
            <View style={{ gap: space(1.5) }}>
              <Txt role="h1">Amacın ne?</Txt>
              <Txt role="body" tone="secondary">İstediğin zaman değiştirebilirsin.</Txt>
            </View>

            <View style={{ gap: space(2.5) }} accessibilityRole="radiogroup">
              {GOALS.map((g) => {
                const on = goal === g.key
                return (
                  <PressableScale key={g.key} onPress={() => setGoal(g.key)}>
                    <View
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={{ minHeight: 68, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: p.surfaceElevated, paddingHorizontal: space(4), paddingVertical: space(3), justifyContent: 'center', gap: 2 }}
                    >
                      <Txt role="h3">{g.title}</Txt>
                      <Txt role="caption" tone="secondary">{g.body}</Txt>
                    </View>
                  </PressableScale>
                )
              })}
            </View>

            <Txt role="caption" tone="muted">Rakamlar tahmindir, tıbbi tavsiye değildir. Hamilelik, emzirme ya da bir sağlık sorunun varsa hekimine veya diyetisyenine danış.</Txt>

            <View style={{ gap: space(3) }}>
              <PrimaryButton label={editing ? 'Kaydet' : 'Takibi başlat'} onPress={() => void finish()} loading={busy} full />
              <Pressable onPress={() => setStep(1)} hitSlop={8} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[t.button, { color: p.textSecondary }]}>Geri</Text>
              </Pressable>
            </View>
          </View>
        </FadeInUp>
      )}
    </Screen>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, gap: space(1.5) }}>
      <Txt role="caption" tone="secondary" numberOfLines={1}>{label}</Txt>
      {children}
    </View>
  )
}
