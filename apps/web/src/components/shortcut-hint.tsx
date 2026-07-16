'use client'

import { useEffect, useState } from 'react'

// Renders a keyboard shortcut's DISPLAY for the current platform — "⌘K" on macOS, "Ctrl+K" elsewhere
// (Windows/Linux). The handlers already accept both metaKey and ctrlKey; this only stops the hint from
// being Mac-specific. SSR renders the Mac form and the effect corrects it on a non-Mac client (post-
// hydration, so no mismatch), a brief and harmless flip.
export function ShortcutHint({ letter }: { letter: string }) {
  const [mac, setMac] = useState(true)
  useEffect(() => {
    const p = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : ''
    setMac(/Mac|iPhone|iPad|iPod/i.test(p))
  }, [])
  return <>{mac ? `⌘${letter}` : `Ctrl+${letter}`}</>
}
