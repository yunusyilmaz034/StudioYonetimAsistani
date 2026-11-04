import { ref, uploadBytesResumable } from 'firebase/storage'

import { clientStorage, storageConfigured } from '@/lib/firebase-client'

// IG-2b — the filmed file goes straight from the phone to the studio's PRIVATE Storage prefix
// (`studios/{sid}/content/{postId}/…`, rules-guarded). The Server Action then reads its size and type
// from Storage. Here, in the browser, we also:
//   · read the video's duration and size (the browser decodes it anyway),
//   · turn a photo into JPEG (Instagram accepts only JPEG) at most 1440 px wide,
//   · take a few small frames for the AI to look at — the video itself never goes to the AI.

export interface PreparedFile {
  readonly blob: Blob
  readonly contentType: string
  readonly kind: 'video' | 'image'
  readonly seconds: number | null
  readonly width: number
  readonly height: number
  readonly frames: string[] // base64 JPEG, no data: prefix
}

const VIDEO = ['video/mp4', 'video/quicktime']

function canvasJpeg(src: CanvasImageSource, w: number, h: number, maxW: number, quality: number): { canvas: HTMLCanvasElement; data: string } {
  const scale = Math.min(1, maxW / w)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
  return { canvas, data: canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '' }
}

async function prepareVideo(file: File): Promise<PreparedFile> {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res()
      v.onerror = () => rej(new Error('Video okunamadı'))
    })
    const seconds = v.duration
    const width = v.videoWidth
    const height = v.videoHeight
    const frames: string[] = []
    const at = [0.5, seconds / 3, (2 * seconds) / 3, Math.max(0.5, seconds - 0.5)]
    for (const t of at) {
      await new Promise<void>((res) => {
        v.onseeked = () => res()
        v.currentTime = Math.min(Math.max(0, t), Math.max(0, seconds - 0.05))
      })
      frames.push(canvasJpeg(v, width, height, 512, 0.7).data)
    }
    return { blob: file, contentType: file.type, kind: 'video', seconds, width, height, frames }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function prepareImage(file: File): Promise<PreparedFile> {
  const bmp = await createImageBitmap(file)
  const big = canvasJpeg(bmp, bmp.width, bmp.height, 1440, 0.9)
  const blob = await new Promise<Blob>((res, rej) => big.canvas.toBlob((b) => (b ? res(b) : rej(new Error('JPEG'))), 'image/jpeg', 0.9))
  const small = canvasJpeg(bmp, bmp.width, bmp.height, 512, 0.7)
  return { blob, contentType: 'image/jpeg', kind: 'image', seconds: null, width: big.canvas.width, height: big.canvas.height, frames: [small.data] }
}

export async function prepareContentFile(file: File): Promise<PreparedFile> {
  if (VIDEO.includes(file.type)) return prepareVideo(file)
  if (file.type.startsWith('image/')) return prepareImage(file)
  throw new Error('Desteklenmeyen dosya. Video (MP4/MOV) ya da fotoğraf seçin.')
}

export async function uploadContentFile(input: { studioId: string; postId: string; file: PreparedFile; onProgress: (pct: number) => void }): Promise<string> {
  if (!storageConfigured()) throw new Error('Dosya yükleme yapılandırılmamış.')
  const ext = input.file.contentType === 'video/quicktime' ? 'mov' : input.file.kind === 'video' ? 'mp4' : 'jpg'
  const path = `studios/${input.studioId}/content/${input.postId}/${crypto.randomUUID()}.${ext}`
  const task = uploadBytesResumable(ref(clientStorage(), path), input.file.blob, { contentType: input.file.contentType })
  await new Promise<void>((res, rej) => {
    task.on('state_changed', (s) => input.onProgress(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)), rej, () => res())
  })
  return path
}

// ── IG-2c: raw clips and music ───────────────────────────────────────────────────────────────────
export interface RawClipFile {
  readonly blob: Blob
  readonly contentType: string
  readonly seconds: number
  readonly width: number
  readonly height: number
}

/** A raw clip: only its duration and size are read here; frames are taken on the server. */
export async function prepareRawClip(file: File): Promise<RawClipFile> {
  if (!VIDEO.includes(file.type)) throw new Error('Desteklenmeyen dosya. Video (MP4/MOV) seçin.')
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.src = url
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res()
      v.onerror = () => rej(new Error('Video okunamadı'))
    })
    return { blob: file, contentType: file.type, seconds: v.duration, width: v.videoWidth, height: v.videoHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function put(path: string, blob: Blob, contentType: string, onProgress: (pct: number) => void): Promise<string> {
  if (!storageConfigured()) throw new Error('Dosya yükleme yapılandırılmamış.')
  const task = uploadBytesResumable(ref(clientStorage(), path), blob, { contentType })
  await new Promise<void>((res, rej) => {
    task.on('state_changed', (s) => onProgress(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)), rej, () => res())
  })
  return path
}

export function uploadRawClip(input: { studioId: string; postId: string; file: RawClipFile; onProgress: (pct: number) => void }): Promise<string> {
  const ext = input.file.contentType === 'video/quicktime' ? 'mov' : 'mp4'
  return put(`studios/${input.studioId}/content/${input.postId}/raw/${crypto.randomUUID()}.${ext}`, input.file.blob, input.file.contentType, input.onProgress)
}

/** Owner: an MP3 for the music library. Returns the path and the track's length in seconds. */
export async function uploadMusicTrack(input: { studioId: string; file: File; onProgress: (pct: number) => void }): Promise<{ storagePath: string; seconds: number }> {
  if (input.file.type !== 'audio/mpeg') throw new Error('Yalnız MP3 yüklenebilir.')
  const url = URL.createObjectURL(input.file)
  let seconds = 0
  try {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.src = url
    seconds = await new Promise<number>((res, rej) => {
      a.onloadedmetadata = () => res(a.duration)
      a.onerror = () => rej(new Error('Ses dosyası okunamadı'))
    })
  } finally {
    URL.revokeObjectURL(url)
  }
  const storagePath = await put(`studios/${input.studioId}/music/${crypto.randomUUID()}.mp3`, input.file, 'audio/mpeg', input.onProgress)
  return { storagePath, seconds: Math.round(seconds) }
}
