// IG-2c — PURE: the ffmpeg command for one edit. Tested.
//
// Every segment is its own input (`-ss … -t … -i clip`), scaled+cropped to 1080×1920 at 30 fps, then
// concatenated. A clip with no sound gets silence, so concat always sees audio. Music (optional) is
// looped to the length, faded out, and DUCKED under speech (sidechain) — or, with no speech, laid
// over the room sound turned down.
export interface RenderSegment {
  readonly path: string
  readonly from: number
  readonly to: number
  readonly hasAudio: boolean
}

export interface RenderInput {
  readonly segments: readonly RenderSegment[]
  readonly seconds: number
  readonly musicPath: string | null
  readonly speech: boolean
  readonly assPath: string | null
  readonly fontsDir: string
  readonly out: string
}

const f = (n: number) => n.toFixed(2)

export function renderArgs(i: RenderInput): string[] {
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  i.segments.forEach((s) => args.push('-ss', f(s.from), '-t', f(s.to - s.from), '-i', s.path))
  const m = i.segments.length
  if (i.musicPath) args.push('-stream_loop', '-1', '-i', i.musicPath)

  const g: string[] = []
  i.segments.forEach((s, k) => {
    const d = f(s.to - s.from)
    g.push(`[${k}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${k}]`)
    g.push(
      s.hasAudio
        ? `[${k}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${d},asetpts=N/SR/TB[a${k}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${d}[a${k}]`,
    )
  })
  g.push(`${i.segments.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${m}:v=1:a=1[vc][ac]`)
  const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  g.push(i.assPath ? `[vc]subtitles='${esc(i.assPath)}':fontsdir='${esc(i.fontsDir)}'[vout]` : '[vc]null[vout]')

  if (i.musicPath) {
    const fade = Math.max(0, i.seconds - 1.5)
    g.push(`[${m}:a]atrim=0:${f(i.seconds)},asetpts=N/SR/TB,aresample=48000,aformat=channel_layouts=stereo,volume=0.55,afade=t=out:st=${f(fade)}:d=1.5[mus]`)
    if (i.speech) {
      g.push('[ac]asplit=2[voice][side]')
      g.push('[mus][side]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=500[duck]')
      g.push('[voice][duck]amix=inputs=2:duration=first:normalize=0[aout]')
    } else {
      g.push('[ac]volume=0.25[room]')
      g.push('[room][mus]amix=inputs=2:duration=first:normalize=0[aout]')
    }
  } else {
    g.push('[ac]anull[aout]')
  }

  args.push('-filter_complex', g.join(';'))
  args.push('-map', '[vout]', '-map', '[aout]')
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p')
  args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000')
  args.push('-movflags', '+faststart', '-t', f(i.seconds), i.out)
  return args
}
