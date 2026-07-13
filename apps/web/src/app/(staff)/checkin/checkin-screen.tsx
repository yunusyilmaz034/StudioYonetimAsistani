'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CameraIcon, LogInIcon, LogOutIcon, SearchIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { MemberId } from '@studio/core'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import { TabletSmartphoneIcon } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { checkInCommand } from '@/lib/commands'
import { domainErrorMessage } from '@/lib/domain-error'
import { checkInByQrAction } from '@/server/actions/qr'
import { closeBranchAction, openBranchAction } from '@/server/actions/checkin'
import type { CheckinState } from '@/server/checkin-query'

import { QrScanner } from './qr-scanner'

interface MemberLite {
  readonly id: string
  readonly fullName: string
  readonly phone: string
}

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
const durationLabel = (since: number) => {
  const min = Math.max(0, Math.floor((Date.now() - since) / 60_000))
  return min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa ${min % 60} dk`
}

export function CheckinScreen({ state, members }: { state: CheckinState; members: readonly MemberLite[] }) {
  const router = useRouter()
  const [scannerOn, setScannerOn] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const debounce = useRef<Map<string, number>>(new Map())

  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.fullName])), [members])
  const insideIds = useMemo(() => new Set(state.inside.map((i) => i.memberId)), [state.inside])

  // D16 — a scanned QR now carries a SHORT-LIVED SIGNED TOKEN, not a memberId. It is verified
  // on the server (signature · expiry · member · branch · not-already-used) and the check-in is
  // written there — ONLINE-ONLY, by design. The scanned string is never trusted as an identity.
  //
  // No internet? The manual member search below still runs on the OFFLINE /commands path,
  // untouched: reception's door keeps working.
  const scanQr = useCallback(
    async (token: string) => {
      if (!state.branchId) return
      try {
        const res = await checkInByQrAction({ token, branchId: state.branchId })
        if (res.ok) {
          toast.success(`${res.value.memberName} — giriş kaydedildi.`)
          setTimeout(() => router.refresh(), 800)
        } else {
          toast.error(domainErrorMessage(res.error))
        }
      } catch {
        toast.error('QR doğrulanamadı. Bağlantınızı kontrol edin veya manuel arama kullanın.')
      }
    },
    [state.branchId, router],
  )

  const toggle = useCallback(
    async (memberId: string, method: 'qr' | 'reception') => {
      if (!state.isOpen) {
        toast.error('Önce şubeyi açın.')
        return
      }
      const now = Date.now()
      const last = debounce.current.get(memberId)
      if (last && now - last < 4000) return // ignore scanner repeats / double taps
      debounce.current.set(memberId, now)

      const wasInside = insideIds.has(memberId)
      try {
        await checkInCommand({ memberId: memberId as MemberId, method })
        toast.success(`${nameOf.get(memberId) ?? 'Üye'} — ${wasInside ? 'çıkış' : 'giriş'} alındı.`)
        window.setTimeout(() => router.refresh(), 1800) // let the trigger apply
      } catch {
        debounce.current.delete(memberId)
        toast.error('İşlem alınamadı. Bağlantıyı kontrol edin.')
      }
    },
    [state.isOpen, insideIds, nameOf, router],
  )

  async function setBranch(open: boolean) {
    if (!state.branchId) return
    setBusy(true)
    try {
      const res = open
        ? await openBranchAction({ branchId: state.branchId })
        : await closeBranchAction({ branchId: state.branchId })
      if (res.ok) {
        toast.success(open ? 'Şube açıldı.' : 'Şube kapatıldı.')
        router.refresh()
      } else {
        toast.error('İşlem tamamlanamadı.')
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return []
    return members
      .filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q) || (digits.length > 0 && m.phone.includes(digits)))
      .slice(0, 20)
  }, [members, query])

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Giriş / Çıkış"
        description={state.isOpen ? `Şu an içeride: ${state.occupancy}` : 'Şube kapalı'}
        actions={
          <div className="flex items-center gap-2">
            {/* v1.27 S4 — the wall tablet. Reception signs the iPad in once, in the morning, and
                hands the rest of the day to the members. */}
            <Link
              href="/checkin/kiosk"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <TabletSmartphoneIcon className="size-4" />
              Kiosk modu
            </Link>
            {state.branchId ? (
              <Button
                variant={state.isOpen ? 'destructive' : 'default'}
                className="min-h-11 sm:min-h-0"
                disabled={busy}
                onClick={() => setBranch(!state.isOpen)}
              >
                {state.isOpen ? 'Şubeyi Kapat' : 'Şubeyi Aç'}
              </Button>
            ) : null}
          </div>
        }
      />

      {!state.isOpen ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Şube kapalı. Giriş/çıkış almak için önce şubeyi açın.
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {/* QR + search */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">QR ile giriş</h3>
              <Button variant="outline" size="sm" onClick={() => setScannerOn((s) => !s)}>
                <CameraIcon />
                {scannerOn ? 'Kapat' : 'Kamerayı Aç'}
              </Button>
            </div>
            {scannerOn ? <QrScanner active={scannerOn} onScan={(v) => scanQr(v)} /> : null}

            <h3 className="pt-1 text-sm font-medium">Üye Ara</h3>
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="İsim veya telefon…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <ul className="divide-y divide-border">
              {filtered.map((m) => {
                const inside = insideIds.has(m.id)
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.fullName}</p>
                      <p className="text-xs text-muted-foreground">{m.phone}</p>
                    </div>
                    <Button
                      variant={inside ? 'outline' : 'default'}
                      size="sm"
                      className="min-h-9 shrink-0"
                      onClick={() => toggle(m.id, 'reception')}
                    >
                      {inside ? <LogOutIcon /> : <LogInIcon />}
                      {inside ? 'Çıkış' : 'Giriş'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Inside + expected */}
          <section className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-medium">İçeridekiler ({state.occupancy})</h3>
              {state.inside.length === 0 ? (
                <p className="text-sm text-muted-foreground">Şu an kimse yok.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {state.inside.map((i) => (
                    <li key={i.memberId} className="flex items-center justify-between gap-2 p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{nameOf.get(i.memberId) ?? i.memberId}</p>
                        <p className="text-xs text-muted-foreground">
                          {timeLabel(i.checkedInAt)} · {durationLabel(i.checkedInAt)}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => toggle(i.memberId, 'reception')}>
                        <LogOutIcon />
                        Çıkış
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {state.expectedSoon.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                  <UsersIcon className="size-4" /> Yaklaşan, henüz giriş yok
                </h3>
                <ul className="space-y-1">
                  {state.expectedSoon.map((e) => (
                    <li key={e.reservationId} className="flex justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                      <span className="truncate">{e.memberName}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{timeLabel(e.sessionStartsAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </main>
  )
}
