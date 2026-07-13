'use client'

import { AlertTriangleIcon, CheckCircle2Icon, UploadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
  applyImportAction,
  previewImportAction,
  type ImportPreview,
} from '@/server/actions/import'

// The import screen.
//
// Its whole job is to be **impossible to press by accident**, and to say — with line numbers — exactly
// what is wrong with the file. It reads. It reports. It refuses. Only then does it offer the button.
//
// One bad row blocks the entire run. A partial import leaves a members list that is *almost* right,
// and nobody can tell which half.
export function ImportScreen({ branchId }: { branchId: string | null }) {
  const router = useRouter()
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  const pick = async (file: File) => {
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    setDone(null)
    setBusy(true)
    setPreview(await previewImportAction({ csv: text }))
    setBusy(false)
  }

  const apply = async () => {
    if (!csv) return
    setBusy(true)
    try {
      const res = await applyImportAction({ csv, branchId })
      setDone(res.imported)
      if (res.failed.length > 0) {
        // `member_phone_taken` almost always means the import was run twice: the phone is unique
        // (I-21) and the domain refuses the same member again. That is a protection, not a failure.
        toast.error(`${res.failed.length} satır yazılamadı. Muhtemelen zaten içe aktarılmışlar.`)
      } else {
        toast.success(`${res.imported} üye içe aktarıldı.`)
      }
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'İçe aktarma başarısız.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Üye içe aktarma"
        description="Eski sistemden gelen CSV dosyasından üyeleri aktarır. Ad soyad ve telefon — başka hiçbir şey."
      />

      <Section
        title="1. Dosyayı seç"
        hint="Excel'de: Farklı Kaydet → CSV UTF-8. Sütunlar: ad · soyad · telefon."
      >
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-6 hover:bg-muted/50">
          <UploadIcon className="size-8 text-muted-foreground" />
          <span className="mt-2 text-sm font-medium">
            {fileName || 'CSV dosyasını seçin'}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
            }}
          />
        </label>
      </Section>

      {preview?.error ? (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="p-4 text-sm text-danger">{preview.error}</CardContent>
        </Card>
      ) : null}

      {preview && !preview.error ? (
        <Section title="2. Doğrulama">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span>
              Toplam: <strong>{preview.total}</strong>
            </span>
            <span className="text-success">
              Geçerli: <strong>{preview.validCount}</strong>
            </span>
            <span className={preview.rejected.length > 0 ? 'text-danger' : ''}>
              Reddedilen: <strong>{preview.rejected.length}</strong>
            </span>
          </div>

          {preview.rejected.length > 0 ? (
            <Card className="border-danger/30">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-border p-3 text-sm font-medium text-danger">
                  <AlertTriangleIcon className="size-4" />
                  Bu satırlar kaynak dosyada düzeltilmeli. Hiçbiri tahmin edilmez, düzeltilmez veya
                  birleştirilmez.
                </div>
                <div className="divide-y divide-border">
                  {preview.rejected.map((r) => (
                    <div key={r.line} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
                      {/* The line number is the whole point: it is what she types into "go to line". */}
                      <span className="font-mono text-muted-foreground">satır {r.line}</span>
                      <span className="font-medium">{r.fullName || '—'}</span>
                      <span className="text-muted-foreground">{r.phoneRaw || '—'}</span>
                      <span className="text-danger">{r.message}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-success/30 bg-success/5">
              <CardContent className="flex items-center gap-2 p-4 text-sm">
                <CheckCircle2Icon className="size-4 text-success" />
                Dosya temiz. {preview.validCount} üye içe aktarılabilir.
              </CardContent>
            </Card>
          )}
        </Section>
      ) : null}

      {preview?.clean ? (
        <Section
          title="3. İçe aktar"
          hint="Sadece ad soyad ve telefon yazılır. Paket, kredi ve bakiye aktarılmaz — bunlar elle açılır."
        >
          {done !== null ? (
            <p className="text-sm">
              <strong>{done} üye</strong> içe aktarıldı. Üyeler listesinden görebilirsiniz.
            </p>
          ) : (
            <Button className="min-h-12" disabled={busy} onClick={() => void apply()}>
              {preview.validCount} üyeyi içe aktar
            </Button>
          )}
        </Section>
      ) : null}
    </div>
  )
}
