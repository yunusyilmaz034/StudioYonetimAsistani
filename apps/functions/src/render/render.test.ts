import { describe, expect, it } from 'vitest'

import { renderJobRequest } from '../triggers/start-content-render'
import { assText, assTime, buildAss } from './ass'
import { renderArgs } from './ffmpeg'
import { parseProposal } from './planner'
import { parseWhisper } from './whisper'

describe('subtitle file', () => {
  it('ASS time', () => {
    expect(assTime(0)).toBe('0:00:00.00')
    expect(assTime(61.237)).toBe('0:01:01.24')
    expect(assTime(3600)).toBe('1:00:00.00')
  })
  it('text cannot inject ASS overrides', () => expect(assText('a{\\b1}b\nc')).toBe('a／b1b\\Nc'))
  it('hook for the first 3 seconds; subtitles only when on', () => {
    const lines = [{ id: '0:0', start: 4, end: 6, text: 'Merhaba', unsure: false }]
    const on = buildAss({ hook: 'İlk dersinde', subtitles: true, lines, seconds: 20 })
    expect(on).toContain('Dialogue: 1,0:00:00.00,0:00:03.00,Hook,,0,0,0,,İlk dersinde')
    expect(on).toContain('Dialogue: 0,0:00:04.00,0:00:06.00,Sub,,0,0,0,,Merhaba')
    const off = buildAss({ hook: '', subtitles: false, lines, seconds: 20 })
    expect(off).not.toContain('Dialogue')
  })
  it('a 2-second video shows the hook for 2 seconds', () => expect(buildAss({ hook: 'x', subtitles: false, lines: [], seconds: 2 })).toContain('0:00:02.00,Hook'))
})

describe('whisper output', () => {
  const raw = JSON.stringify({
    transcription: [
      { offsets: { from: 0, to: 2400 }, text: ' Merhaba,  hoş geldin.' },
      { offsets: { from: 2400, to: 4000 }, text: ' [Müzik]' },
      { offsets: { from: 4000, to: 6000 }, text: ' Altyazı M.K.' },
      { offsets: { from: 6000, to: 6000 }, text: ' boş' },
      { offsets: { from: 7000, to: 9500 }, text: ' Nefesi bırak.' },
    ],
  })
  it('keeps speech, drops silence hallucinations; indexes are consecutive', () =>
    expect(parseWhisper(raw, 2)).toEqual([
      { slot: 2, index: 0, start: 0, end: 2.4, text: 'Merhaba, hoş geldin.' },
      { slot: 2, index: 1, start: 7, end: 9.5, text: 'Nefesi bırak.' },
    ]))
  it('garbage → no lines', () => expect(parseWhisper('{', 0)).toEqual([]))
})

describe('ffmpeg command', () => {
  const seg = [
    { path: '/t/c0.mp4', from: 1, to: 5, hasAudio: true },
    { path: '/t/c1.mov', from: 0, to: 3.5, hasAudio: false },
  ]
  const base = { segments: seg, seconds: 7.5, assPath: '/t/subs.ass', fontsDir: '/f', out: '/t/out.mp4' }
  const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1] ?? ''
  it('one input per segment, cut by -ss/-t; silent clip gets silence', () => {
    const a = renderArgs({ ...base, musicPath: null, speech: true })
    expect(a.join(' ')).toContain('-ss 1.00 -t 4.00 -i /t/c0.mp4 -ss 0.00 -t 3.50 -i /t/c1.mov')
    expect(graph(a)).toContain('anullsrc=r=48000:cl=stereo,atrim=0:3.50[a1]')
    expect(graph(a)).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]')
    expect(graph(a)).toContain("subtitles='/t/subs.ass'")
    expect(a.slice(-3)).toEqual(['-t', '7.50', '/t/out.mp4'])
  })
  it('music is ducked under speech', () => {
    const g = graph(renderArgs({ ...base, musicPath: '/t/m.mp3', speech: true }))
    expect(g).toContain('[2:a]atrim=0:7.50')
    expect(g).toContain('sidechaincompress')
  })
  it('music without speech: the room sound is turned down', () => {
    const g = graph(renderArgs({ ...base, musicPath: '/t/m.mp3', speech: false }))
    expect(g).not.toContain('sidechaincompress')
    expect(g).toContain('[ac]volume=0.25[room]')
  })
  it('no subtitles file → no subtitles filter', () => expect(graph(renderArgs({ ...base, assPath: null, musicPath: null, speech: false }))).toContain('[vc]null[vout]'))
})

describe('AI answer', () => {
  it('unreadable → null (the run fails at "plan", nothing is rendered)', () => {
    expect(parseProposal('nope')).toBeNull()
    expect(parseProposal('{"hook":"x"}')).toBeNull()
  })
  it('reads a proposal', () =>
    expect(parseProposal(JSON.stringify({ segments: [{ slot: 0, from: 1, to: 4 }], hook: 'x', coverAt: 2, musicTrackId: null, subtitles: true, lineFixes: [], notes: [{ level: 'bad', text: 'y' }], caption: 'c', hashtags: ['a'] }))).toMatchObject({
      segments: [{ slot: 0, from: 1, to: 4 }],
      notes: [{ level: 'ok', text: 'y' }],
    }))
})

it('the job request names the post (env overrides)', () =>
  expect(renderJobRequest('p1', 'retro', 'cnt_X')).toEqual({
    url: 'https://run.googleapis.com/v2/projects/p1/locations/europe-west1/jobs/content-render:run',
    body: { overrides: { containerOverrides: [{ env: [{ name: 'STUDIO_ID', value: 'retro' }, { name: 'POST_ID', value: 'cnt_X' }] }] } },
  }))
