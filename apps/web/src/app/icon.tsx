import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// Generated at build time (no binary asset committed) — a mahogany brand tile with the "S" wordmark.
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#7A1F3D,#3A0E22)', color: '#FFFFFF', fontSize: 320, fontWeight: 700 }}>
        S
      </div>
    ),
    size,
  )
}
