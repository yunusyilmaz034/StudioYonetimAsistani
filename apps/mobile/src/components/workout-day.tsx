import { useState, type ReactNode } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import type { ProgramDay } from '@studio/core/client'
import type { WorkoutSetEntryDto } from '@/lib/api'
import { Body } from '@/components/ui'
import { radius, space, typo as t, usePalette } from '@/theme'

// ── ANTRENMAN TAKİBİ (owner, 2026-08-06) ─────────────────────────────────────────────────────
//
// She opens the day she is on, ticks the moves as she does them, and finishes the day. Three rules
// the owner set, and each one removes work rather than adding it:
//
// 1. THE ORDER IS FIXED — 1 → 2 → 3 → 1 ("sıralama atlamaya izin yok"). Only the next day opens; the
//    others show what they are and stay shut. The screen does not enforce this, it only REFLECTS it:
//    the refusal lives in the domain, so a stale screen or a replayed request cannot skip a day.
//
// 2. THE PROGRAMME'S NUMBERS ARE PLACEHOLDERS, not values. A member who trained exactly as
//    prescribed — the common case — types nothing at all, and an untouched field is stored as `null`
//    meaning "as prescribed". Only a DIFFERENCE is recorded. Pre-filling the inputs instead would
//    make every workout look deliberately logged and cost her twelve edits to say nothing.
//
// 3. THE NOTE IS READ BY THE TRAINER, and she is told so under the field. A note she thinks is
//    private and a note she knows Işıl reads are different notes; hiding which one this is would
//    collect the wrong thing and then act on it.
//
// This is NOT a check-in. Ticking here is her telling us she trained; the door is what observes that
// she was here. They are never added together — see `workout.day_completed` in core's events.ts.

const numOrNull = (v: string): number | null => {
  const n = Number(v.replace(',', '.'))
  return v.trim() === '' || Number.isNaN(n) ? null : n
}

