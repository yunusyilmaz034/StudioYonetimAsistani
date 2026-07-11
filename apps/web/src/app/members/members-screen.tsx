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

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
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
              <Button onClick={() => setFormOpen(true)}>
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
                onClick={() => open(m)}
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
                  <TableRow key={m.id} onClick={() => open(m)} className="cursor-pointer">
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

      {/* Create */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
          <SheetHeader className="p-0">
            <SheetTitle>Yeni Üye</SheetTitle>
            <SheetDescription>Zorunlu alanlar: ad soyad ve telefon.</SheetDescription>
          </SheetHeader>
          <MemberForm member={null} defaultBranchId={defaultBranchId} onDone={onFormDone} />
        </SheetContent>
      </Sheet>
    </main>
  )
}
