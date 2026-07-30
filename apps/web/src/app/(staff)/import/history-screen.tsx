'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangleIcon, Loader2Icon, RotateCcwIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

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
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { saveErrorMessage } from '@/lib/stale-deployment'
import { checkRevertAction, revertImportAction } from '@/server/actions/import-wizard'

// AKTARIM GEÇMİŞİ — and the undo the owner asked for.
//
// *"bir yanlışlık olmuş olabilir… en son importu iptal et, sistemi önceki haline getir."*
//
// The button is only offered after the server has said the batch is still inert. When it is not, the
// dialog shows exactly WHO is blocking it and why — because "geri alınamaz" with no reason is the
// kind of refusal that makes people go and edit production by hand.

export interface HistoryRow {
  readonly id: string
  readonly kind: 'members' | 'member_packages'
  readonly fileName: string
  readonly rowCount: number
  readonly createdMemberIds: readonly string[]
  readonly createdEntitlementIds: readonly string[]
  readonly skipped: number
  readonly status: 'applied' | 'reverted'
  readonly appliedAt: number
  readonly revertReason: string | null
}

const KIND_LABEL = { members: 'Üye listesi', member_packages: 'Üye paketleri' } as const
const dt = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' })

type Check = Awaited<ReturnType<typeof checkRevertAction>>

export function ImportHistory({ rows }: { rows: readonly HistoryRow[] }) {
  const router = useRouter()
  const [target, setTarget] = useState<HistoryRow | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function open(row: HistoryRow) {
    setTarget(row)
    setCheck(null)
    setReason('')
    setBusy(true)
    try {
      setCheck(await checkRevertAction({ batchId: row.id }))
    } catch (e) {
      toast.error(saveErrorMessage(e))
      setTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!target) return
    setBusy(true)
    try {
      const res = await revertImportAction({ batchId: target.id, reason: reason.trim() })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`${res.revertedMembers} üye, ${res.revertedEntitlements} paket geri alındı.`)
      setTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const canRevert = check !== null && 'verdict' in check && check.verdict.ok
  const blockers = check !== null && 'verdict' in check && !check.verdict.ok && check.verdict.code === 'batch_touched'
    ? check.verdict.blockers
    : []

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Aktarımlar"
        description="Dosyadan içeri alınan üye ve paketler"
        actions={
          <Button onClick={() => router.push('/import/wizard')} className="min-h-11">
            <UploadIcon /> Yeni Aktarım
          </Button>
        }
      />

      {rows.length === 0 ? (
        <Section title="Henüz aktarım yok">
          <p className="text-sm text-muted-foreground">
            Excel veya CSV dosyanızdan üye ve paket aktarmak için “Yeni Aktarım”a basın.
          </p>
        </Section>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tarih</th>
                <th className="px-3 py-2 text-left font-medium">Tür</th>
                <th className="px-3 py-2 text-left font-medium">Dosya</th>
                <th className="px-3 py-2 text-right font-medium">Üye</th>
                <th className="px-3 py-2 text-right font-medium">Paket</th>
                <th className="px-3 py-2 text-right font-medium">Atlanan</th>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{dt(r.appliedAt)}</td>
                  <td className="px-3 py-2">{KIND_LABEL[r.kind]}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">{r.fileName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.createdMemberIds.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.createdEntitlementIds.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.skipped}</td>
                  <td className="px-3 py-2">
                    {r.status === 'reverted' ? (
                      <span>
                        <Badge variant="outline">geri alındı</Badge>
                        {r.revertReason ? (
                          <span className="ml-2 text-xs text-muted-foreground">{r.revertReason}</span>
                        ) : null}
                      </span>
                    ) : (
                      <Badge variant="secondary">uygulandı</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'applied' ? (
                      <Button variant="outline" onClick={() => void open(r)} className="min-h-9">
                        <RotateCcwIcon className="size-3.5" /> Geri Al
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Aktarımı geri al</DialogTitle>
            <DialogDescription>
              Bu aktarımın eklediği üyeler pasife alınır, paketleri iptal edilir. Kayıtlar silinmez —
              ne olduğu geçmişte görünmeye devam eder.
            </DialogDescription>
          </DialogHeader>

          {busy && check === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Kontrol ediliyor…
            </p>
          ) : null}

          {check !== null && 'error' in check ? (
            <p className="text-sm text-danger">{check.error}</p>
          ) : null}

          {blockers.length > 0 ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertTriangleIcon className="size-4" /> Bu aktarım geri alınamaz
              </p>
              <p className="text-sm text-muted-foreground">
                Aşağıdaki kayıtların üzerine işlem yapılmış. Bunları sessizce iptal etmek, gerçekten
                olmuş şeyleri kaydı olmayan bir üyeye bağlı bırakırdı.
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-3 text-sm">
                {blockers.map((b, i) => (
                  <li key={i}>
                    <span className="font-medium">{b.subject}</span>{' '}
                    <span className="text-muted-foreground">— {b.because}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canRevert && target ? (
            <div className="space-y-3">
              <div className="rounded-xl border p-3 text-sm">
                <p>
                  <strong>{target.createdMemberIds.length}</strong> üye ve{' '}
                  <strong>{target.createdEntitlementIds.length}</strong> paket geri alınacak.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Sebep</label>
                <p className="mb-1 text-xs text-muted-foreground">
                  Üç ay sonra “bu neden geri alındı?” sorusunu bu cevaplayacak.
                </p>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Yanlış dosya aktarıldı"
                  className="min-h-11"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} className="min-h-11">Kapat</Button>
            {canRevert ? (
              <Button onClick={() => void confirm()} disabled={busy || reason.trim().length === 0} className="min-h-11">
                {busy ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Geri Al
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
