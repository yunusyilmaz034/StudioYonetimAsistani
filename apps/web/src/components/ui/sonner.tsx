'use client'

import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useEffect, useState } from 'react'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

// The toaster follows the app theme (PF-18): it reads `data-theme` off <html> and re-syncs on change,
// so toasts are light in the light theme and dark in the dark one — no next-themes dependency.
const Toaster = ({ ...props }: ToasterProps) => {
  // Follow the app's theme (PF-18): read data-theme and keep in sync so toasts match light/dark.
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return (
    <Sonner
      theme={theme}
      // top-center (owner, PF-16): reception was missing errors tucked in the bottom-right corner. The
      // top-center slot is noticed without covering the work area the way a dead-centre toast would.
      position="top-center"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
