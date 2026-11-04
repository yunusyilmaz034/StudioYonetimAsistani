'use client'

import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { uploadMusicTrack } from '@/lib/content-upload'
import { addMusicTrackAction, musicLibraryAction, musicPreviewUrlAction, setMusicTrackActiveAction, type MusicLibrary } from '@/server/actions/content-edit'

// IG-2c — the owner's royalty-free music library. The AI picks only from tracks that are ON.
const sec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function MusicLibraryPanel({ studioId }: { studioId: string }) {
  const [lib, setLib] = useState<MusicLibrary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mood, setMood] = useState('sakin')
  const audio = useRef<HTMLAudioElement | null>(null)

  const load = () => musicLibraryAction().then(setLib)
  useEffect(() => {
    void load()
    return () => audio.current?.pause()
  }, [])

  async function play(id: string) {
    if (playing === id) {
      audio.current?.pause()
      setPlaying(null)
      return
    }
    const url = await musicPreviewUrlAction({ id })
    if (!url) return void toast.error('Parça açılamadı.')
    audio.current?.pause()
    audio.current = new Audio(url)
    audio.current.onended = () => setPlaying(null)
    void audio.current.play()
    setPlaying(id)
  }

  async function upload(file: File | undefined) {
    if (!file) return
    if (!name.trim()) return void toast.error('Önce parçaya bir ad verin.')
    setBusy('upload')
    try {
      const up = await uploadMusicTrack({ studioId, file, onProgress: setPct })
      const r = await addMusicTrackAction({ storagePath: up.storagePath, name: name.trim(), mood, seconds: Math.max(1, up.seconds), source: 'stüdyo' })
      if (!r.ok) toast.error('Parça kaydedilemedi.')
      else {
        toast.success('Parça eklendi.')
        setName('')
      }
      await load()
    } catch (e) {
      toast.error((e as Error)?.message || 'Yüklenemedi.')
    }
    setPct(null)
    setBusy(null)
  }

  async function toggle(id: string, active: boolean) {
    setBusy(id)
    await setMusicTrackActiveAction({ id, active })
    await load()
    setBusy(null)
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-border bg-card p-3">
      <h3 className="text-sm font-bold">Müzik kütüphanesi</h3>
      <p className="text-xs text-muted-foreground">AI kurguda yalnız açık olan parçalardan seçer. Yalnız telifsiz, ticari kullanıma izinli parça ekleyin.</p>
      {lib === null ? <p className="text-xs text-muted-foreground">Yükleniyor…</p> : null}
      {lib && lib.tracks.length === 0 ? <p className="text-xs text-muted-foreground">Henüz parça yok. Parça yoksa kurgu müziksiz, kendi sesiyle çıkar.</p> : null}
      <ul className="divide-y divide-border">
        {(lib?.tracks ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2.5 py-2">
            <button type="button" aria-label={playing === t.id ? 'Durdur' : 'Dinle'} onClick={() => void play(t.id)} className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-background">
              {playing === t.id ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
            </button>
            <span className="min-w-0 flex-1 text-sm">
              {t.name}
              <span className="block text-[11px] text-muted-foreground">
                {t.mood} · {sec(t.seconds)} · {t.source}
              </span>
            </span>
            <label className="inline-flex min-h-9 items-center gap-1.5 text-xs">
              <input type="checkbox" checked={t.active} disabled={!lib?.canEdit || busy === t.id} onChange={(e) => void toggle(t.id, e.target.checked)} className="size-5 accent-primary" />
              {t.active ? 'Açık' : 'Kapalı'}
            </label>
          </li>
        ))}
      </ul>
      {lib?.canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="track-name">Parça adı</label>
          <input id="track-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Parça adı" maxLength={60} className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
          <label className="sr-only" htmlFor="track-mood">Tempo</label>
          <select id="track-mood" value={mood} onChange={(e) => setMood(e.target.value)} className="min-h-10 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="sakin">sakin</option>
            <option value="hareketli">hareketli</option>
          </select>
          <label className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium ${busy === 'upload' ? 'pointer-events-none opacity-50' : ''}`}>
            <UploadIcon className="size-4" /> {pct !== null ? `%${pct}` : 'MP3 yükle'}
            <input type="file" accept="audio/mpeg" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
        </div>
      ) : null}
    </div>
  )
}
