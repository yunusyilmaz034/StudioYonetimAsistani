'use client'

import { useEffect, useState } from 'react'
import { CalendarOffIcon, FileTextIcon, Loader2Icon, PaperclipIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { DocumentStorageUnconfiguredError } from '@/lib/document-upload'
import { LEAVE_DOCUMENT_ACCEPT, LeaveDocumentFileError, uploadLeaveDocumentPage } from '@/lib/leave-document-upload'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  addLeaveDocumentAction,
  cancelLeaveAction,
  decideLeaveAction,
  listLeaveDocumentsAction,
  listLeavesAction,
  removeLeaveDocumentAction,
  requestLeaveAction,
  type LeaveDocumentView,
  type LeaveRow,
} from '@/server/actions/leave'

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
//
// Bu ekranın taşıdığı bilgi izin BAKİYESİ değil: **o aralıkta kaç ders sahipsiz kalıyor.** Onay
// satırında o sayı yazmıyorsa, onaylayan kişi takvime kendisi gidip bakacak demektir — ve bakmaz.

const TUR: Record<string, string> = { izin: 'İzin', rapor: 'Rapor', egitim: 'Eğitim', diger: 'Diğer' }
const DURUM: Record<string, { etiket: string; sinif: string }> = {
  pending: { etiket: 'Karar bekliyor', sinif: 'text-warning' },
  approved: { etiket: 'Onaylandı', sinif: 'text-success' },
  rejected: { etiket: 'Reddedildi', sinif: 'text-destructive' },
  cancelled: { etiket: 'Geri çekildi', sinif: 'text-muted-foreground' },
}

const gun = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
const bugun = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })

export function IzinPanel({ ownerMu }: { ownerMu: boolean }) {
  const [rows, setRows] = useState<readonly LeaveRow[]>([])
  const [busy, setBusy] = useState(false)
  const [yeni, setYeni] = useState(false)
  const [kind, setKind] = useState<'izin' | 'rapor' | 'egitim' | 'diger'>('izin')
  const [from, setFrom] = useState(bugun())
  const [to, setTo] = useState(bugun())
  const [note, setNote] = useState('')
  const [reddeden, setReddeden] = useState<LeaveRow | null>(null)
  const [sebep, setSebep] = useState('')
  /** Raporuna bakılan izin (OR-77, karar 4). */
  const [raporu, setRaporu] = useState<LeaveRow | null>(null)

  const yukle = () => listLeavesAction().then(setRows).catch(() => setRows([]))
  useEffect(() => {
    void yukle()
  }, [])

  async function calistir(f: () => Promise<{ ok: boolean; error?: unknown }>, iyi: string) {
    setBusy(true)
    try {
      const r = await f()
      if (r.ok) {
        toast.success(iyi)
        await yukle()
        return true
      }
      toast.error(domainErrorMessage(r.error as Parameters<typeof domainErrorMessage>[0]))
    } catch {
      toast.error('İşlem tamamlanamadı.')
    } finally {
      setBusy(false)
    }
    return false
  }

  // RAPOR YÜKLE (OR-77, karar 4): dosya önce özel Storage yoluna, sonra kayıt. Yol öneki sunucudan geliyor.
  async function raporYukle(r: LeaveRow, files: FileList | null) {
    if (!files || files.length === 0 || !r.uploadPrefix) return
    setBusy(true)
    try {
      const pages: string[] = []
      for (const file of Array.from(files)) pages.push(await uploadLeaveDocumentPage({ prefix: r.uploadPrefix, file }))
      const res = await addLeaveDocumentAction({ leaveId: r.id, pages })
      if (res.ok) {
        toast.success('Rapor eklendi. Yalnızca izin sahibi ve stüdyo sahibi görebilir.')
        await yukle()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch (e) {
      if (e instanceof LeaveDocumentFileError) {
        toast.error(e.reason === 'type' ? 'Yalnızca fotoğraf ya da PDF yüklenebilir.' : 'Dosya 10 MB’tan büyük olamaz.')
      } else if (e instanceof DocumentStorageUnconfiguredError) {
        toast.error('Dosya deposu yapılandırılmamış; rapor yüklenemiyor.')
      } else {
        toast.error('Rapor yüklenemedi. Bağlantınızı kontrol edin.')
      }
    } finally {
      setBusy(false)
    }
  }

  const bekleyen = rows.filter((r) => r.status === 'pending')

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">İzinler</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setYeni(true)}>
          <PlusIcon />
          İzin iste
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Yaklaşan izin kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-foreground">
                  {r.staffName} · {TUR[r.kind] ?? r.kind}
                </span>
                <span className={`text-xs ${DURUM[r.status]?.sinif ?? ''}`}>{DURUM[r.status]?.etiket ?? r.status}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {gun(r.fromMs)} – {gun(r.toMs)} · {r.days} gün
                {r.note ? ` · ${r.note}` : ''}
              </p>
              {/* BU SATIR BU ÖZELLİĞİN SEBEBİ. Kaç ders sahipsiz kalıyor — onaylamadan önce
                  görülmesi gereken tek şey. */}
              <p className={r.affectedSessions > 0 ? 'text-sm text-warning' : 'text-sm text-muted-foreground'}>
                <CalendarOffIcon className="mr-1 inline size-3.5" />
                {r.affectedSessions > 0
                  ? `${r.affectedSessions} ders bu aralıkta bu eğitmene atanmış — yerine biri konmalı ya da ders iptal edilmeli.`
                  : 'Bu aralıkta atanmış dersi yok.'}
              </p>
              {r.status === 'rejected' && r.decisionReason ? (
                <p className="text-xs text-muted-foreground">Red sebebi: {r.decisionReason}</p>
              ) : null}

              {/* RAPOR DOSYASI (OR-77, karar 4) — `documentCount` null ise bu satırın raporunu göremezsin;
                  ne sayı ne düğme gösterilir. */}
              {r.documentCount !== null ? (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {r.documentCount > 0 ? (
                    <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={() => setRaporu(r)}>
                      <PaperclipIcon /> Rapor ({r.documentCount})
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Rapor dosyası eklenmedi.</span>
                  )}
                  {r.uploadPrefix ? (
                    <label
                      className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted ${busy ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      {busy ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                      Rapor ekle
                      <input
                        type="file"
                        className="sr-only"
                        accept={LEAVE_DOCUMENT_ACCEPT}
                        multiple
                        onChange={(e) => {
                          void raporYukle(r, e.target.files)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1 pt-1">
                {ownerMu && r.status === 'pending' ? (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void calistir(() => decideLeaveAction({ leaveId: r.id, approve: true }), 'Onaylandı.')}
                    >
                      Onayla
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setReddeden(r)}>
                      Reddet
                    </Button>
                  </>
                ) : null}
                {r.status === 'pending' || (ownerMu && r.status === 'approved') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void calistir(() => cancelLeaveAction({ leaveId: r.id }), 'Geri çekildi.')}
                  >
                    Geri çek
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {ownerMu && bekleyen.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {bekleyen.length} talep karar bekliyor. Onaylanan izin dersleri kendiliğinden değiştirmez —
          eğitmensiz kalan seansları takvimden sen düzenlersin.
        </p>
      ) : null}

      <Dialog open={yeni} onOpenChange={(o) => (o ? null : setYeni(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İzin iste</DialogTitle>
            <DialogDescription>Gün bazında. Yarım gün için resepsiyonla konuş.</DialogDescription>
          </DialogHeader>
          <Select value={kind} onValueChange={(v) => setKind((v as typeof kind) ?? 'izin')}>
            <SelectTrigger>
              <SelectValue>{TUR[kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TUR).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Başlangıç
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Bitiş
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <Textarea rows={3} placeholder="Not (isteğe bağlı)" value={note} onChange={(e) => setNote(e.target.value)} />
          {kind === 'rapor' ? (
            <p className="text-xs text-muted-foreground">
              Rapor dosyasını talep gönderildikten sonra listeden ekleyebilirsin (fotoğraf ya da PDF). Yalnızca sen ve
              stüdyo sahibi görebilir.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setYeni(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                const ok = await calistir(() => requestLeaveAction({ kind, from, to, note }), 'İzin talebin iletildi.')
                if (ok) {
                  setYeni(false)
                  setNote('')
                }
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Gönder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reddeden !== null} onOpenChange={(o) => (o ? null : setReddeden(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İzni reddet</DialogTitle>
            <DialogDescription>{reddeden?.staffName} — sebep yazılmadan reddedilemez.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Sebep (zorunlu)" value={sebep} onChange={(e) => setSebep(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReddeden(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={busy || sebep.trim() === ''}
              onClick={async () => {
                const ok = await calistir(
                  () => decideLeaveAction({ leaveId: reddeden!.id, approve: false, reason: sebep.trim() }),
                  'Reddedildi.',
                )
                if (ok) {
                  setReddeden(null)
                  setSebep('')
                }
              }}
            >
              Reddet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RaporPenceresi
        izin={raporu}
        onKapat={() => setRaporu(null)}
        onDegisti={() => {
          void yukle()
        }}
      />
    </Card>
  )
}

/**
 * Rapor dosyaları (OR-77, karar 4). Linkler 5 dakika yaşar ve pencere her açılışta yeniden üretir — eski bir
 * sekmede kalmış link bir süre sonra çalışmaz, bu bilerek.
 */
function RaporPenceresi({ izin, onKapat, onDegisti }: { izin: LeaveRow | null; onKapat: () => void; onDegisti: () => void }) {
  const [docs, setDocs] = useState<readonly LeaveDocumentView[] | null>(null)
  const [kaldirilan, setKaldirilan] = useState<string | null>(null)
  const [sebep, setSebep] = useState('')
  const [busy, setBusy] = useState(false)

  const oku = (leaveId: string) =>
    listLeaveDocumentsAction({ leaveId })
      .then(setDocs)
      .catch(() => {
        setDocs([])
        toast.error('Rapor dosyaları yüklenemedi.')
      })

  useEffect(() => {
    setDocs(null)
    setKaldirilan(null)
    setSebep('')
    if (izin) void oku(izin.id)
  }, [izin])

  async function kaldir(documentId: string) {
    if (!izin) return
    setBusy(true)
    try {
      const r = await removeLeaveDocumentAction({ leaveId: izin.id, documentId, reason: sebep.trim() })
      if (r.ok) {
        toast.success('Rapor dosyası kaldırıldı.')
        setKaldirilan(null)
        setSebep('')
        await oku(izin.id)
        onDegisti()
      } else {
        toast.error(domainErrorMessage(r.error))
      }
    } catch {
      toast.error('Kaldırılamadı.')
    } finally {
      setBusy(false)
    }
  }

  const tarih = (ms: number) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <Dialog open={izin !== null} onOpenChange={(o) => (o ? null : onKapat())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{izin?.staffName} — rapor</DialogTitle>
          <DialogDescription>Yalnızca izin sahibi ve stüdyo sahibi görebilir. Linkler 5 dakika geçerlidir.</DialogDescription>
        </DialogHeader>
        {docs === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Rapor dosyası yok.</p>
        ) : (
          <ul className="space-y-3">
            {docs.map((d) => (
              <li key={d.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{tarih(d.uploadedAt)}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setKaldirilan(kaldirilan === d.id ? null : d.id)}>
                    <Trash2Icon className="size-4 text-destructive" /> Kaldır
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.pages.map((s, i) =>
                    s.url ? (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted"
                      >
                        <FileTextIcon className="size-4" /> Sayfa {i + 1}
                        {s.pdf ? ' (PDF)' : ''}
                      </a>
                    ) : (
                      <span key={i} className="inline-flex min-h-9 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                        Sayfa {i + 1} — link üretilemedi
                      </span>
                    ),
                  )}
                </div>
                {kaldirilan === d.id ? (
                  <div className="flex flex-wrap gap-2">
                    <Input className="min-w-0 flex-1" placeholder="Sebep (zorunlu)" value={sebep} onChange={(e) => setSebep(e.target.value)} autoFocus />
                    <Button variant="destructive" disabled={busy || sebep.trim() === ''} onClick={() => void kaldir(d.id)}>
                      Kaldır
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onKapat}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
