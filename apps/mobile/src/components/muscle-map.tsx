import { View } from 'react-native'
import Svg, { Polygon } from 'react-native-svg'

import { ANTERIOR, POSTERIOR, type MuscleShape } from './body-shapes'

// THE TARGET-MUSCLE DIAGRAM (owner, 2026-08-01) — the same picture the web panel draws.
//
// The member could see which muscles an exercise works on the web, and not in the app she actually
// trains with. Same geometry, same three colours, so "Leg Press" looks like Leg Press wherever she
// opens it. Which muscles to paint is answered by the SERVER (`guide.primaryMuscles`), not by a copy
// of the exercise table living in this app — a copy would go stale the first time an exercise is
// added and the app is not rebuilt.
const PRIMARY = '#d62828' // ana hedef
const SECONDARY = '#f0a1a1' // ikincil
const BODY = '#b7a8b0' // everything else

function Figure({
  shapes,
  primary,
  secondary,
}: {
  shapes: readonly MuscleShape[]
  primary: readonly string[]
  secondary: readonly string[]
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 200">
      {shapes.map((s, gi) =>
        s.p.map((points, i) => (
          <Polygon
            key={`${gi}-${i}`}
            points={points}
            fill={primary.includes(s.m) ? PRIMARY : secondary.includes(s.m) ? SECONDARY : BODY}
          />
        )),
      )}
    </Svg>
  )
}

export function MuscleMap({
  primary,
  secondary,
}: {
  primary: readonly string[]
  secondary: readonly string[]
}) {
  return (
    // A fixed aspect ratio, because an SVG with a percentage height inside a scroll view collapses to
    // nothing — the figure is 100×200, so the box is too.
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
      <View style={{ width: 116, aspectRatio: 0.5 }}>
        <Figure shapes={ANTERIOR} primary={primary} secondary={secondary} />
      </View>
      <View style={{ width: 116, aspectRatio: 0.5 }}>
        <Figure shapes={POSTERIOR} primary={primary} secondary={secondary} />
      </View>
    </View>
  )
}
