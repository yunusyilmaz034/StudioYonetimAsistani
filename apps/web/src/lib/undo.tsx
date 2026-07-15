'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

// Undo / Redo (Plus Phase 2 — Edit Experience). A PURE UX layer: it never rewrites the event log.
// "Undo" runs the INVERSE of the last edit — itself a new compensating action (a re-book, a move
// back, a reschedule to the old time), so the history only ever grows. Redo re-applies the forward
// action, again a new event.
//
// An edit that wants to be undoable calls `record({ label, undo, redo })` on success: `undo` and
// `redo` are async thunks that perform the inverse / forward compensating action and return whether
// it worked. `record` shows a toast with a one-tap "Geri Al", and ⌘Z / ⌘⇧Z reach the last one.

export interface UndoEntry {
  readonly label: string
  readonly undo: () => Promise<{ ok: boolean; error?: string }>
  readonly redo: () => Promise<{ ok: boolean; error?: string }>
}

interface UndoApi {
  record: (entry: UndoEntry) => void
}

const Ctx = createContext<UndoApi | null>(null)

export function useUndo(): UndoApi {
  return useContext(Ctx) ?? { record: () => {} }
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const undoStack = useRef<UndoEntry[]>([])
  const redoStack = useRef<UndoEntry[]>([])
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (kind: 'undo' | 'redo') => {
      if (busy) return
      const from = kind === 'undo' ? undoStack : redoStack
      const to = kind === 'undo' ? redoStack : undoStack
      const entry = from.current.pop()
      if (!entry) return
      setBusy(true)
      const r = await (kind === 'undo' ? entry.undo() : entry.redo())
      setBusy(false)
      if (r.ok) {
        to.current.push(entry)
        toast.success(kind === 'undo' ? `Geri alındı: ${entry.label}` : `Yinelendi: ${entry.label}`, {
          action: kind === 'undo' ? { label: 'Yinele', onClick: () => void run('redo') } : undefined,
        })
      } else {
        from.current.push(entry) // put it back; nothing changed
        toast.error(r.error ?? 'Geri alınamadı.')
      }
    },
    [busy],
  )

  const record = useCallback(
    (entry: UndoEntry) => {
      undoStack.current.push(entry)
      redoStack.current = [] // a fresh action invalidates the redo trail
      toast.success(entry.label, {
        action: { label: 'Geri Al', onClick: () => void run('undo') },
      })
    },
    [run],
  )

  // ⌘Z / Ctrl+Z undo · ⌘⇧Z / Ctrl+Shift+Z redo — standard, non-destructive, and ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        void run(e.shiftKey ? 'redo' : 'undo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  return <Ctx.Provider value={{ record }}>{children}</Ctx.Provider>
}
