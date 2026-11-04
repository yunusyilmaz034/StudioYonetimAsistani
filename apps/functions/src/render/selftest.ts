// IG-2c — the render image's self-test. Touches no database and no storage: synthetic clips, a sine
// "music" track and whisper.cpp's own sample. Proves ffmpeg (cut, scale, subtitles, ducking) and
// whisper run in THIS image on THIS CPU. Run: `node selftest.cjs` inside the image (Cloud Build step).
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { buildAss } from './ass'
import { renderArgs } from './ffmpeg'
import { parseWhisper } from './whisper'

const run = promisify(execFile)
const ok = (cond: boolean, what: string) => {
  if (!cond) throw new Error(`SELFTEST FAILED: ${what}`)
  console.log(`ok · ${what}`)
}

async function main() {
  const d = await mkdtemp(join(tmpdir(), 'selftest-'))
  const ff = (...a: string[]) => run('ffmpeg', ['-y', '-loglevel', 'error', ...a], { maxBuffer: 16 << 20 })
  await ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', join(d, 'c0.mp4'))
  await ff('-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=25:duration=5', '-c:v', 'libx264', join(d, 'c1.mov'))
  await ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=20', '-c:a', 'libmp3lame', join(d, 'm.mp3'))
  const plan = { hook: 'İlk dersinde ŞUNU bilmiyordum', subtitles: true, seconds: 7.5, lines: [{ id: '0:0', start: 0.5, end: 3, text: 'Dizlerini hafif bük, nefesi bırak — çok güzel!', unsure: false }] }
  await writeFile(join(d, 's.ass'), buildAss(plan), 'utf8')
  const t0 = Date.now()
  await run(
    'ffmpeg',
    renderArgs({
      segments: [
        { path: join(d, 'c0.mp4'), from: 1, to: 5, hasAudio: true },
        { path: join(d, 'c1.mov'), from: 0.5, to: 4, hasAudio: false },
      ],
      seconds: 7.5,
      musicPath: join(d, 'm.mp3'),
      speech: true,
      assPath: join(d, 's.ass'),
      fontsDir: process.env.FONTS_DIR ?? '/usr/share/fonts/truetype/dejavu',
      out: join(d, 'out.mp4'),
    }),
    { maxBuffer: 16 << 20 },
  )
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', join(d, 'out.mp4')])
  const p = JSON.parse(stdout) as { streams: { codec_type: string; width?: number; height?: number; codec_name: string }[]; format: { duration: string } }
  const v = p.streams.find((s) => s.codec_type === 'video')
  ok(v?.width === 1080 && v.height === 1920, `render 1080×1920 (${v?.width}×${v?.height}) in ${Date.now() - t0} ms`)
  ok(Math.abs(Number(p.format.duration) - 7.5) < 0.2, `length 7.5 s (${p.format.duration})`)
  ok(p.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'), 'aac audio track')

  // whisper.cpp on its own English sample, then the Turkish model load path is the same binary.
  const t1 = Date.now()
  await run(process.env.WHISPER_BIN ?? '/opt/whisper/whisper-cli', ['-m', process.env.WHISPER_MODEL ?? '/opt/whisper/ggml-medium-q5_0.bin', '-l', 'en', '-t', String(cpus().length), '-oj', '-of', join(d, 'jfk'), '-np', '-f', '/opt/whisper/jfk.wav'], { maxBuffer: 16 << 20 })
  const lines = parseWhisper(await readFile(join(d, 'jfk.json'), 'utf8'), 0)
  ok(lines.map((l) => l.text).join(' ').toLowerCase().includes('country'), `whisper transcribed 11 s of speech in ${Date.now() - t1} ms on ${cpus().length} CPU: "${lines.map((l) => l.text).join(' ').slice(0, 60)}…"`)
  console.log('SELFTEST PASSED')
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
