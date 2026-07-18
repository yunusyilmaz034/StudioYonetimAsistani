import Link from 'next/link'
import {
  BanIcon,
  CalendarIcon,
  CoinsIcon,
  CreditCardIcon,
  DoorOpenIcon,
  HourglassIcon,
  LayersIcon,
  PackageIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

import { formatDateTime } from '@/lib/datetime'
import {
  defineWidget,
  pct,
  tl,
  type AnyWidget,
  type DashboardSnapshot,
  type ExportableTable,
  type Presentation,
  type Widget,
} from './contract'

// The registry. The dashboard renders this list; it knows nothing about what a widget contains.
// Adding a widget is adding an entry — and the AI Studio Manager (v1.30) will read the same list.

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' })
const timeLabel = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

// ── the visual atoms every widget renders with ──────────────────────────────────────────────

export function MetricFace({
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  value: string
  hint?: string
  icon: LucideIcon
  tone?: Presentation['tone']
}) {
  const toneClass: Record<string, string> = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
  }
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        {/* Editorial serif gauge numeral (Doc 33) — the dashboard's headline numbers. */}
        <p className={`font-heading text-display font-medium tabular-nums ${toneClass[tone]}`}>{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Icon className="size-4 shrink-0 text-muted-foreground/70" />
    </div>
  )
}

