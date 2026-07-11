'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusIcon, SearchIcon, UsersIcon } from 'lucide-react'

import type { Member } from '@studio/core'

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
import { PageHeader } from '@/components/ui/page-header'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deactivateMember } from '@/server/actions/members'
import type { ProductView } from '@/server/catalog-query'

import { MemberForm } from './member-form'
import { MemberQrCard } from './qr-card'
import { SubscriptionsPanel } from './subscriptions'

const STATUS_LABEL: Record<Member['status'], string> = {
  active: 'Aktif',
  inactive: 'Pasif',
  deleted: 'Silindi',
}

function joinedLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR')
}

export function MembersScreen({
  members,
  products,
  defaultBranchId,
  initialMemberId = null,
  initialCreate = false,
}: {
  members: Member[]
  products: readonly ProductView[]
  defaultBranchId: string | null
  initialMemberId?: string | null
  initialCreate?: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [detail, setDetail] = useState<Member | null>(null)

  // Dashboard drill-through (?member=id) and quick action (?new=1) — open once on mount.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (initialCreate) {
      setEditing(null)
      setFormOpen(true)
    } else if (initialMemberId) {
      const m = members.find((x) => x.id === initialMemberId)
      if (m) setDetail(m)
    }
  }, [initialMemberId, initialCreate, members])
  const [deactivating, setDeactivating] = useState<Member | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return members
    return members.filter(
      (m) =>
        m.fullName.toLocaleLowerCase('tr').includes(q) ||
        (digits.length > 0 && m.phoneNormalized.includes(digits)),
    )
  }, [members, query])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(m: Member) {
    setDetail(null)
    setEditing(m)
    setFormOpen(true)
  }
  function onFormDone() {
    setFormOpen(false)
    setEditing(null)
    router.refresh()
  }
  async function confirmDeactivate() {
    if (!deactivating) return
    setBusy(true)
    await deactivateMember({ memberId: deactivating.id, reason: reason.trim() })
    setBusy(false)
    setDeactivating(null)
    setReason('')
    setDetail(null)
    router.refresh()
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Toaster />
      <PageHeader
        title="Üyeler"
        description={`${members.length} üye`}
        actions={
          <Button className="min-h-11 sm:min-h-0" onClick={openCreate}>
            <PlusIcon />
            Yeni Üye
          </Button>
        }
      />

      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="İsim veya telefon ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={query ? 'Eşleşen üye yok' : 'Henüz üye yok'}
          description={query ? 'Aramayı değiştirin.' : 'İlk üyeyi ekleyin.'}
          action={
            query ? undefined : (
              <Button onClick={openCreate}>
                <PlusIcon />
                Yeni Üye
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Mobile: cards (Doc 09 §9) */}
          <div className="space-y-2 md:hidden">
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDetail(m)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface p-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{m.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.phone}</p>
                </div>
                {m.status !== 'active' ? (
                  <Badge variant="outline">{STATUS_LABEL[m.status]}</Badge>
                ) : null}
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Soyad</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow
                    key={m.id}
                    onClick={() => setDetail(m)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">{m.fullName}</TableCell>
                    <TableCell>{m.phone}</TableCell>
                    <TableCell>{STATUS_LABEL[m.status]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create / edit */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{editing ? 'Üyeyi Düzenle' : 'Yeni Üye'}</SheetTitle>
            <SheetDescription>Zorunlu alanlar: ad soyad ve telefon.</SheetDescription>
          </SheetHeader>
          <MemberForm member={editing} defaultBranchId={defaultBranchId} onDone={onFormDone} />
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={detail !== null} onOpenChange={(o) => (o ? null : setDetail(null))}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
          {detail ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>{detail.fullName}</SheetTitle>
                <SheetDescription>{STATUS_LABEL[detail.status]}</SheetDescription>
              </SheetHeader>
              <dl className="space-y-2 text-sm">
                <Row label="Telefon" value={detail.phone} />
                <Row label="E-posta" value={detail.email ?? '—'} />
                <Row label="Doğum tarihi" value={detail.birthDate ?? '—'} />
                <Row label="Katılım" value={joinedLabel(detail.joinedAt)} />
                <Row label="Not" value={detail.notes ?? '—'} />
                <Row
                  label="Acil durum"
                  value={
                    detail.emergencyContact
                      ? `${detail.emergencyContact.name} · ${detail.emergencyContact.phone}`
                      : '—'
                  }
                />
              </dl>
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground">Giriş QR Kodu</h3>
                <MemberQrCard memberId={detail.id} memberName={detail.fullName} />
              </div>

              <div className="flex flex-col gap-2">
                <Button className="min-h-11 w-full" onClick={() => openEdit(detail)}>
                  Düzenle
                </Button>
                {detail.status === 'active' ? (
                  <Button
                    variant="destructive"
                    className="min-h-11 w-full"
                    onClick={() => setDeactivating(detail)}
                  >
                    Pasife Al
                  </Button>
                ) : null}
              </div>

              <SubscriptionsPanel memberId={detail.id} products={products} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Deactivate confirm */}
      <Dialog open={deactivating !== null} onOpenChange={(o) => (o ? null : setDeactivating(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Üyeyi pasife al?</DialogTitle>
            <DialogDescription>
              {deactivating?.fullName} pasife alınacak. Rezervasyon ve kredileri etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Sebep (zorunlu)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivating(null)} disabled={busy}>
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
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  )
}
