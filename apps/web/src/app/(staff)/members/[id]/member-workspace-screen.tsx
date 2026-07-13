'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeftIcon,
  CalendarPlusIcon,
  ClipboardListIcon,
  CreditCardIcon,
  DoorOpenIcon,
  HistoryIcon,
  Loader2Icon,
  PackageIcon,
  PencilIcon,
  UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import type { Member, MemberId } from '@studio/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { Section } from '@/components/ui/section'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Timeline } from '@/components/activity/timeline'
import { AccountPanel } from '../account-panel'
import { memberTimelineAction } from '@/server/actions/activity'
import { checkInCommand } from '@/lib/commands'
import { domainErrorMessage } from '@/lib/domain-error'
import type { ProductView } from '@/server/catalog-query'
import type {
  MemberCheckInRow,
  MemberReservationRow,
  MemberWorkspaceData,
} from '@/server/member-workspace-query'
import { deactivateMember } from '@/server/actions/members'

import { ErasurePanel } from './erasure-panel'
import {
  listUpcomingSessionsAction,
  type UpcomingSession,
} from '@/server/actions/booking'
import { bookReservationAction, cancelReservationAction } from '@/server/actions/reservations'

import { MemberForm } from '../member-form'
import { InvitePanel } from './invite-panel'
import { SubscriptionsPanel } from '../subscriptions'

// ── labels ────────────────────────────────────────────────────────────────────
const MEMBER_STATUS: Record<string, string> = { active: 'Aktif', inactive: 'Pasif', deleted: 'Silindi' }
const RES_STATUS: Record<string, string> = {
  booked: 'Rezerve',
  cancelled: 'İptal',
  late_cancelled: 'Geç İptal',
  attended: 'Katıldı',
  no_show: 'Gelmedi',
  waitlisted: 'Beklemede',
}