function MemberLines({
  rows,
  right,
  empty,
}: {
  rows: readonly { id: string; name: string }[]
  right: (row: never) => string
  empty: string
}) {
  if (rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-0.5">
      {rows.slice(0, 6).map((r) => (
        <li key={`${r.id}-${right(r as never)}`}>
          <Link
            href={`/members/${r.id}`}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-primary-soft/50"
          >
            <span className="truncate font-medium text-foreground">{r.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{right(r as never)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ── the widgets ─────────────────────────────────────────────────────────────────────────────

const todayBookings: Widget<{ bookings: number; cancellations: number; moves: number }> = {
  id: 'today.bookings',
  title: 'Bugünkü rezervasyon',
  kind: 'metric',
  href: () => '/activity?kinds=reservation&range=today',
  select: (s) => ({
    bookings: s.today.bookings,
    cancellations: s.today.cancellations,
    moves: s.today.moves,
  }),
  present: (d) => ({
    headline: `Bugün ${d.bookings} rezervasyon yapıldı, ${d.cancellations} iptal edildi.`,
    detail: d.moves > 0 ? `${d.moves} rezervasyon başka seansa taşındı.` : undefined,
    tone: 'default',
    // A cancellation rate above a third of the day's bookings is not a number, it is a question.
    needsAttention: d.bookings > 0 && d.cancellations / d.bookings > 0.33,
  }),
  render: (d) => (
    <MetricFace
      value={String(d.bookings)}
      hint={`${d.cancellations} iptal · ${d.moves} taşıma`}
      icon={CalendarIcon}
    />
  ),
}

const todayCancellations: Widget<{ cancellations: number; bookings: number }> = {
  id: 'today.cancellations',
  title: 'Bugünkü iptal',
  kind: 'metric',
  href: () => '/activity?kinds=reservation&range=today',
  select: (s) => ({ cancellations: s.today.cancellations, bookings: s.today.bookings }),
  present: (d) => ({
    headline: `Bugün ${d.cancellations} iptal.`,
    detail: d.bookings > 0 ? `Rezervasyonların %${pct(d.cancellations, d.bookings)}’i.` : undefined,
    tone: d.cancellations > 0 ? 'warning' : 'default',
    needsAttention: d.bookings > 0 && d.cancellations / d.bookings > 0.33,
  }),
  render: (d) => (
    <MetricFace
      value={String(d.cancellations)}
      hint={d.bookings > 0 ? `rezervasyonların %${pct(d.cancellations, d.bookings)}’i` : 'bugün rezervasyon yok'}
      icon={BanIcon}
      tone={d.cancellations > 0 ? 'warning' : 'default'}
    />
  ),
}

const todayCheckIns: Widget<{ checkIns: number }> = {
  id: 'today.checkins',
  title: 'Bugünkü check-in',
  kind: 'metric',
  href: () => '/checkin',
  select: (s) => ({ checkIns: s.today.checkIns }),
  present: (d) => ({
    headline: `Bugün ${d.checkIns} üye stüdyoya geldi.`,
    tone: 'default',
    needsAttention: false,
  }),
  render: (d) => <MetricFace value={String(d.checkIns)} hint="üye giriş yaptı" icon={DoorOpenIcon} />,
}

// Owner D-1 — three separate numbers, because they answer three different questions: what did we
// sell, what did we collect, and what are we owed.
const todaySales: Widget<{ salesKurus: number }> = {
  id: 'today.sales',
  title: 'Bugünkü satış',
  kind: 'metric',
  href: () => '/activity?kinds=membership&range=today',
  select: (s) => ({ salesKurus: s.today.salesKurus }),
  present: (d) => ({
    headline: `Bugün ${tl(d.salesKurus)} satış yapıldı.`,
    detail: 'Tahsil edilmemiş olsa da satış sayılır.',
    tone: 'success',
    needsAttention: false,
  }),
  render: (d) => <MetricFace value={tl(d.salesKurus)} hint="anlaşılan tutar" icon={PackageIcon} tone="success" />,
}

const todayCollected: Widget<{ collectedKurus: number }> = {
  id: 'today.collected',
  title: 'Bugünkü tahsilat',
  kind: 'metric',
  href: () => '/activity?kinds=payment&range=today',
  select: (s) => ({ collectedKurus: s.today.collectedKurus }),
  present: (d) => ({
    headline: `Bugün ${tl(d.collectedKurus)} tahsil edildi.`,
    tone: 'success',
    needsAttention: false,
  }),
  render: (d) => (
    <MetricFace value={tl(d.collectedKurus)} hint="kasaya giren" icon={CreditCardIcon} tone="success" />
  ),
}

const openBalance: Widget<{ balanceKurus: number }> = {
  id: 'today.balance',
  title: 'Açık bakiye',
  kind: 'metric',
  href: () => '/activity?kinds=payment&range=today',
  select: (s) => ({ balanceKurus: s.balanceDueKurus }),
  present: (d) => ({
    headline:
      d.balanceKurus > 0
        ? `Bugünkü satışların ${tl(d.balanceKurus)}’si henüz tahsil edilmedi.`
        : 'Bugünkü satışların tamamı tahsil edildi.',
    tone: d.balanceKurus > 0 ? 'warning' : 'success',
    needsAttention: d.balanceKurus > 0,
  }),
  render: (d) => (
    <MetricFace
      value={tl(d.balanceKurus)}
      hint="satış − tahsilat"
      icon={CoinsIcon}
      tone={d.balanceKurus > 0 ? 'warning' : 'default'}
    />
  ),
}

// Owner D-2 — an active record with no valid package is a contact, not a customer.
const activeMembers: Widget<{ active: number; new30d: number }> = {
  id: 'members.active',
  title: 'Aktif üye',
  kind: 'metric',
  href: () => '/members',
  select: (s) => ({ active: s.activeMembers, new30d: s.newMembers30d }),
  present: (d) => ({
    headline: `${d.active} aktif üye (geçerli paketi olan).`,
    detail: `Son 30 günde ${d.new30d} yeni üye katıldı.`,
    tone: 'default',
    needsAttention: false,
  }),
  render: (d) => (
    <MetricFace value={String(d.active)} hint={`son 30 günde +${d.new30d} yeni üye`} icon={UsersIcon} />
  ),
}

// Owner D-3 — summed booked / summed capacity. Never the average of per-session percentages.
const occupancy: Widget<DashboardSnapshot['occupancyByCategory'] & { total: { booked: number; capacity: number } }> = {
  id: 'today.occupancy',
  title: 'Günlük doluluk',
  kind: 'metric',
  href: () => '/schedule',
  select: (s) => ({ ...s.occupancyByCategory, total: s.occupancy }),
  present: (d) => ({
    headline:
      d.total.capacity === 0
        ? 'Bugün planlı seans yok.'
        : `Bugünkü doluluk %${pct(d.total.booked, d.total.capacity)} — ${d.total.capacity} yerin ${d.total.booked}’i dolu.`,
    tone: pct(d.total.booked, d.total.capacity) < 50 ? 'warning' : 'success',
    needsAttention: d.total.capacity > 0 && pct(d.total.booked, d.total.capacity) < 50,
  }),
  render: (d) => {
    const CATEGORY_TR: Record<string, string> = {
      pilates_group: 'Grup',
      fitness: 'Fitness',
      private: 'PT',
    }
    const rows = Object.entries(d).filter(([k]) => k !== 'total') as [string, { booked: number; capacity: number }][]
    return (
      <div className="space-y-2">
        <MetricFace
          value={`%${pct(d.total.booked, d.total.capacity)}`}
          hint={`${d.total.booked}/${d.total.capacity} yer`}
          icon={UsersIcon}
          tone={pct(d.total.booked, d.total.capacity) < 50 ? 'warning' : 'success'}
        />
        <div className="space-y-1">
          {rows.map(([cat, occ]) => (
            <div key={cat} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-muted-foreground">{CATEGORY_TR[cat] ?? cat}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${pct(occ.booked, occ.capacity)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {occ.booked}/{occ.capacity}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  },
}

const expiring: Widget<DashboardSnapshot['expiringSoon']> = {
  id: 'members.expiring',
  title: 'Süresi bitecek üyelikler',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'suresi-bitecek-uyelikler',
    columns: ['Üye', 'Paket', 'Bitiş', 'Kalan gün'],
    rows: s.expiringSoon.map((r) => [r.name, r.productName, dayLabel(r.validUntil), r.daysLeft]),
  }),
  href: () => '/insights/members.expiring',
  select: (s) => s.expiringSoon,
  present: (rows) => ({
    headline:
      rows.length === 0
        ? 'Önümüzdeki 14 günde biten üyelik yok.'
        : `${rows.length} üyeliğin süresi 14 gün içinde doluyor.`,
    detail: rows[0] ? `En yakın: ${rows[0].name} — ${rows[0].daysLeft} gün.` : undefined,
    tone: rows.length > 0 ? 'warning' : 'default',
    needsAttention: rows.length > 0,
  }),
  render: (rows) => (
    <MemberLines rows={rows} right={(r: DashboardSnapshot['expiringSoon'][number]) => `${r.daysLeft} gün`} empty="Yaklaşan bitiş yok." />
  ),
}

// Owner D-4 — credit-based packages only, remaining > 0. Zero gets its own list.
const lowCredit: Widget<{ rows: DashboardSnapshot['lowCredit']; threshold: number }> = {
  id: 'members.low_credit',
  title: 'Kredisi azalan üyeler',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'kredisi-azalan-uyeler',
    columns: ['Üye', 'Paket', 'Kalan kredi', 'Geçerlilik'],
    rows: s.lowCredit.map((r) => [r.name, r.productName, r.remaining, dayLabel(r.validUntil)]),
  }),
  href: () => '/insights/members.low_credit',
  select: (s) => ({ rows: s.lowCredit, threshold: s.lowCreditThreshold }),
  present: (d) => ({
    headline:
      d.rows.length === 0
        ? `Ders hakkı ${d.threshold} ve altına düşen üye yok.`
        : `${d.rows.length} üyenin ders hakkı azaldı (${d.threshold} veya daha az kaldı).`,
    tone: d.rows.length > 0 ? 'warning' : 'default',
    needsAttention: d.rows.length > 0,
  }),
  render: (d) => (
    <MemberLines
      rows={d.rows}
      right={(r: DashboardSnapshot['lowCredit'][number]) => `${r.remaining} kredi`}
      empty="Kredisi azalan üye yok."
    />
  ),
}

const exhausted: Widget<DashboardSnapshot['exhausted']> = {
  id: 'members.exhausted',
  title: 'Kredisi bitenler',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'kredisi-bitenler',
    columns: ['Üye', 'Paket', 'Geçerlilik'],
    rows: s.exhausted.map((r) => [r.name, r.productName, dayLabel(r.validUntil)]),
  }),
  href: () => '/insights/members.exhausted',
  select: (s) => s.exhausted,
  present: (rows) => ({
    headline:
      rows.length === 0 ? 'Kredisi biten üye yok.' : `${rows.length} üyenin kredisi bitti — paketi yenilenmeli.`,
    tone: rows.length > 0 ? 'danger' : 'default',
    needsAttention: rows.length > 0,
  }),
  render: (rows) => (
    <MemberLines rows={rows} right={() => 'kredi bitti'} empty="Kredisi biten üye yok." />
  ),
}

const waitlist: Widget<DashboardSnapshot['waiting']> = {
  id: 'waitlist',
  title: 'Bekleme listesi',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'bekleme-listesi',
    columns: ['Üye', 'Sıraya giriş'],
    rows: s.waiting.map((r) => [r.name, formatDateTime(r.joinedAt)]),
  }),
  href: () => '/insights/waitlist',
  select: (s) => s.waiting,
  present: (rows) => ({
    headline:
      rows.length === 0
        ? 'Bekleyen üye yok.'
        : `${rows.length} üye bekleme listesinde — yer açıldığında rezervasyonu siz oluşturursunuz.`,
    tone: rows.length > 0 ? 'info' : 'default',
    needsAttention: rows.length > 0,
  }),
  render: (rows) => (
    <MemberLines
      rows={rows}
      right={(r: DashboardSnapshot['waiting'][number]) => formatDateTime(r.joinedAt).slice(11, 16)}
      empty="Bekleyen üye yok."
    />
  ),
}

// Owner D-5 — the alarm is the next 24 hours. An empty class next Tuesday is not yet news.
const emptySessions: Widget<DashboardSnapshot['emptySessions']> = {
  id: 'sessions.empty_24h',
  title: 'Önümüzdeki 24 saatte boş kalan dersler',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'bos-dersler',
    columns: ['Ders', 'Eğitmen', 'Başlangıç', 'Kontenjan'],
    rows: s.emptySessions.map((r) => [
      r.serviceName,
      r.trainerName ?? '—',
      formatDateTime(r.startsAt),
      r.capacity,
    ]),
  }),
  href: () => '/insights/sessions.empty_24h',
  select: (s) => s.emptySessions.filter((e) => e.hoursAway <= 24),
  present: (rows) => ({
    headline:
      rows.length === 0
        ? 'Önümüzdeki 24 saatte boş ders yok.'
        : `${rows.length} ders önümüzdeki 24 saatte boş görünüyor — hâlâ doldurulabilir.`,
    detail: rows[0] ? `En yakın: ${rows[0].serviceName}, ${timeLabel(rows[0].startsAt)}.` : undefined,
    tone: rows.length > 0 ? 'warning' : 'success',
    needsAttention: rows.length > 0,
  }),
  render: (rows) =>
    rows.length === 0 ? (
      <p className="py-2 text-sm text-muted-foreground">Önümüzdeki 24 saatte boş ders yok.</p>
    ) : (
      <ul className="space-y-0.5">
        {rows.slice(0, 6).map((r) => (
          <li key={r.sessionId} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.serviceName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeLabel(r.startsAt)}</span>
          </li>
        ))}
      </ul>
    ),
}

const upcomingOperations: Widget<DashboardSnapshot['upcomingOperations']> = {
  id: 'operations.upcoming',
  title: 'Yaklaşan tatil / kapanışlar',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'yaklasan-operasyonlar',
    columns: ['Başlık', 'Başlangıç', 'Bitiş', 'Tür'],
    rows: s.upcomingOperations.map((r) => [
      r.title,
      r.dateFrom,
      r.dateTo,
      r.kind === 'closure' ? 'Kapanış' : 'Takvim',
    ]),
  }),
  href: () => '/insights/operations.upcoming',
  select: (s) => s.upcomingOperations,
  present: (rows) => ({
    headline:
      rows.length === 0
        ? 'Önümüzdeki 30 günde işaretli tatil veya kapanış yok.'
        : `${rows.length} özel gün / kapanış yaklaşıyor.`,
    detail: rows[0] ? `${rows[0].title} — ${rows[0].dateFrom}` : undefined,
    tone: 'info',
    needsAttention: rows.some((r) => r.kind === 'closure' && r.status === 'planned'),
  }),
  render: (rows) =>
    rows.length === 0 ? (
      <p className="py-2 text-sm text-muted-foreground">Yaklaşan özel gün yok.</p>
    ) : (
      <ul className="space-y-0.5">
        {rows.slice(0, 6).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {r.dateFrom === r.dateTo ? r.dateFrom : `${r.dateFrom} – ${r.dateTo}`}
              {r.kind === 'closure' && r.status === 'planned' ? ' · planlandı' : ''}
            </span>
          </li>
        ))}
      </ul>
    ),
}

