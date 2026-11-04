// IG-2c — PURE: the subtitle + hook file (ASS) the renderer burns into the video. Tested.
// 1080×1920 canvas. Hook: top, black on white, the first 3 seconds. Subtitles: lower third, white
// with a dark outline — readable on any background, clear of Instagram's own buttons at the bottom.
import type { ContentEditPlan } from '@studio/core'

export const HOOK_SECONDS = 3

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
/** seconds → ASS time `h:mm:ss.cc` */
export function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100))
  const h = Math.floor(cs / 360_000)
  const m = Math.floor((cs % 360_000) / 6000)
  const sec = Math.floor((cs % 6000) / 100)
  return `${h}:${pad(m)}:${pad(sec)}.${pad(cs % 100)}`
}

/** Text as ASS shows it: no override blocks, no stray backslashes, line breaks as \N. */
export function assText(t: string): string {
  return t.replace(/\\/g, '／').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()
}

export function buildAss(plan: Pick<ContentEditPlan, 'hook' | 'subtitles' | 'lines' | 'seconds'>, font = 'DejaVu Sans'): string {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // BorderStyle 3 = an opaque box in OutlineColour (white) behind black text.
    `Style: Hook,${font},76,&H00141414,&H00141414,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,18,0,8,90,90,250,1`,
    `Style: Sub,${font},62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,1,2,90,90,420,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const ev: string[] = []
  const hook = assText(plan.hook)
  if (hook) ev.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(HOOK_SECONDS, plan.seconds))},Hook,,0,0,0,,${hook}`)
  if (plan.subtitles) {
    for (const l of plan.lines) {
      const text = assText(l.text)
      if (!text || l.end <= l.start) continue
      ev.push(`Dialogue: 0,${assTime(l.start)},${assTime(Math.min(l.end, plan.seconds))},Sub,,0,0,0,,${text}`)
    }
  }
  return [...head, ...ev, ''].join('\n')
}
