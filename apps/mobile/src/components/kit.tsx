// The component kit for the owner's UI Board (2026-08-14).
//
// ── WHY A SECOND FILE ───────────────────────────────────────────────────────────────────────
//
// `ui.tsx` is the old kit and half the app still reads from it. Adding the new language there would
// mean one file with two design systems inside it and no way to tell which component belongs to
// which — so this file is the new one, screens migrate onto it a screen at a time, and `ui.tsx`
// shrinks as they do. When it is empty it goes.
//
// ── THE RULES THIS KIT ENFORCES ─────────────────────────────────────────────────────────────
//
//   • No screen writes a colour, radius, shadow or font. Everything here reads `theme.ts`.
//   • Weight is scarce. Bold belongs to figures and buttons; a screen where everything is bold has
//     no hierarchy, only noise.
//   • Every interactive surface has a pressed state. A card that does not answer a touch feels
//     broken before it feels cheap.
//   • Every list component ships its own skeleton and its own empty state, in this file, so a screen
//     cannot forget them — which is how spinners end up in the middle of the page.
import type { ReactNode } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { PressableScale } from './motion'
import { GradientFill } from './ui'
import { radius, shadow, space, typo as t, usePalette, trUpper } from '@/theme'

// ── TEXT ────────────────────────────────────────────────────────────────────────────────────

type TextRole = 'display' | 'h1' | 'h2' | 'h3' | 'bodyLarge' | 'body' | 'caption' | 'label' | 'button'
type TextTone = 'primary' | 'secondary' | 'muted' | 'brand' | 'onPrimary' | 'success' | 'warning' | 'error'

export function Txt({
  children,
  role = 'body',
  tone = 'primary',
  style,
  numberOfLines,
  align,
}: {
  children: ReactNode
  role?: TextRole
  tone?: TextTone
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  align?: 'left' | 'center' | 'right'
}) {
  const p = usePalette()
  const colour: Record<TextTone, string> = {
    primary: p.textPrimary,
    secondary: p.textSecondary,
    muted: p.textMuted,
    brand: p.primary,
    onPrimary: p.onPrimary,
    success: p.success,
    warning: p.warning,
    error: p.error,
  }
  return (
    <Text numberOfLines={numberOfLines} style={[t[role], { color: colour[tone] }, align ? { textAlign: align } : null, style]}>
      {children}
    </Text>
  )
}

/** A figure the member reads as a fact about herself. Tabular, so a column of them lines up. */
export function Figure({ value, unit, size = 'lg', tone = 'primary' }: { value: string | number; unit?: string; size?: 'lg' | 'sm'; tone?: TextTone }) {
  const p = usePalette()
  const colour = tone === 'brand' ? p.primary : tone === 'success' ? p.success : p.textPrimary
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(1.5) }}>
      <Text style={[size === 'lg' ? t.num : t.numSm, { color: colour }]}>{value}</Text>
      {unit ? <Txt role="caption" tone="muted">{unit}</Txt> : null}
    </View>
  )
}

// ── SURFACES ────────────────────────────────────────────────────────────────────────────────

/**
 * The base card. Lifted, not floating: a hairline border does most of the separating and the shadow
 * only confirms it. Level 2 is for something genuinely above the page.
 */
export function PremiumCard({
  children,
  onPress,
  style,
  padded = true,
  level = 1,
}: {
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  padded?: boolean
  level?: 1 | 2
}) {
  const p = usePalette()
  const body = (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.lg,
          padding: padded ? space(4) : 0,
          overflow: 'hidden',
        },
        shadow(level),
        style,
      ]}
    >
      {children}
    </View>
  )
  return onPress ? <PressableScale onPress={onPress}>{body}</PressableScale> : body
}

/** A section heading. Quiet by design — it organises, it does not compete. */
export function SectionHeader({ children, action, onAction }: { children: string; action?: string; onAction?: () => void }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) }}>
      <Text style={[t.label, { color: p.textMuted }]}>{trUpper(children)}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[t.caption, { color: p.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// ── BUTTONS ─────────────────────────────────────────────────────────────────────────────────

function useButtonBody(disabled?: boolean) {
  return {
    height: 48,
    borderRadius: radius.md,
    paddingHorizontal: space(5),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: space(2),
    opacity: disabled ? 0.45 : 1,
  }
}

export function PrimaryButton({ label, onPress, disabled, loading, icon, full }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; icon?: keyof typeof Ionicons.glyphMap; full?: boolean }) {
  const p = usePalette()
  const base = useButtonBody(disabled || loading)
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [base, { backgroundColor: pressed ? p.primaryPressed : p.primary, alignSelf: full ? 'stretch' : 'flex-start' }]}>
      {icon ? <Ionicons name={icon} size={17} color={p.onPrimary} /> : null}
      <Text style={[t.button, { color: p.onPrimary }]}>{loading ? '…' : label}</Text>
    </Pressable>
  )
}