// v1.24 — money the studio is owed. Selling without collecting is legal here; it must never be
// invisible.
const pendingPayments: Widget<DashboardSnapshot['pendingPayments']> = {
  id: 'finance.pending',
  title: 'Bekleyen ödemeler',
  kind: 'list',
  href: () => '/insights/finance.pending',
  table: (s): ExportableTable => ({
    name: 'bekleyen-odemeler',
    columns: ['Üye', 'Satış tarihi', 'Toplam (₺)', 'Kalan (₺)', 'Gün'],
    rows: s.pendingPayments.map((r) => [
      r.name,
      formatDateTime(r.soldAt),
      r.totalKurus / 100,
      r.dueKurus / 100,
      r.daysOpen,
    ]),
  }),
  select: (s) => s.pendingPayments,
  present: (rows) => {
    const total = rows.reduce((n, r) => n + r.dueKurus, 0)
    return {
      headline:
        rows.length === 0
          ? 'Bekleyen ödeme yok.'
          : `${rows.length} satışta toplam ${tl(total)} tahsil edilmedi.`,
      detail: rows[0] ? `En eski: ${rows[0].name} — ${rows[0].daysOpen} gündür açık.` : undefined,
      tone: rows.length > 0 ? 'warning' : 'success',
      needsAttention: rows.length > 0,
    }
  },
  render: (rows) => (
    <MemberLines
      rows={rows}
      right={(r: DashboardSnapshot['pendingPayments'][number]) => tl(r.dueKurus)}
      empty="Bekleyen ödeme yok."
    />
  ),
}

