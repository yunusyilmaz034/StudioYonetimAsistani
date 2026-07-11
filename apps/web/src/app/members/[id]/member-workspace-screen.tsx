'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  QrCodeIcon,
  UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import type { Member, MemberEventRecord, MemberId } from '@studio/core'

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
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { checkInCommand } from '@/lib/commands'
import { domainErrorMessage } from '@/lib/domain-error'
import type { ProductView } from '@/server/catalog-query'
import type {
  MemberCheckInRow,
  MemberReservationRow,
  MemberWorkspaceData,
} from '@/server/member-workspace-query'
import { deactivateMember } from '@/server/actions/members'
import {
  listUpcomingSessionsAction,
  type UpcomingSession,
} from '@/server/actions/booking'
import { bookReservationAction, cancelReservationAction } from '@/server/actions/reservations'
import {
  listMemberSubscriptionsAction,
  type SubscriptionView,
} from '@/server/actions/subscription'

import { MemberForm } from '../member-form'
import { MemberQrCard } from '../qr-card'
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
const EVENT_LABEL: Record<string, string> = {
  'member.registered': 'Üye kaydı',
  'member.profile_updated': 'Profil güncellendi',
  'member.deactivated': 'Üye pasife alındı',
  'entitlement.purchased': 'Paket atandı',
  'entitlement.adjusted': 'Kredi düzenlendi',
  'entitlement.payment_recorded': 'Ödeme kaydedildi',
  'entitlement.amended': 'Abonelik düzenlendi',
  'entitlement.reactivated': 'Abonelik yeniden aktif',
  'entitlement.cancelled': 'Abonelik iptal',
  'entitlement.expired': 'Abonelik süresi doldu',
  'reservation.booked': 'Rezervasyon',
  'reservation.cancelled': 'Rezervasyon iptali',
  'reservation.attended': 'Derse katıldı',
  'reservation.no_show': 'Derse gelmedi',
  'reservation.auto_resolved': 'Otomatik sonuçlandı',
  'reservation.corrected': 'Katılım düzeltildi',
  'member.checked_in': 'Giriş yaptı',
  'member.checked_out': 'Çıkış yaptı',
  'member.auto_checked_out': 'Otomatik çıkış',
}
const ACTOR_LABEL: Record<string, string> = {
  owner: 'Yönetici',
  receptionist: 'Resepsiyon',
  trainer: 'Eğitmen',
  platform_admin: 'Platform',
  system: 'Sistem',
  member: 'Üye',
}
const METHOD_LABEL: Record<string, string> = { cash: 'Nakit', credit_card: 'Kredi Kartı', bank_transfer: 'Havale / EFT' }

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
  { id: 'payments', label: 'Ödemeler', icon: CreditCardIcon },
  { id: 'audit', label: 'İşlem Geçmişi', icon: HistoryIcon },
]