export function SecondaryButton({ label, onPress, disabled, icon, full }: { label: string; onPress: () => void; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap; full?: boolean }) {
  const p = usePalette()
  const base = useButtonBody(disabled)
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [base, { backgroundColor: pressed ? p.primarySoft : 'transparent', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: p.primary, alignSelf: full ? 'stretch' : 'flex-start' }]}>
      {icon ? <Ionicons name={icon} size={17} color={p.primary} /> : null}
      <Text style={[t.button, { color: p.primary }]}>{label}</Text>
    </Pressable>
  )
}

export function TextButton({ label, onPress, tone = 'brand' }: { label: string; onPress: () => void; tone?: 'brand' | 'muted' }) {
  const p = usePalette()
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: space(1) })}>
      <Text style={[t.button, { color: tone === 'brand' ? p.primary : p.textSecondary }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={tone === 'brand' ? p.primary : p.textSecondary} />
    </Pressable>
  )
}

// ── CHIPS ───────────────────────────────────────────────────────────────────────────────────

export type ChipTone = 'success' | 'brand' | 'neutral' | 'warning' | 'error' | 'outline'

/**
 * A state, not a button. `Katılıyorum` · `Yer Ayırt` · `Dolu` · `Tamamlandı` — the domain's own
 * words, so the chip never invents a status the server does not have.
 */
export function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  const p = usePalette()
  const map: Record<ChipTone, { bg: string; fg: string; border?: string }> = {
    success: { bg: p.successSoft, fg: p.success },
    brand: { bg: p.primarySoft, fg: p.primary },
    neutral: { bg: p.surfaceMuted, fg: p.textSecondary },
    warning: { bg: p.warningSoft, fg: p.warning },
    error: { bg: p.errorSoft, fg: p.error },
    outline: { bg: 'transparent', fg: p.primary, border: p.primary },
  }
  const c = map[tone]
  return (
    <View style={{ paddingHorizontal: space(2.5), paddingVertical: space(1.5), borderRadius: radius.pill, backgroundColor: c.bg, borderWidth: c.border ? StyleSheet.hairlineWidth * 2 : 0, borderColor: c.border }}>
      <Text style={[t.caption, { color: c.fg, fontSize: 11.5 }]}>{label}</Text>
    </View>
  )
}