// PF-37 — a shareable-link payment arrived but is not yet attributed to a member. Reception opens it,
// finds who paid (name/phone), and adds her package — the money enters the ledger, attributed.
const unreconciledPaytr: Widget<DashboardSnapshot['unreconciledCollections']> = {
  id: 'finance.unreconciled_paytr',
  title: 'Eşleştirilecek PAYTR ödemeleri',
  kind: 'list',
  href: () => '/finance/collections',
  table: (s): ExportableTable => ({
    name: 'eslestirilecek-paytr-odemeleri',
    columns: ['Ödeyen', 'Tutar (₺)', 'Tarih'],
    rows: s.unreconciledCollections.map((r) => [r.buyerName, r.amountKurus / 100, formatDateTime(r.paidAt)]),
  }),
  select: (s) => s.unreconciledCollections,
  present: (rows) => {
    const total = rows.reduce((n, r) => n + r.amountKurus, 0)
    return {
      headline:
        rows.length === 0
          ? 'Eşleştirilecek PAYTR ödemesi yok.'
          : `${rows.length} PAYTR ödemesi (${tl(total)}) üyeye eşleştirilmeyi bekliyor.`,
      detail: rows[0] ? `${rows[0].buyerName} — ${tl(rows[0].amountKurus)}.` : undefined,
      tone: rows.length > 0 ? 'warning' : 'success',
      needsAttention: rows.length > 0,
    }
  },
  render: (rows) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">Bekleyen ödeme yok.</p>
    ) : (
      <ul className="space-y-1">
        {rows.slice(0, 6).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{r.buyerName}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{tl(r.amountKurus)}</span>
          </li>
        ))}
      </ul>
    ),
}

