import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { sniffCardioPhotoMedia } from './cardio-photo'

// The first real photo (2026-10-13) was a PNG labelled `image/jpeg` by the app, and the model refused
// it with a bare 400. The bytes decide; the label is not consulted.
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64') + 'AAAAAAAAAAAAAAAA'

describe('what an uploaded picture actually is', () => {
  it('knows a JPEG, a PNG, a GIF and a WebP by their first bytes', () => {
    expect(sniffCardioPhotoMedia(b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg')
    expect(sniffCardioPhotoMedia(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(sniffCardioPhotoMedia(b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
    expect(sniffCardioPhotoMedia(b64([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
  })

  it('does not mistake another RIFF file (a WAV) for a picture', () => {
    expect(sniffCardioPhotoMedia(b64([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull()
  })

  it('refuses a format the model does not take, rather than guessing — HEIC', () => {
    // ....ftypheic
    expect(sniffCardioPhotoMedia(b64([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull()
    expect(sniffCardioPhotoMedia('')).toBeNull()
  })
})