/** A filter chip — pressed state included, because a filter that does not answer feels dead. */
export function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const p = usePalette()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      paddingHorizontal: space(3.5),
      paddingVertical: space(2),
      borderRadius: radius.pill,
      backgroundColor: active ? p.primary : pressed ? p.primarySoft : p.surface,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: active ? p.primary : p.border,
    })}>
      <Text style={[t.caption, { color: active ? p.onPrimary : p.textSecondary }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * The Ajanda split. Filled burgundy for the active side, exactly as the Board draws it — the two
 * are different TASKS and the control has to say so at a glance, which an underline does not.
 */
export function SegmentedControl<T extends string>({ options, value, onChange }: { options: readonly { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', gap: space(2), padding: space(1), backgroundColor: p.surfaceMuted, borderRadius: radius.pill }}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, paddingVertical: space(2.5), borderRadius: radius.pill, backgroundColor: on ? p.primary : 'transparent', alignItems: 'center' }}>
            <Text style={[t.caption, { color: on ? p.onPrimary : p.textSecondary, fontSize: 13 }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ── CONTENT CARDS ───────────────────────────────────────────────────────────────────────────

/** A metric she reads about herself: the figure leads, the label explains, the change is a direction. */
export function MetricCard({ label, value, unit, delta, note, onPress }: { label: string; value: string | number; unit?: string; delta?: string | null; note?: string; onPress?: () => void }) {
  return (
    <PremiumCard onPress={onPress} style={{ flex: 1 }}>
      <Txt role="label" tone="muted">{trUpper(label)}</Txt>
      <View style={{ marginTop: space(2) }}>
        <Figure value={value} unit={unit} size="sm" />
      </View>
      {delta ? <Txt role="caption" tone="success" style={{ marginTop: space(1) }}>{delta}</Txt> : null}
      {note ? <Txt role="caption" tone="muted" style={{ marginTop: space(1) }}>{note}</Txt> : null}
    </PremiumCard>
  )
}

/**
 * The studio's own voice. Editorial on purpose — a quote mark, generous leading, no chrome — so it
 * reads as somebody at the desk writing to her rather than as a system notice.
 */
export function StudioMessageCard({ title, body, sender, unread, onPress }: { title?: string; body: string; sender?: string; unread?: boolean; onPress?: () => void }) {
  const p = usePalette()
  return (
    <PremiumCard onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(2) }}>
        <Text style={[t.label, { color: p.primary, flex: 1 }]} numberOfLines={1}>{trUpper(sender ? `${sender}'dan sana not` : 'Stüdyodan')}</Text>
        {unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.primary }} /> : null}
      </View>
      {title ? <Txt role="h3" numberOfLines={1} style={{ marginBottom: space(1.5) }}>{title}</Txt> : null}
      <Txt role="bodyLarge" tone="secondary" numberOfLines={3}>{body}</Txt>
    </PremiumCard>
  )
}

/** The panel-managed banner. Gradient overlay so the copy survives whatever photograph is uploaded. */
export function DynamicBanner({ image, title, body, cta, onPress }: { image?: string | null; title: string; body?: string | null; cta?: string | null; onPress?: () => void }) {
  const p = usePalette()
  return (
    <PressableScale onPress={onPress ?? (() => {})}>
      <View style={[{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: p.surfaceMuted, minHeight: 168, justifyContent: 'flex-end' }, shadow(1)]}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {/* The overlay is what makes arbitrary artwork safe to put type on. Without it the studio
            uploads a bright photograph one day and the headline disappears.

            Drawn with the project's own SVG gradient rather than a new native dependency — one less
            pod, one less rebuild, and the same result. The `id` is unique per banner because two
            SVG gradients sharing a def id in one tree collide, and the second one renders wrong. */}
        <GradientFill id={`bn-${title.slice(0, 12)}`} from="#140A0E" fromOpacity={0} to="#140A0E" toOpacity={0.86} vertical />
        <View style={{ padding: space(4), gap: space(1.5) }}>
          <Text style={[t.h2, { color: '#FFFFFF' }]} numberOfLines={2}>{title}</Text>
          {body ? <Text style={[t.body, { color: 'rgba(255,255,255,0.88)' }]} numberOfLines={2}>{body}</Text> : null}
          {cta ? (
            <View style={{ alignSelf: 'flex-start', marginTop: space(2), paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: '#FFFFFF' }}>
              <Text style={[t.button, { color: p.primary, fontSize: 13 }]}>{cta}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  )
}

/** A quick action. Icon and word, nothing else — a grid of these becomes wallpaper very quickly. */
export function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const p = usePalette()
  return (
    <PressableScale onPress={onPress}>
      <View style={{ alignItems: 'center', gap: space(2), width: 76 }}>
        <View style={{ width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: p.border }}>
          <Ionicons name={icon} size={21} color={p.primary} />
        </View>
        <Txt role="caption" tone="secondary" align="center" numberOfLines={1}>{label}</Txt>
      </View>
    </PressableScale>
  )
}

// ── STATES ──────────────────────────────────────────────────────────────────────────────────

/**
 * An empty state that offers the way out. One that only reports emptiness reads as a fault; one that
 * gives her something to do reads as a product.
 */
export function EmptyState({ icon = 'calendar-outline', title, body, cta, onCta }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; cta?: string; onCta?: () => void }) {
  const p = usePalette()
  return (
    <View style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8), paddingHorizontal: space(4) }}>
      <View style={{ width: 56, height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surfaceMuted }}>
        <Ionicons name={icon} size={24} color={p.textMuted} />
      </View>
      <Txt role="h3" align="center">{title}</Txt>
      {body ? <Txt role="body" tone="muted" align="center">{body}</Txt> : null}
      {cta && onCta ? <View style={{ marginTop: space(1) }}><PrimaryButton label={cta} onPress={onCta} /></View> : null}
    </View>
  )
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
      <Txt role="h3" align="center">Bir şeyler ters gitti</Txt>
      <Txt role="body" tone="muted" align="center">Bağlantını kontrol edip tekrar dene.</Txt>
      <SecondaryButton label="Tekrar dene" onPress={onRetry} />
    </View>
  )
}

/** A block that stands in for real content. Never a spinner in the middle of a page. */
export function SkeletonBlock({ h = 14, w = '100%', r = 8, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  return <View style={[{ height: h, width: w, borderRadius: r, backgroundColor: p.surfaceMuted }, style]} />
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <PremiumCard>
      <SkeletonBlock h={11} w="35%" />
      <View style={{ height: space(3) }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} h={14} w={i === lines - 1 ? '60%' : '100%'} style={{ marginTop: i ? space(2) : 0 }} />
      ))}
    </PremiumCard>
  )
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: space(3) }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  )
}