const dt = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`

type SectionId = 'profile' | 'packages' | 'reservations' | 'checkin' | 'payments' | 'audit'
const SECTIONS: readonly { id: SectionId; label: string; icon: typeof UserIcon }[] = [
  { id: 'profile', label: 'Genel', icon: UserIcon },
  { id: 'packages', label: 'Paketler', icon: PackageIcon },
  { id: 'reservations', label: 'Rezervasyonlar', icon: ClipboardListIcon },
  { id: 'checkin', label: 'Check-in', icon: DoorOpenIcon },
  { id: 'payments', label: 'Cari Hesap', icon: CreditCardIcon },
  { id: 'audit', label: 'Geçmiş', icon: HistoryIcon },
]

export function MemberWorkspaceScreen({
  data,
  products,
  defaultBranchId,
  isOwner = false,
  isPlatformAdmin,
}: {
  data: MemberWorkspaceData
  products: readonly ProductView[]
  defaultBranchId: string | null
  isOwner?: boolean
  isPlatformAdmin: boolean
}) {
  const router = useRouter()
  const { member } = data
  const [active, setActive] = useState<SectionId>('profile')
  const [editing, setEditing] = useState(false)
  const [booking, setBooking] = useState(false)

  const s = member.stats

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">

      {/* Header. The member's headline numbers were buried in the Genel tab; a balance the
          studio is owed must be visible the moment the member is opened (Owner First, UX-8). */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push('/members')}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Üyeler
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-display font-semibold text-foreground">
              {member.fullName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-sm text-muted-foreground">
              <span className="tabular-nums">{member.phone}</span>
              {member.status !== 'active' ? (
                <Badge className="bg-muted text-muted-foreground">{MEMBER_STATUS[member.status]}</Badge>
              ) : null}
              {data.insideNow ? <Badge className="bg-success/10 text-success">İçeride</Badge> : null}
            </div>
          </div>
          <QuickActions
            insideNow={data.insideNow}
            memberId={member.id}
            onBook={() => setBooking(true)}
            onEdit={() => setEditing(true)}
            onRefresh={() => router.refresh()}
          />
        </div>
      </div>

      {s ? (
        <MetricStrip>
          <Metric compact label="Aktif paket" value={s.activeEntitlementCount} icon={PackageIcon} />
          <Metric compact label="Bakiye" value={tl(s.balanceDue)} icon={CreditCardIcon} tone={s.balanceDue > 0 ? 'danger' : 'default'} />
          <Metric compact label="Son giriş" value={s.lastCheckInAt ? d(s.lastCheckInAt) : '—'} icon={DoorOpenIcon} />
          <Metric compact label="Son katılım" value={s.lastAttendanceAt ? d(s.lastAttendanceAt) : '—'} icon={ClipboardListIcon} />
        </MetricStrip>
      ) : null}

      {/* Section nav — the house Tabs (DS v2): desktop tabs, the same control as the mobile
          section switcher (UX-1). */}
      <Tabs value={active} onValueChange={(v) => setActive(v as SectionId)}>
        <TabsList className="flex w-full flex-wrap">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon
            return (
              <TabsTrigger key={sec.id} value={sec.id} className="min-h-9 flex-1">
                <Icon className="size-4" />
                <span className="hidden sm:inline">{sec.label}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="profile">
          <div className="space-y-5">
            <ProfilePanel member={member} isPlatformAdmin={isPlatformAdmin} />
            {/* v1.21 — the portal invite (D1). Reception issues the link; the member sets her
                own password. Reception never knows it. */}
            <InvitePanel memberId={member.id} studioId={member.studioId} />
          </div>
        </TabsContent>
        <TabsContent value="packages">
          <SubscriptionsPanel memberId={member.id} products={products} />
        </TabsContent>
        <TabsContent value="reservations">
          <ReservationsPanel upcoming={data.upcomingReservations} past={data.pastReservations} />
        </TabsContent>
        <TabsContent value="checkin">
          <CheckinPanel
            insideNow={data.insideNow}
            lastCheckInAt={data.lastCheckInAt}
            history={data.checkInHistory}
          />
        </TabsContent>
        <TabsContent value="payments">
          {/* v1.24 — the real cari hesap: sales, payments, allocations, refunds, plans. Every
              number is derived from the movements; nothing is a stored balance. */}
          <AccountPanel
            memberId={member.id}
            branchId={member.homeBranchId ?? defaultBranchId ?? ''}
            isOwner={isOwner}
          />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel memberId={member.id} />
        </TabsContent>
      </Tabs>

      {/* Edit sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4 sm:p-5">
          <SheetHeader className="p-0">
            <SheetTitle className="text-h1">Üyeyi Düzenle</SheetTitle>
            <SheetDescription>Zorunlu alanlar: ad soyad ve telefon.</SheetDescription>
          </SheetHeader>
          <MemberForm
            member={member}
            defaultBranchId={defaultBranchId}
            onDone={() => {
              setEditing(false)
              router.refresh()
            }}
          />
        </SheetContent>
      </Sheet>

      {/* Quick-book sheet */}
      <QuickBookSheet
        open={booking}
        onOpenChange={setBooking}
        memberId={member.id}
        onBooked={() => {
          setBooking(false)
          router.refresh()
        }}
      />
    </main>
  )
}

// ── Quick actions ───────────────────────────────────────────────────────────
// Only genuine ACTIONS live here. The old bar also carried "Paket" and "QR", which merely
// jumped to tabs sitting one row below — a second copy of the navigation, not an action
// (the repeated-top-actions nit, Doc 20 §7).
function QuickActions({
  insideNow,
  memberId,
  onBook,
  onEdit,
  onRefresh,
}: {
  insideNow: boolean
  memberId: string
  onBook: () => void
  onEdit: () => void
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function checkin() {
    setBusy(true)
    try {
      await checkInCommand({ memberId: memberId as MemberId, method: 'reception' })
      toast.success(insideNow ? 'Çıkış kaydı alındı.' : 'Giriş kaydı alındı.', {
        description: 'Birkaç saniye içinde işlenecek.',
      })
      setTimeout(onRefresh, 1500)
    } catch {
      toast.error('İşlem alınamadı.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" className="min-h-11 sm:min-h-9" onClick={onBook}>
        <CalendarPlusIcon /> Rezervasyon
      </Button>
      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={checkin} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <DoorOpenIcon />}
        {insideNow ? 'Çıkış' : 'Giriş'}
      </Button>
      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={onEdit}>
        <PencilIcon /> Düzenle
      </Button>
    </div>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfilePanel({ member, isPlatformAdmin }: { member: Member; isPlatformAdmin: boolean }) {
  const router = useRouter()
  const [deact, setDeact] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirmDeactivate() {
    setBusy(true)
    // The result used to be thrown away: on a domain refusal the dialog closed, the page refreshed,
    // and the member stayed active while nobody was told (Alpha Review).
    const res = await deactivateMember({ memberId: member.id, reason: reason.trim() })
    setBusy(false)
    if (!res.ok) {
      toast.error(domainErrorMessage(res.error))
      return
    }
    toast.success('Üye pasife alındı.')
    setDeact(false)
    setReason('')
    router.refresh()
  }

  // The stats moved to the header strip and "Düzenle" lives in the header actions — neither
  // is repeated here (Doc 20 §7). What remains is what only this tab owns.
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <Row label="Telefon" value={member.phone} />
        <Row label="E-posta" value={member.email ?? '—'} />
        <Row label="Doğum tarihi" value={member.birthDate ?? '—'} />
        <Row label="Katılım" value={d(member.joinedAt)} />
        <Row label="Durum" value={MEMBER_STATUS[member.status] ?? member.status} />
        <Row
          label="Acil durum"
          value={member.emergencyContact ? `${member.emergencyContact.name} · ${member.emergencyContact.phone}` : '—'}
        />
      </dl>

      <div className="space-y-1 border-t border-border pt-4">
        <p className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Not</p>
        <p className="text-sm whitespace-pre-wrap text-foreground">{member.notes ?? '—'}</p>
      </div>

      {member.status === 'active' ? (
        <div className="border-t border-border pt-4">
          <Button variant="destructive" className="min-h-11" onClick={() => setDeact(true)}>
            Pasife Al
          </Button>
        </div>
      ) : null}

      {/* v1.27 S5 — KVKK. Below "Pasife Al" on purpose: deactivation is the reversible act, and the
          one reception reaches for. This is the other one. */}
      {isPlatformAdmin ? (
        <div className="border-t border-border pt-4">
          <ErasurePanel memberId={member.id} memberName={member.fullName} />
        </div>
      ) : null}

      <Dialog open={deact} onOpenChange={(o) => (o ? null : setDeact(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Üyeyi pasife al?</DialogTitle>
            <DialogDescription>
              {member.fullName} pasife alınacak. Rezervasyon ve kredileri etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeact(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeactivate}
              disabled={busy || reason.trim().length === 0}
            >
              Pasife Al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Reservations ────────────────────────────────────────────────────────────
function ReservationsPanel({
  upcoming,
  past,
}: {
  upcoming: readonly MemberReservationRow[]
  past: readonly MemberReservationRow[]
}) {
  const router = useRouter()
  return (
    <div className="space-y-5">
      {/* "Hızlı Rezervasyon" is in the header actions and is not repeated here (Doc 20 §7);
          "Rezervasyon Ekranı" stays — it goes somewhere else, so it is not a duplicate. */}
      <Section
        title="Yaklaşan"
        hint={`${upcoming.length}`}
        actions={
          <Button size="sm" variant="outline" onClick={() => router.push('/reservations')}>
            Rezervasyon Ekranı
          </Button>
        }
      >
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Yaklaşan rezervasyon yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {upcoming.map((r) => (
              <ReservationItem key={r.reservationId} r={r} cancelable />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Geçmiş" hint={`son ${past.length}`}>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geçmiş rezervasyon yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {past.map((r) => (
              <ReservationItem key={r.reservationId} r={r} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

// The outcome is the point of a past reservation — it carries the colour, not an outline.
const RES_TONE: Record<string, string> = {
  booked: 'bg-primary-soft text-primary',
  attended: 'bg-success/10 text-success',
  no_show: 'bg-danger/10 text-danger',
  late_cancelled: 'bg-warning/10 text-warning',
  cancelled: 'bg-muted text-muted-foreground',
  waitlisted: 'bg-muted text-muted-foreground',
}

function ReservationItem({ r, cancelable = false }: { r: MemberReservationRow; cancelable?: boolean }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function cancel() {
    setBusy(true)
    try {
      const res = await cancelReservationAction({ reservationId: r.reservationId })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
      } else {
        toast.success('Rezervasyon iptal edildi.')
        router.refresh()
      }
    } catch {
      toast.error('İptal başarısız.')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-primary-soft/40">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{dt(r.startsAt)}</p>
        <p className="truncate text-xs text-muted-foreground">{r.category}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge className={RES_TONE[r.status] ?? 'bg-muted text-muted-foreground'}>
          {RES_STATUS[r.status] ?? r.status}
        </Badge>
        {cancelable && r.status === 'booked' ? (
          <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
            İptal
          </Button>
        ) : null}
      </div>

      <Dialog open={confirm} onOpenChange={(o) => (o ? null : setConfirm(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rezervasyonu iptal et?</DialogTitle>
            <DialogDescription>
              {dt(r.startsAt)} · {r.category}. Ders saatine yakın iptallerde krediniz düşebilir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null} İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

// ── Check-in ──────────────────────────────────────────────────────────────────
function CheckinPanel({
  insideNow,
  lastCheckInAt,
  history,
}: {
  insideNow: boolean
  lastCheckInAt: number | null
  history: readonly MemberCheckInRow[]
}) {
  const router = useRouter()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <Badge className={insideNow ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>
            {insideNow ? 'İçeride' : 'Dışarıda'}
          </Badge>
          <span className="text-muted-foreground">Son giriş: {lastCheckInAt ? dt(lastCheckInAt) : '—'}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push('/checkin')}>
          Check-in Ekranı
        </Button>
      </div>

      {/* D15 — the STATIC memberId QR card is gone. It was a bearer credential with no expiry:
          once a member could see it, a screenshot let anyone walk in as her, forever. The member
          now shows a short-lived, single-use code from her own portal (D10/D16). */}
      <Section title="Giriş QR Kodu">
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-xs">
          Üye, giriş kodunu kendi portalından gösterir. Kod kısa ömürlü ve tek kullanımlıktır;
          basılı/sabit QR kartı kullanılmaz. İnternet yoksa aşağıdaki manuel arama ile giriş
          alabilirsiniz.
        </div>
      </Section>

      <Section title="Geçmiş" hint="son 90 gün">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıt yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-3 py-2.5">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <span
                    className={`size-1.5 rounded-full ${h.direction === 'in' ? 'bg-success' : 'bg-muted-foreground'}`}
                  />
                  {h.direction === 'in' ? 'Giriş' : 'Çıkış'}
                </span>
                <span className="tabular-nums text-muted-foreground">{dt(h.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

// ── Payments (seam) ───────────────────────────────────────────────────────────
function AuditPanel({ memberId }: { memberId: string }) {
  return (
    <Timeline
      filterable
      load={() => memberTimelineAction({ memberId })}
      emptyLabel="Bu üye için henüz kayıt oluşmadı."
    />
  )
}

// ── Quick-book sheet ──────────────────────────────────────────────────────────
function QuickBookSheet({
  open,
  onOpenChange,
  memberId,
  onBooked,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  memberId: string
  onBooked: () => void
}) {
  const [sessions, setSessions] = useState<readonly UpcomingSession[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setSessions(null)
    listUpcomingSessionsAction({ nowMs: Date.now() })
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function book(sessionId: string) {
    setBusyId(sessionId)
    try {
      const res = await bookReservationAction({ memberId, sessionId })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
      } else {
        toast.success('Rezervasyon oluşturuldu.')
        onBooked()
      }
    } catch {
      toast.error('Rezervasyon başarısız.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-4 overflow-y-auto p-4 sm:p-5">
        <SheetHeader className="p-0">
          <SheetTitle className="text-h1">Hızlı Rezervasyon</SheetTitle>
          <SheetDescription>Önümüzdeki 14 gündeki uygun seanslar.</SheetDescription>
        </SheetHeader>
        {sessions === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Uygun seans yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {sessions.map((s) => {
              const full = s.bookedCount >= s.capacity
              return (
                <li key={s.sessionId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{s.serviceName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dt(s.startsAt)}
                      {s.trainerName ? ` · ${s.trainerName}` : ''} ·{' '}
                      <span className={`tabular-nums ${full ? 'text-danger' : ''}`}>
                        {s.bookedCount}/{s.capacity}
                      </span>
                    </p>
                  </div>
                  <Button size="sm" onClick={() => book(s.sessionId)} disabled={busyId !== null || full}>
                    {busyId === s.sessionId ? <Loader2Icon className="animate-spin" /> : null}
                    {full ? 'Dolu' : 'Rezerve Et'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── shared bits ───────────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  )
}
