'use client'

import { useState } from 'react'

import { CommentsPanel } from './comments-panel'
import { ContentScreen } from './content-screen'

// IG-3 — "Plan" and "Yorumlar" on one screen (Single Workspace, DS-8). The dashboard opens ?tab=comments.
export function ContentTabs({ initial }: { initial: 'plan' | 'comments' }) {
  const [tab, setTab] = useState(initial)
  const btn = (key: 'plan' | 'comments', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => {
        setTab(key)
        window.history.replaceState(null, '', key === 'comments' ? '/content?tab=comments' : '/content')
      }}
      className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
    >
      {label}
    </button>
  )
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
        <div role="tablist" aria-label="İçerik" className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
          {btn('plan', 'Plan')}
          {btn('comments', 'Yorumlar')}
        </div>
      </div>
      {tab === 'plan' ? <ContentScreen /> : <CommentsPanel />}
    </>
  )
}