export function WorkoutDay({
  day,
  isNext,
  doneCount,
  nextDayName,
  onComplete,
  children,
}: {
  day: ProgramDay
  isNext: boolean
  doneCount: number
  nextDayName: string
  onComplete: (entries: readonly WorkoutSetEntryDto[], note: string) => Promise<boolean>
  children: ReactNode
}) {
  const p = usePalette()
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [skipped, setSkipped] = useState<Record<string, boolean>>({})
  const [sets, setSets] = useState<Record<string, string>>({})
  const [reps, setReps] = useState<Record<string, string>>({})
  const [kg, setKg] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const total = day.exercises.length
  const doneNow = day.exercises.filter((e) => ticked[e.exerciseId] || skipped[e.exerciseId]).length

  async function finish() {
    setBusy(true)
    try {
      // Every exercise is sent, including the ones she never touched: the day is a whole, and a
      // slot with three nulls is the record that she did it as written.
      const entries: WorkoutSetEntryDto[] = day.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        sets: numOrNull(sets[e.exerciseId] ?? ''),
        reps: (reps[e.exerciseId] ?? '').trim() || null,
        // Kilograms on screen, integer GRAMS on the wire — 12,5 kg must never become 12.499999.
        weightGrams: (() => {
          const n = numOrNull(kg[e.exerciseId] ?? '')
          return n === null ? null : Math.round(n * 1000)
        })(),
        skipped: Boolean(skipped[e.exerciseId]),
      }))
      const ok = await onComplete(entries, note.trim())
      if (ok) {
        setOpen(false)
        setTicked({})
        setSkipped({})
        setSets({})
        setReps({})
        setKg({})
        setNote('')
      } else {
        Alert.alert('Kaydedilemedi', 'Tekrar dene.')
      }
    } finally {
      setBusy(false)
    }
  }

  // A day that is not next says so and stays shut. It still shows how many times she has done it —
  // a closed door with a number on it explains itself; a greyed-out row does not.
  if (!isNext) {
    return (
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Body style={[t.eyebrow, { flex: 1, color: p.textFaint }]}>{day.name}</Body>
          {doneCount > 0 ? <Body faint style={{ fontSize: 11.5 }}>{doneCount}× tamamlandı</Body> : null}
          <Ionicons name="lock-closed" size={13} color={p.textFaint} />
        </View>
        <Body faint style={{ fontSize: 12.5, fontStyle: 'italic' }}>
          Sırada {nextDayName} var — programı sırayla uyguluyorsun.
        </Body>
      </View>
    )
  }

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Body style={[t.eyebrow, { flex: 1, color: p.accent }]}>{day.name} · sırada</Body>
        {doneCount > 0 ? <Body faint style={{ fontSize: 11.5 }}>{doneCount}× tamamlandı</Body> : null}
      </View>

      {!open ? (
        <>
          {children}
          <Pressable
            onPress={() => setOpen(true)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              backgroundColor: p.accent,
              borderRadius: radius.pill,
              paddingVertical: space(3.5),
              alignItems: 'center',
            })}
          >
            <Body style={{ color: p.accentText, fontWeight: '700', fontSize: 15 }}>Bu antrenmanı yap</Body>
          </Pressable>
        </>
      ) : (
        <View style={{ gap: space(3) }}>
          {day.exercises.map((ex) => {
            const on = Boolean(ticked[ex.exerciseId])
            const skip = Boolean(skipped[ex.exerciseId])
            return (
              <View
                key={ex.exerciseId}
                style={{
                  gap: space(2.5),
                  paddingVertical: space(3),
                  borderBottomWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: p.hairline,
                  opacity: skip ? 0.55 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                  {/* 44px of touch target — the studio's mobile floor, and this is the control the
                      whole screen exists for. */}
                  <Pressable
                    onPress={() => {
                      setTicked((s) => ({ ...s, [ex.exerciseId]: !on }))
                      if (!on) setSkipped((s) => ({ ...s, [ex.exerciseId]: false }))
                    }}
                    hitSlop={8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${ex.nameTr} — yaptım`}
                    style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        borderWidth: StyleSheet.hairlineWidth * 3,
                        borderColor: on ? p.accent : p.hairline,
                        backgroundColor: on ? p.accent : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Ionicons name="checkmark" size={16} color={p.accentText} /> : null}
                    </View>
                  </Pressable>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body strong style={{ fontSize: 14.5 }} numberOfLines={1}>{ex.nameTr}</Body>
                    <Body faint style={{ fontSize: 12 }}>{ex.sets} × {ex.reps}{ex.tempo ? ` · ${ex.tempo}` : ''}</Body>
                  </View>
                  <Pressable
                    onPress={() => {
                      setSkipped((s) => ({ ...s, [ex.exerciseId]: !skip }))
                      if (!skip) setTicked((s) => ({ ...s, [ex.exerciseId]: false }))
                    }}
                    hitSlop={8}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space(2) }}
                  >
                    <Body style={{ fontSize: 12, color: skip ? p.accent : p.textFaint, fontWeight: skip ? '700' : '400' }}>
                      {skip ? 'atlandı' : 'atla'}
                    </Body>
                  </Pressable>
                </View>

                {/* The programme's own numbers, as PLACEHOLDERS. Typing over one records a
                    difference; leaving it records that she did it as written. */}
                {on ? (
                  <View style={{ flexDirection: 'row', gap: space(2), paddingLeft: 44 + space(3) }}>
                    <Field label="set" placeholder={String(ex.sets)} value={sets[ex.exerciseId] ?? ''} onChange={(v) => setSets((s) => ({ ...s, [ex.exerciseId]: v }))} />
                    <Field label="tekrar" placeholder={ex.reps} value={reps[ex.exerciseId] ?? ''} onChange={(v) => setReps((s) => ({ ...s, [ex.exerciseId]: v }))} numeric={false} />
                    <Field label="kg" placeholder="—" value={kg[ex.exerciseId] ?? ''} onChange={(v) => setKg((s) => ({ ...s, [ex.exerciseId]: v }))} />
                  </View>
                ) : null}
              </View>
            )
          })}

          <View style={{ gap: 6 }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Bugün nasıl geçti? (isteğe bağlı)"
              placeholderTextColor={p.textFaint}
              multiline
              style={{
                minHeight: 72,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: p.hairline,
                borderRadius: radius.md,
                padding: space(3),
                color: p.text,
                fontSize: 14,
                textAlignVertical: 'top',
              }}
            />
            <Body faint style={{ fontSize: 11.5 }}>Notunu eğitmenin görebilir.</Body>
          </View>

          <View style={{ flexDirection: 'row', gap: space(2.5) }}>
            <Pressable
              onPress={() => setOpen(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: space(3.5), paddingHorizontal: space(4) })}
            >
              <Body muted style={{ fontWeight: '600' }}>Vazgeç</Body>
            </Pressable>
            <Pressable
              onPress={() => void finish()}
              disabled={busy || doneNow === 0}
              style={({ pressed }) => ({
                flex: 1,
                opacity: pressed || busy ? 0.7 : doneNow === 0 ? 0.4 : 1,
                backgroundColor: p.accent,
                borderRadius: radius.pill,
                paddingVertical: space(3.5),
                alignItems: 'center',
              })}
            >
              <Body style={{ color: p.accentText, fontWeight: '700', fontSize: 15 }}>
                {busy ? '…' : `Günü bitir · ${doneNow}/${total}`}
              </Body>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  numeric = true,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  numeric?: boolean
}) {
  const p = usePalette()
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={p.textFaint}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={{
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: p.hairline,
          borderRadius: radius.sm,
          paddingVertical: space(2),
          paddingHorizontal: space(2.5),
          color: p.text,
          fontSize: 14,
          textAlign: 'center',
        }}
      />
      <Body faint style={{ fontSize: 10.5, textAlign: 'center' }}>{label}</Body>
    </View>
  )
}
