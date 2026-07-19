import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#7A1F3D,#3A0E22)', color: '#FFFFFF', fontSize: 116, fontWeight: 700 }}>
        S
      </div>
    ),
    size,
  )
}
