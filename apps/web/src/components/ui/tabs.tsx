'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

// A lightweight, controlled Tabs primitive for the workspace screens (Session Workspace,
// Member Workspace). Desktop tab bar; the same API drives mobile section switching. Token
// -driven, no hardcoded colours (DS-1).
const TabsCtx = createContext<{ value: string; setValue: (v: string) => void } | null>(null)

function useTabs() {
  const ctx = useContext(TabsCtx)
  if (!ctx) throw new Error('Tabs.* must be used within <Tabs>')
  return ctx
}

function Tabs({
  value: controlled,
  defaultValue = '',
  onValueChange,
  className,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (v: string) => void
  className?: string
  children: ReactNode
}) {
  const [internal, setInternal] = useState(defaultValue)
  const value = controlled ?? internal
  const setValue = (v: string) => {
    if (controlled === undefined) setInternal(v)
    onValueChange?.(v)
  }
  return (
    <TabsCtx.Provider value={{ value, setValue }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </TabsCtx.Provider>
  )
}

function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5', className)}
    >
      {children}
    </div>
  )
}

function TabsTrigger({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const ctx = useTabs()
  const on = ctx.value === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        on ? 'bg-surface text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

function TabsContent({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const ctx = useTabs()
  if (ctx.value !== value) return null
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
