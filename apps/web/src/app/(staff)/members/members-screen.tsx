'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusIcon, SearchIcon, UsersIcon } from 'lucide-react'

import type { Member } from '@studio/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

import { MemberForm } from './member-form'

const STATUS_LABEL: Record<Member['status'], string> = {
  active: 'Aktif',
  inactive: 'Pasif',
  deleted: 'Silindi',
}

export function MembersScreen({
  members,
  defaultBranchId,
  initialCreate = false,
}: {
  members: Member[]
  defaultBranchId: string | null
  initialCreate?: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  // Quick action (?new=1) — open the create form once on mount.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (initialCreate) setFormOpen(true)
  }, [initialCreate])

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

  function open(m: Member) {
    router.push(`/members/${m.id}`)
  }
  function onFormDone() {
    setFormOpen(false)
    router.refresh()
  }

  const searching = query.trim().length > 0

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader
        title="Üyeler"
        description={`${members.length} üye`}
        actions={
          <Button className="min-h-11 sm:min-h-0" onClick={() => setFormOpen(true)}>
            <PlusIcon />
            Yeni Üye
          </Button>
        }
      />

      {/* Search is this screen's whole control surface — no metric strip here: a total that
          changes no decision would only cost vertical space (Doc 20 §1). */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="İsim veya telefon ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered.length} / {members.length}
          </span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={query ? 'Eşleşen üye yok' : 'Henüz üye yok'}
          description={query ? 'Aramayı değiştirin.' : 'İlk üyeyi ekleyin.'}
          action={
            query ? undefined : (
              <Button onClick={() => setFormOpen(true)}>
                <PlusIcon />
                Yeni Üye
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Mobile: one card, rows inside — not a stack of boxes (Doc 09 §9). */}
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm md:hidden">
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => open(m)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-primary-soft/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.fullName}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">{m.phone}</p>
                </div>
                <StatusCell status={m.status} />
              </button>
            ))}
          </div>

          {/* Desktop: table on one surface. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="px-4 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
                    Ad Soyad
                  </TableHead>
                  <TableHead className="px-4 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
                    Telefon
                  </TableHead>
                  <TableHead className="w-32 px-4 text-[0.6875rem] font-medium tracking-wide whitespace-nowrap uppercase text-muted-foreground">
                    Durum
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow
                    key={m.id}
                    onClick={() => open(m)}
                    className="cursor-pointer transition-colors hover:bg-primary-soft/40"
                  >
                    <TableCell className="px-4 py-3 font-medium text-foreground">{m.fullName}</TableCell>
                    <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">{m.phone}</TableCell>
                    <TableCell className="w-32 px-4 py-3 whitespace-nowrap">
                      <StatusCell status={m.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4 sm:p-5">
          <SheetHeader className="p-0">
            <SheetTitle className="text-h1">Yeni Üye</SheetTitle>
            <SheetDescription>Zorunlu alanlar: ad soyad ve telefon.</SheetDescription>
          </SheetHeader>
          <MemberForm member={null} defaultBranchId={defaultBranchId} onDone={onFormDone} />
        </SheetContent>
      </Sheet>
    </main>
  )
}

// Quiet by default, loud only when abnormal: an active member is the norm and gets a plain
// caption; anything else is a state someone may need to act on, so it gets a tinted badge.
function StatusCell({ status }: { status: Member['status'] }) {
  if (status === 'active') {
    return <span className="text-xs text-muted-foreground">Aktif</span>
  }
  return (
    <Badge className={status === 'deleted' ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}
