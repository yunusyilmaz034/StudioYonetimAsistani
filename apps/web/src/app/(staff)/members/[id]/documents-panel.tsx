'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraIcon, FileTextIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import type { DocumentKind } from '@studio/core'

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
import { Section } from '@/components/ui/section'
import { domainErrorMessage } from '@/lib/domain-error'
import { DocumentStorageUnconfiguredError, uploadMemberDocumentPage } from '@/lib/document-upload'
import {
  addMemberDocumentAction,
  listMemberDocumentsAction,
  removeMemberDocumentAction,
  type MemberDocumentView,
} from '@/server/actions/documents'

// SIGNED-DOCUMENT ARCHIVE (v1.28) — reception photographs the signed membership contract / KVKK notice
// / açık rıza with the tablet camera and archives them against the member. The capture screen is the
// four boxes the owner asked for; the images land in private Storage; a signed URL is minted on read.

const KIND_LABEL: Record<DocumentKind, string> = {
  membership_contract: 'Üyelik Sözleşmesi',
  kvkk_consent: 'KVKK Aydınlatma Metni',
  explicit_consent: 'Açık Rıza Onayı',
}

// The four boxes, in order. The contract is two pages; KVKK and açık rıza one each. A box left empty is
// simply skipped — reception can archive whatever it has to hand.
const SLOTS: readonly { kind: DocumentKind; label: string }[] = [
  { kind: 'membership_contract', label: 'Üyelik Sözleşmesi — Sayfa 1' },
  { kind: 'membership_contract', label: 'Üyelik Sözleşmesi — Sayfa 2' },
  { kind: 'kvkk_consent', label: 'KVKK Aydınlatma' },
  { kind: 'explicit_consent', label: 'Açık Rıza' },
]

const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

