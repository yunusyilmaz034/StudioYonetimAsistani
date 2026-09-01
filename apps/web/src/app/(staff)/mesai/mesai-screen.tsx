'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogInIcon, LogOutIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { domainErrorMessage } from '@/lib/domain-error'
import { endShiftAction, startShiftAction } from '@/server/actions/shift'
import type { ShiftView } from '@/server/shift-query'

// Tek ekran, tek düğme. Açık mesain varsa "Bitir", yoksa "Başlat" — üçüncü bir hâl yok, ve
// olmaması gerekiyor: kapıda ya da koridorda telefonuna bakan biri seçim yapmak istemez.

const saat = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

const sure = (bas: number, bit: number | null): string => {
  const dk = Math.max(0, Math.floor(((bit ?? Date.now()) - bas) / 60_000))
  return dk < 60 ? `${dk} dk` : `${Math.floor(dk / 60)} sa ${dk % 60} dk`
}

export function MesaiScreen({ view, ownerMu }: { view: ShiftView; ownerMu: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const acik = view.benimAcik

  async function calistir(f: () => Promise<{ ok: boolean; error?: unknown }>) {
    setBusy(true)
    try {
      const res = await f()
      if (res.ok) {
        toast.success(acik ? 'Mesai bitti. İyi akşamlar!' : 'Mesai başladı. Kolay gelsin!')
        start(() => router.refresh())
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('İşlem yapılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Mesai" description="Kendi giriş ve çıkış saatin." />

      <Card className="space-y-4 p-5">
        {acik ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Mesain sürüyor</p>
            <p className="text-2xl font-semibold tabular-nums">{saat(acik.startedAt)}&apos;den beri</p>
            <p className="text-sm text-muted-foreground">{sure(acik.startedAt, null)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Şu an açık bir mesain yok.</p>
        )}

        <Button
          size="lg"
          className="min-h-12 w-full"
          variant={acik ? 'destructive' : 'default'}
          disabled={busy || pending}
          onClick={() => void calistir(acik ? endShiftAction : () => startShiftAction({}))}
        >
          {acik ? <LogOutIcon className="size-5" /> : <LogInIcon className="size-5" />}
          {acik ? 'Mesaiyi bitir' : 'Mesaiye başla'}
        </Button>
      </Card>

      {/* Günün listesi yalnızca owner'a. Bir hocanın bir başkasının saatini görmesi için sebep yok. */}
      {ownerMu ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bugün</h2>
          {view.gun.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bugün henüz mesai kaydı yok.</p>
          ) : (
            <ul className="divide-y divide-border">
              {view.gun.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate font-medium">{s.displayName}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {saat(s.startedAt)} → {s.endedAt === null ? 'sürüyor' : saat(s.endedAt)}
                    <span className="ml-2 text-xs">({sure(s.startedAt, s.endedAt)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </main>
  )
}
