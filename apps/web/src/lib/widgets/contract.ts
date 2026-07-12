import type { ReactNode } from 'react'

import type { OwnerDashboard } from '@/server/owner-dashboard'

// ── THE WIDGET CONTRACT (v1.23, owner: "AI hazırlığı"). ─────────────────────────────────────
//
// A widget is not a component with a number in it. It is a **contract with three faces**, and the
// component is only one of them:
//
//   select()   — the data, taken from the ONE dashboard snapshot (no widget fetches; twelve
//                widgets fetching would be the very N+1 the owner ruled out).
//   present()  — the MEANING, as a Turkish sentence a person could say out loud.
//   render()   — the pixels.
//
// `present()` is the seam that matters, and it is why this milestone builds a contract instead of
// twelve components. When the AI Studio Manager arrives (v1.30) it will not screen-scrape a chart:
// it will read the same `present()`. A widget that can only draw itself is a widget the AI cannot
// use — and by then it would be twelve rewrites, not one.
//
// A widget NEVER writes. The dashboard observes; the screen it links to decides.

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info'

export interface Presentation {
  readonly headline: string // "Bugün 14 rezervasyon, 3 iptal." — a sentence, not a label
  readonly detail?: string | undefined
  readonly tone: Tone
  // True when this is something the owner should ACT on today. The AI reads this first; the
  // dashboard uses it to decide what is loud (Doc 20: normal is quiet, abnormal is loud).
  readonly needsAttention: boolean
}

export type DashboardSnapshot = OwnerDashboard

export interface Widget<TData = unknown> {
  readonly id: string // 'today.bookings'
  readonly title: string
  readonly kind: 'metric' | 'list' | 'chart'
  readonly select: (snapshot: DashboardSnapshot) => TData
  readonly present: (data: TData) => Presentation
  readonly render: (data: TData) => ReactNode
  // A dashboard number that cannot be acted on is a poster. Every widget names the screen where the
  // owner does something about it — a list widget opens its own full list (`/insights/{id}`), a
  // metric opens the operational screen behind it.
  readonly href: (snapshot: DashboardSnapshot) => string
  // Export (owner, v1.23): CSV ships now; Excel and PDF later. The screens are built against THIS
  // contract rather than a file format, so adding a format is a writer, not a rewrite of a screen.
  readonly table?: (snapshot: DashboardSnapshot) => ExportableTable
}

// The one shape every exportable view produces. A report is columns and rows — the format is a
// detail, and keeping it out of the screens is what makes Excel/PDF an afternoon later.
export interface ExportableTable {
  readonly name: string // the file's name, and the screen's title
  readonly columns: readonly string[]
  readonly rows: readonly (readonly (string | number)[])[]
}

// The registry holds widgets of DIFFERENT data types, so it stores them behind an existential:
// `defineWidget` closes `select()` over the snapshot and hands back a uniform face. The dashboard —
// and, later, the AI — sees one shape and never a generic parameter.
export interface AnyWidget {
  readonly id: string
  readonly title: string
  readonly kind: Widget['kind']
  readonly present: (snapshot: DashboardSnapshot) => Presentation
  readonly render: (snapshot: DashboardSnapshot) => ReactNode
  readonly href: (snapshot: DashboardSnapshot) => string
  readonly table: ((snapshot: DashboardSnapshot) => ExportableTable) | null
}

export function defineWidget<T>(w: Widget<T>): AnyWidget {
  return {
    id: w.id,
    title: w.title,
    kind: w.kind,
    present: (s) => w.present(w.select(s)),
    render: (s) => w.render(w.select(s)),
    href: w.href,
    table: w.table ?? null,
  }
}

export const tl = (kurus: number): string =>
  `${(kurus / 100).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺`

export const pct = (booked: number, capacity: number): number =>
  capacity > 0 ? Math.round((booked / capacity) * 100) : 0