// A kasa left open overnight is how a cash difference becomes untraceable.
const openDrawers: Widget<DashboardSnapshot['openDrawers']> = {
  id: 'finance.drawers',
  title: 'Açık kasalar',
  kind: 'list',
  href: () => '/finance',
  select: (s) => s.openDrawers,
  present: (rows) => ({
    headline:
      rows.length === 0
        ? 'Açık kasa yok — gün sonu yapılmış.'
        : `${rows.length} kasa açık, beklenen ${tl(rows.reduce((n, r) => n + r.expectedKurus, 0))}.`,
    tone: rows.length > 0 ? 'info' : 'success',
    needsAttention: false,
  }),
  render: (rows) =>
    rows.length === 0 ? (
      <p className="py-2 text-sm text-muted-foreground">Açık kasa yok.</p>
    ) : (
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="truncate font-medium text-foreground">{r.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{tl(r.expectedKurus)}</span>
          </li>
        ))}
      </ul>
    ),
}

const recentMembers: Widget<DashboardSnapshot['recentMembers']> = {
  id: 'members.recent',
  title: 'Son eklenen üyeler',
  kind: 'list',
  table: (s): ExportableTable => ({
    name: 'son-eklenen-uyeler',
    columns: ['Üye', 'Katılım'],
    rows: s.recentMembers.map((r) => [r.name, formatDateTime(r.joinedAt)]),
  }),
  href: () => '/members',
  select: (s) => s.recentMembers,
  present: (rows) => ({
    headline: rows.length === 0 ? 'Yeni üye yok.' : `Son eklenen üye: ${rows[0]?.name}.`,
    tone: 'default',
    needsAttention: false,
  }),
  render: (rows) => (
    <MemberLines
      rows={rows}
      right={(r: DashboardSnapshot['recentMembers'][number]) => dayLabel(r.joinedAt)}
      empty="Yeni üye yok."
    />
  ),
}

