'use client'

import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

// Light/dark toggle (PF-18). The head script already set data-theme from the OS preference; this lets the
// user override it and remembers the choice. We read/write the DOM attribute directly (single source of
// truth) so the switch is instant and cannot disagree with what is painted.
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark')
  }, [])

  function toggle() {
    const next = document.documentElement.dataset.theme !== 'dark'
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Private mode / storage blocked — the switch still applies for this session.
    }
    setDark(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={dark ? 'Açık temaya geç' : 'Koyu temaya geç'}
      onClick={toggle}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
