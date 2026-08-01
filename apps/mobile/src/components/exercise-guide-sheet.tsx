import { useState } from 'react'
import { Image, Modal, ScrollView, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { guideLines, parseGuideTargets, type ExerciseGuide } from '@studio/core/client'

import { MuscleMap } from './muscle-map'
import { PressableScale } from './motion'
import { Body, Button } from './ui'
import { VideoModal } from './video-modal'
import { radius, space, usePalette } from '@/theme'

// THE MOVEMENT GUIDE, IN THE APP (owner, 2026-08-01).
//
// *"Üye web görünümünde egzersizlerin yapılış şekillerini grafik olarak sundum ama burada yok."* The
// member could see how to perform an exercise on the web and not in the app she trains with — where
// she is actually standing at the machine, phone in hand. So this is the panel's guide (PF-11),
// section for section: target muscles on a body diagram, the movement summary, the correct movement
// with photos and cues, and the common mistakes.
//
// Everything it renders was ALREADY in the training payload; the app simply was not showing it. No
// API change, no new round trip — opening the sheet costs nothing.
const PRIMARY = '#d62828'
const SECONDARY = '#f0a1a1'
const WEAK = '#f9c0c0'

export function ExerciseGuideSheet({ guide, onClose }: { guide: ExerciseGuide; onClose: () => void }) {
  const p = usePalette()
  const [videoOpen, setVideoOpen] = useState(false)
  const t = parseGuideTargets(guide.description)
  const images = [guide.photoUrl, guide.gifUrl].filter((u): u is string => Boolean(u))
  const tips = guideLines(guide.tips)
  const mistakes = guideLines(guide.commonMistakes)
  const primary = guide.primaryMuscles ?? []
  const secondary = guide.secondaryMuscles ?? []
  const hasTargets = Boolean(t.ana || t.ikincil || t.zayif || t.note)
  const hasDiagram = primary.length > 0 || secondary.length > 0
  const empty = !hasTargets && !hasDiagram && !t.summary && images.length === 0 && tips.length === 0 && mistakes.length === 0 && !guide.videoUrl

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <View
          style={{
            backgroundColor: p.bgElevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            maxHeight: '92%',
            overflow: 'hidden',
          }}
        >
          {/* The title band — dark, centred, the same face the panel's dialog wears. */}
          <View style={{ backgroundColor: p.text, paddingHorizontal: space(5), paddingVertical: space(4) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Body strong style={{ color: p.bg, fontSize: 18, textAlign: 'center', textTransform: 'uppercase' }}>
                  {guide.nameTr}
                </Body>
                {guide.muscleGroup || guide.equipment ? (
                  <Body style={{ color: p.bg, opacity: 0.7, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
                    {[guide.muscleGroup, guide.equipment].filter(Boolean).join(' · ')}
                  </Body>
                ) : null}
              </View>
              <PressableScale onPress={onClose}>
                <Ionicons name="close" size={24} color={p.bg} />
              </PressableScale>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: space(5), paddingBottom: space(9), gap: space(5) }}>
            {/* HEDEF KAS GRUPLARI */}
            {hasTargets || hasDiagram ? (
              <View style={{ gap: space(3) }}>
                <SectionTitle icon="locate-outline">Hedef Kas Grupları</SectionTitle>
                {hasDiagram ? <MuscleMap primary={primary} secondary={secondary} /> : null}
                <View style={{ gap: space(2) }}>
                  {t.ana ? <Target color={PRIMARY} label="Ana Hedef" value={t.ana} /> : null}
                  {t.ikincil ? <Target color={SECONDARY} label="İkincil Hedef" value={t.ikincil} /> : null}
                  {t.zayif ? <Target color={WEAK} label="Zayıf Etki" value={t.zayif} /> : null}
                  {t.note ? <Body muted style={{ fontSize: 12.5 }}>{t.note}</Body> : null}
                </View>
              </View>
            ) : null}

            {/* HAREKETİN ÖZETİ */}
            {t.summary ? (
              <View style={{ gap: space(2) }}>
                <SectionTitle icon="clipboard-outline">Hareketin Özeti</SectionTitle>
                <Body style={{ fontSize: 14.5, lineHeight: 21 }}>{t.summary}</Body>
              </View>
            ) : null}

            {/* DOĞRU HAREKET */}
            {images.length > 0 || tips.length > 0 ? (
              <View style={{ gap: space(2.5), borderWidth: 1, borderColor: `${p.good}55`, backgroundColor: `${p.good}0D`, borderRadius: radius.lg, padding: space(3.5) }}>
                <SectionTitle icon="checkmark-circle-outline" color={p.good}>Doğru Hareket</SectionTitle>
                {images.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                    {images.map((src) => (
                      <Image
                        key={src}
                        source={{ uri: src }}
                        style={{ flexGrow: 1, flexBasis: '46%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: p.surfaceMuted }}
                        resizeMode="cover"
                      />
                    ))}
                  </View>
                ) : null}
                {tips.map((l) => (
                  <View key={l} style={{ flexDirection: 'row', gap: space(2) }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.good, marginTop: 7 }} />
                    <Body style={{ flex: 1, fontSize: 14 }}>{l}</Body>
                  </View>
                ))}
              </View>
            ) : null}

            {/* YANLIŞ HAREKET */}
            {mistakes.length > 0 ? (
              <View style={{ gap: space(2.5), borderWidth: 1, borderColor: `${p.danger}55`, backgroundColor: `${p.danger}0D`, borderRadius: radius.lg, padding: space(3.5) }}>
                <SectionTitle icon="alert-circle-outline" color={p.danger}>Yanlış Hareket</SectionTitle>
                {mistakes.map((l) => (
                  <View key={l} style={{ flexDirection: 'row', gap: space(2) }}>
                    <Ionicons name="warning-outline" size={15} color={p.danger} style={{ marginTop: 2 }} />
                    <Body style={{ flex: 1, fontSize: 14 }}>{l}</Body>
                  </View>
                ))}
              </View>
            ) : null}

            {guide.videoUrl ? <Button label="Videoyu izle" icon={<Ionicons name="play" size={16} color="#FFFFFF" />} onPress={() => setVideoOpen(true)} /> : null}

            {empty ? <Body muted>Bu hareket için henüz rehber girilmemiş.</Body> : null}
          </ScrollView>
        </View>
      </View>

      {videoOpen && guide.videoUrl ? (
        <VideoModal url={guide.videoUrl} title={guide.nameTr} onClose={() => setVideoOpen(false)} />
      ) : null}
    </Modal>
  )
}

function SectionTitle({ icon, children, color }: { icon: keyof typeof Ionicons.glyphMap; children: string; color?: string }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      <Ionicons name={icon} size={15} color={color ?? p.textMuted} />
      <Body style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: color ?? p.textMuted }}>
        {children}
      </Body>
    </View>
  )
}

function Target({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginTop: 5 }} />
      <Body style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color }}>{label}</Body>
      <Body style={{ flex: 1, fontSize: 14 }}>{value}</Body>
    </View>
  )
}