// The order IS the dashboard: money and today's operation first, then what needs a phone call, then
// the quiet facts. Reading top-to-bottom should answer "bugün ne oldu, neye bakmam lazım?"
export const WIDGETS: readonly AnyWidget[] = [
  todayBookings,
  todayCancellations,
  todayCheckIns,
  occupancy,
  todaySales,
  todayCollected,
  openBalance,
  activeMembers,
  emptySessions,
  pendingPayments,
  unreconciledPaytr,
  openDrawers,
  lowCredit,
  exhausted,
  expiring,
  waitlist,
  upcomingOperations,
  recentMembers,
].map((w) => defineWidget(w as unknown as Widget<unknown>))

export const WIDGET_ICON: Record<string, LucideIcon> = {
  'today.bookings': CalendarIcon,
  'today.cancellations': BanIcon,
  'today.checkins': DoorOpenIcon,
  'today.occupancy': UsersIcon,
  'today.sales': PackageIcon,
  'today.collected': CreditCardIcon,
  'today.balance': CoinsIcon,
  'members.active': UsersIcon,
  'sessions.empty_24h': CalendarIcon,
  'members.low_credit': CoinsIcon,
  'members.exhausted': CoinsIcon,
  'members.expiring': HourglassIcon,
  waitlist: HourglassIcon,
  'operations.upcoming': LayersIcon,
  'members.recent': UserPlusIcon,
  'finance.pending': CoinsIcon,
  'finance.unreconciled_paytr': CreditCardIcon,
  'finance.drawers': CreditCardIcon,
}