export function DocumentsPanel({ memberId, studioId }: { memberId: string; studioId: string }) {
  const [docs, setDocs] = useState<readonly MemberDocumentView[] | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [removing, setRemoving] = useState<MemberDocumentView | null>(null)

  const refresh = useCallback(async () => {
    try {
      setDocs(await listMemberDocumentsAction({ memberId }))
    } catch {
      setDocs([])
      toast.error('Belgeler yüklenemedi.')
    }
  }, [memberId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Section
      title="Belgeler"
      hint="Üyelik sözleşmesi, KVKK aydınlatma ve açık rıza. Tablet kamerasıyla çekip arşivleyin."
      actions={
        <Button size="sm" onClick={() => setCapturing(true)}>
          <PlusIcon className="size-4" />
          Belge Ekle
        </Button>
      }
    >
      {docs === null ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <FileTextIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Henüz belge arşivlenmemiş.</p>
          <Button size="sm" variant="outline" onClick={() => setCapturing(true)}>
            <CameraIcon className="size-4" />
            İlk belgeyi ekle
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{KIND_LABEL[doc.kind]}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.pages.length} sayfa · {d(doc.uploadedAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRemoving(doc)}>
                  <Trash2Icon className="size-4 text-destructive" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {doc.pages.map((page, i) =>
                  page.url ? (
                    <a
                      key={page.storagePath}
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block size-20 overflow-hidden rounded-md border border-border"
                    >
                      <img src={page.url} alt={`Sayfa ${i + 1}`} className="size-full object-cover" />
                    </a>
                  ) : (
                    <div
                      key={page.storagePath}
                      className="flex size-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                    >
                      Sayfa {i + 1}
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {capturing ? (
        <CaptureDialog
          memberId={memberId}
          studioId={studioId}
          onClose={() => setCapturing(false)}
          onUploaded={() => void refresh()}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          document={removing}
          memberId={memberId}
          onClose={() => setRemoving(null)}
          onRemoved={() => void refresh()}
        />
      ) : null}
    </Section>
  )
}

// The four-box capture. Each box opens the tablet's rear camera; a captured box shows its preview.
// "Yükle" uploads every captured box to private Storage, then records one document per kind (the
// contract's two pages become one two-page document), and refreshes.
function CaptureDialog({
  memberId,
  studioId,
  onClose,
  onUploaded,
}: {
  memberId: string
  studioId: string
  onClose: () => void
  onUploaded: () => void
}) {
  const [files, setFiles] = useState<(File | null)[]>(() => SLOTS.map(() => null))
  const [busy, setBusy] = useState(false)

  const setSlot = (i: number, file: File | null) =>
    setFiles((prev) => prev.map((f, j) => (j === i ? file : f)))

  const captured = files.filter(Boolean).length

  async function upload() {
    setBusy(true)
    try {
      // Group the captured files by kind, preserving slot order (so the contract's page 1 stays first).
      const byKind = new Map<DocumentKind, File[]>()
      SLOTS.forEach((slot, i) => {
        const f = files[i]
        if (f) byKind.set(slot.kind, [...(byKind.get(slot.kind) ?? []), f])
      })
      if (byKind.size === 0) {
        toast.error('En az bir sayfa ekleyin.')
        return
      }
      for (const [kind, kindFiles] of byKind) {
        const pages: string[] = []
        for (const file of kindFiles) {
          pages.push(await uploadMemberDocumentPage({ studioId, memberId, file }))
        }
        const res = await addMemberDocumentAction({ memberId, kind, pages })
        if (!res.ok) {
          toast.error(domainErrorMessage(res.error))
          return
        }
      }
      toast.success('Belgeler arşivlendi.')
      onUploaded()
      onClose()
    } catch (e) {
      if (e instanceof DocumentStorageUnconfiguredError) toast.error('Yükleme yapılandırılmamış.')
      else toast.error('Yükleme başarısız oldu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Belge Ekle</DialogTitle>
          <DialogDescription>
            Her kutuya dokunup imzalı belgeyi telefon/tablet kamerasıyla çekin. Elinizdeki kadarını ekleyebilirsiniz.
          </DialogDescription>
        </DialogHeader>

        {/* Belge kılavuzu — the native camera can't be overlaid, so the guide lives here. */}
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs">
          <p className="font-medium text-foreground">📸 Net bir belge fotoğrafı için</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>Belgeyi düz bir zemine koy; <b>tüm kenarları</b> çerçeveye sığdır.</li>
            <li>Tepeden, <b>dik açıyla</b> çek — eğik ya da açılı olmasın.</li>
            <li>İyi ışık: <b>gölge ve parlama</b> olmasın.</li>
            <li>Yazılar net okunmalı; bulanıksa kutuya tekrar dokunup yeniden çek.</li>
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SLOTS.map((slot, i) => (
            <CaptureBox key={i} label={slot.label} file={files[i] ?? null} onPick={(f) => setSlot(i, f)} />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void upload()} disabled={busy || captured === 0}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
            Yükle ({captured})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CaptureBox({
  label,
  file,
  onPick,
}: {
  label: string
  file: File | null
  onPick: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 text-center transition-colors hover:bg-muted"
      >
        {preview ? (
          <img src={preview} alt={label} className="size-full object-cover" />
        ) : (
          <>
            <CameraIcon className="size-6 text-muted-foreground" />
            <span className="px-1 text-[0.6875rem] leading-tight text-muted-foreground">{label}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <p className="truncate text-center text-[0.6875rem] text-muted-foreground">{label}</p>
    </div>
  )
}

// A removal is a compensating event — the domain demands a reason, so the UI collects one.
function RemoveDialog({
  document,
  memberId,
  onClose,
  onRemoved,
}: {
  document: MemberDocumentView
  memberId: string
  onClose: () => void
  onRemoved: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (reason.trim().length === 0) return
    setBusy(true)
    try {
      const res = await removeMemberDocumentAction({ memberId, documentId: document.id, reason: reason.trim() })
      if (res.ok) {
        toast.success('Belge kaldırıldı.')
        onRemoved()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Belge kaldırılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Belgeyi kaldır</DialogTitle>
          <DialogDescription>
            {KIND_LABEL[document.kind]} kalıcı olarak kaldırılır. Neden kaldırdığınızı yazın.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Örn. yanlış üyeye yüklendi"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy || reason.trim().length === 0}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
            Kaldır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
