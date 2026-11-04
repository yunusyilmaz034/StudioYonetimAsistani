// IG-2c — PURE: whisper.cpp's JSON output (`-oj`) → transcript lines of one raw clip. Tested.
import type { TranscriptLine } from '@studio/core'

interface WhisperJson {
  readonly transcription?: readonly { readonly offsets?: { readonly from?: number; readonly to?: number }; readonly text?: string }[]
}

// Whisper's tell-tale hallucinations on silence/music ("Altyazı M.K.", "[Müzik]", "♪"). Not speech.
const NOISE = /^(\[.*\]|\(.*\)|♪+|altyaz[ıi].*|abone ol.*|izlediğiniz için teşekkürler.*)$/iu

export function parseWhisper(raw: string, slot: number): TranscriptLine[] {
  let d: WhisperJson
  try {
    d = JSON.parse(raw) as WhisperJson
  } catch {
    return []
  }
  const out: TranscriptLine[] = []
  for (const seg of d.transcription ?? []) {
    const text = String(seg.text ?? '').replace(/\s+/g, ' ').trim()
    const start = Number(seg.offsets?.from ?? NaN) / 1000
    const end = Number(seg.offsets?.to ?? NaN) / 1000
    if (!text || NOISE.test(text) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    out.push({ slot, index: out.length, start, end, text })
  }
  return out
}