export function MemberWorkspaceScreen({
  data,
  products,
  defaultBranchId,
}: {
  data: MemberWorkspaceData
  products: readonly ProductView[]
  defaultBranchId: string | null
}) {
  const router = useRouter()
  const { member } = data
  const [active, setActive] = useState<SectionId>('profile')
  const [editing, setEditing] = useState(false)
  const [booking, setBooking] = useState(false)

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Toaster />

      {/* Header */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push('/members')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Üyeler
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">{member.fullName}</h1>
            <p className="text-sm text-muted-foreground">
              {member.phone}
              {member.status !== 'active' ? ` · ${MEMBER_STATUS[member.status]}` : ''}
              {data.insideNow ? ' · İçeride' : ''}
            </p>
          </div>
          <QuickActions
            insideNow={data.insideNow}
            memberId={member.id}
            onBook={() => setBooking(true)}
            onEdit={() => setEditing(true)}
            go={setActive}
            onRefresh={() => router.refresh()}
          />
        </div>
      </div>

      {/* Section nav — vertical on mobile (section list), horizontal tabs on desktop */}
      <nav className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-1 md:flex-row">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const on = active === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="size-4" />
              {s.label}
            </button>
          )
        })}
      </nav>

      {/* Active panel */}
      <div>
        {active === 'profile' && <ProfilePanel member={member} onEdit={() => setEditing(true)} />}
        {active === 'packages' && <SubscriptionsPanel memberId={member.id} products={products} />}
        {active === 'reservations' && (
          <ReservationsPanel
            upcoming={data.upcomingReservations}
            past={data.pastReservations}
            onBook={() => setBooking(true)}
          />
        )}
        {active === 'checkin' && (
          <CheckinPanel
            member={member}
            insideNow={data.insideNow}
            lastCheckInAt={data.lastCheckInAt}
            history={data.checkInHistory}
          />
        )}
        {active === 'payments' && <PaymentsPanel memberId={member.id} onGoPackages={() => setActive('packages')} />}
        {active === 'audit' && <AuditPanel audit={data.audit} />}
      </div>

      {/* Edit sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
          <SheetHeader className="p-0">
            <SheetTitle>Üyeyi Düzenle</SheetTitle>
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
function QuickActions({
  insideNow,
  memberId,
  onBook,
  onEdit,
  go,
  onRefresh,
}: {
  insideNow: boolean
  memberId: string
  onBook: () => void
  onEdit: () => void
  go: (s: SectionId) => void
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
      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => go('packages')}>
        <PackageIcon /> Paket
      </Button>
      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => go('checkin')}>
        <QrCodeIcon /> QR
      </Button>
      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={onEdit}>
        <PencilIcon /> Düzenle
      </Button>
    </div>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfilePanel({ member, onEdit }: { member: Member; onEdit: () => void }) {
  const router = useRouter()
  const [deact, setDeact] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirmDeactivate() {
    setBusy(true)
    await deactivateMember({ memberId: member.id, reason: reason.trim() })
    setBusy(false)
    setDeact(false)
    setReason('')
    router.refresh()
  }

  const s = member.stats
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
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
      <div className="space-y-1 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground">Not</p>
        <p className="text-sm whitespace-pre-wrap text-foreground">{member.notes ?? '—'}</p>
      </div>
      {s ? (
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm sm:grid-cols-4">
          <Stat label="Aktif paket" value={String(s.activeEntitlementCount)} />
          <Stat label="Bakiye" value={tl(s.balanceDue)} accent={s.balanceDue > 0} />
          <Stat label="Son giriş" value={s.lastCheckInAt ? d(s.lastCheckInAt) : '—'} />
          <Stat label="Son katılım" value={s.lastAttendanceAt ? d(s.lastAttendanceAt) : '—'} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button className="min-h-11" onClick={onEdit}>
          <PencilIcon /> Düzenle
        </Button>
        {member.status === 'active' ? (
          <Button variant="destructive" className="min-h-11" onClick={() => setDeact(true)}>
            Pasife Al
          </Button>
        ) : null}
      </div>

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
  onBook,
}: {
  upcoming: readonly MemberReservationRow[]
  past: readonly MemberReservationRow[]
  onBook: () => void
}) {
  const router = useRouter()
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Yaklaşan ({upcoming.length})</h2>
        <div className="flex gap-2">
          <Button size="sm" onClick={onBook}>
            <CalendarPlusIcon /> Hızlı Rezervasyon
          </Button>
          <Button size="sm" variant="outline" onClick={() => router.push('/reservations')}>
            Rezervasyon Ekranı
          </Button>
        </div>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">Yaklaşan rezervasyon yok.</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((r) => (
            <ReservationItem key={r.reservationId} r={r} cancelable />
          ))}
        </ul>
      )}
      <div className="space-y-2 border-t border-border pt-3">
        <h2 className="text-sm font-medium text-foreground">Geçmiş (son {past.length})</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geçmiş rezervasyon yok.</p>
        ) : (
          <ul className="space-y-2">
            {past.map((r) => (
              <ReservationItem key={r.reservationId} r={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
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
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {dt(r.startsAt)} · <span className="text-muted-foreground">{r.category}</span>
        </p>
        <Badge variant="outline" className="mt-1">
          {RES_STATUS[r.status] ?? r.status}
        </Badge>
      </div>
      {cancelable && r.status === 'booked' ? (
        <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
          İptal
        </Button>
      ) : null}

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
  member,
  insideNow,
  lastCheckInAt,
  history,
}: {
  member: Member
  insideNow: boolean
  lastCheckInAt: number | null
  history: readonly MemberCheckInRow[]
}) {
  const router = useRouter()
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={insideNow ? 'default' : 'outline'}>{insideNow ? 'İçeride' : 'Dışarıda'}</Badge>
          <span className="text-muted-foreground">Son giriş: {lastCheckInAt ? dt(lastCheckInAt) : '—'}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push('/checkin')}>
          Check-in Ekranı
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-medium text-foreground">Giriş QR Kodu</h3>
        <MemberQrCard memberId={member.id} memberName={member.fullName} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-medium text-foreground">Geçmiş (son 90 gün)</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıt yok.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-foreground">{h.direction === 'in' ? 'Giriş' : 'Çıkış'}</span>
                <span className="text-muted-foreground">{dt(h.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Payments (seam) ───────────────────────────────────────────────────────────
function PaymentsPanel({ memberId, onGoPackages }: { memberId: string; onGoPackages: () => void }) {
  const [subs, setSubs] = useState<readonly SubscriptionView[] | null>(null)

  useEffect(() => {
    let alive = true
    listMemberSubscriptionsAction({ memberId })
      .then((r) => alive && setSubs(r))
      .catch(() => alive && setSubs([]))
    return () => {
      alive = false
    }
  }, [memberId])

  const totals = useMemo(() => {
    const rows = subs ?? []
    return {
      agreed: rows.reduce((a, s) => a + s.priceAgreedKurus, 0),
      paid: rows.reduce((a, s) => a + s.paidKurus, 0),
      balance: rows.reduce((a, s) => a + s.balanceDueKurus, 0),
    }
  }, [subs])

  if (subs === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Anlaşılan" value={tl(totals.agreed)} />
        <Stat label="Tahsil edilen" value={tl(totals.paid)} />
        <Stat label="Bakiye" value={tl(totals.balance)} accent={totals.balance > 0} />
      </div>
      <p className="text-xs text-muted-foreground">
        Ödemeler abonelik atama sırasında kaydedilir (v1.14 seam). Yeni tahsilat için ilgili paketten
        “Ödeme” işlemini kullanın. Gerçek Payments modülü v1.19&apos;da gelecek.
      </p>
      <div className="space-y-2 border-t border-border pt-3">
        {subs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kayıtlı paket / ödeme yok.</p>
        ) : (
          <ul className="space-y-2">
            {subs.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{s.productName}</span>
                  <span className="text-muted-foreground">{d(s.validFrom)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Anlaşılan: {tl(s.priceAgreedKurus)}</span>
                  <span>Tahsil: {tl(s.paidKurus)}</span>
                  {s.balanceDueKurus > 0 ? (
                    <span className="text-destructive">Bakiye: {tl(s.balanceDueKurus)}</span>
                  ) : null}
                  {s.method ? <span>{METHOD_LABEL[s.method] ?? s.method}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="outline" onClick={onGoPackages}>
          <PackageIcon /> Paketlere git
        </Button>
      </div>
    </div>
  )
}

// ── Audit ─────────────────────────────────────────────────────────────────────
function AuditPanel({ audit }: { audit: readonly MemberEventRecord[] }) {
  if (audit.length === 0) {
    return (
      <EmptyState icon={HistoryIcon} title="İşlem yok" description="Bu üye için henüz kayıt oluşmadı." />
    )
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <ul className="space-y-2">
        {audit.map((e, i) => (
          <li key={i} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{EVENT_LABEL[e.type] ?? e.type}</p>
              <p className="text-xs text-muted-foreground">{ACTOR_LABEL[e.actorType] ?? e.actorType}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{dt(e.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </div>
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
      <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Hızlı Rezervasyon</SheetTitle>
          <SheetDescription>Önümüzdeki 14 gündeki uygun seanslar.</SheetDescription>
        </SheetHeader>
        {sessions === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Uygun seans yok.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const full = s.bookedCount >= s.capacity
              return (
                <li key={s.sessionId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{s.serviceName}</p>
                    <p className="text-xs text-muted-foreground">
                      {dt(s.startsAt)}
                      {s.trainerName ? ` · ${s.trainerName}` : ''} · {s.bookedCount}/{s.capacity}
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
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  )
}
function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${accent ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}
