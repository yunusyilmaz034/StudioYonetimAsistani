'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, PackageIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { saveErrorMessage } from '@/lib/stale-deployment'
import {
  applyWizardAction,
  previewWizardAction,
  readImportFileAction,
  suggestMappingAction,
} from '@/server/actions/import-wizard'

import { MappingStep, type FieldInfo } from './mapping-step'
import { MatchStep, type Decision, type MatchRow } from './match-step'
import { StepBar, StepNote, type StepKey } from './steps'

// THE IMPORT WIZARD.
//
// Nothing is written until the last button. Every step before it returns what the next one needs and
// touches no studio data at all, so the operator can go back, change a mapping, and look again — the
// only way it is safe to let a spreadsheet near a live studio.
//
// The file is read ONCE and its rows are held here. Re-uploading between steps would mean the
// preview and the apply could see two different files, which is the one difference that would make
// the preview a lie.

type Kind = 'members' | 'member_packages'
type Preview = Awaited<ReturnType<typeof previewWizardAction>>

const KIND_LABEL: Record<Kind, string> = {
  members: 'Üye listesi',
  member_packages: 'Üye paketleri',
}

const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

// The standard page shell. Without it the content sits flush against the sidebar and the header's
// action button runs off the right edge — which is exactly how this shipped (owner, 2026-07-30).
// Wider than the usual 4xl because the mapping step is two columns of arrows and the preview is a
// six-column table; 6xl is already the app's width for table-heavy screens.
const PAGE = 'mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8'

export function ImportWizard({ branchId }: { branchId: string | null }) {
  const router = useRouter()
  const [step, setStep] = useState<StepKey>('kind')
  const [done, setDone] = useState<StepKey[]>([])
  const [busy, setBusy] = useState(false)

  const [kind, setKind] = useState<Kind | null>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<readonly (readonly string[])[]>([])
  const [truncated, setTruncated] = useState(false)
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [fields, setFields] = useState<readonly FieldInfo[]>([])
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyWizardAction>> | null>(null)

  const header = rows[headerRowIndex] ?? []
  const sample = rows[headerRowIndex + 1] ?? []

  function advance(to: StepKey, from: StepKey) {
    setDone((prev) => (prev.includes(from) ? prev : [...prev, from]))
    setStep(to)
  }

  async function onFile(file: File) {
    setBusy(true)
    try {
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      const res = await readImportFileAction({ fileName: file.name, base64 })
      if (res.error) {
        toast.error(res.error)
        return
      }
      setFileName(res.fileName)
      setRows(res.rows)
      setTruncated(res.truncated)
      setHeaderRowIndex(0)
      advance('header', 'file')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function toMapping() {
    if (!kind) return
    setBusy(true)
    try {
      const res = await suggestMappingAction({ kind, header: [...header] })
      setFields(res.fields)
      setMapping(res.mapping)
      advance('mapping', 'header')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runPreview(next: StepKey) {
    if (!kind) return
    setBusy(true)
    try {
      const res = await previewWizardAction({ kind, rows, mapping, defaults, headerRowIndex })
      setPreview(res)
      if (res.missing.length > 0) {
        setStep('gaps')
        return
      }
      // Rows matched by phone are already resolved and never reach the matching step. If none is
      // left undecided there is nothing to ask, and the step is skipped rather than shown empty.
      const needing = res.packages?.ready.filter((r) => r.match.kind !== 'phone') ?? []
      if (next === 'match' && needing.length === 0) {
        advance('preview', 'match')
        return
      }
      advance(next, next === 'match' ? 'gaps' : 'mapping')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!kind) return
    setBusy(true)
    try {
      const res = await applyWizardAction({
        kind,
        fileName,
        rows,
        mapping,
        defaults,
        headerRowIndex,
        branchId,
        resolutions: Object.values(decisions),
      })
      setResult(res)
      toast.success('Aktarım tamamlandı.')
      router.refresh()
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // ── done ──────────────────────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <main className={PAGE}>
        <PageHeader title="Aktarım tamamlandı" />
        <MetricStrip>
          <Metric label="Yeni üye" value={String(result.createdMemberIds.length)} />
          <Metric label="Paket" value={String(result.createdEntitlementIds.length)} />
          <Metric label="Atlanan" value={String(result.skipped)} />
          {result.failed.length > 0 ? (
            <Metric label="Başarısız" value={String(result.failed.length)} tone="danger" />
          ) : (
            <Metric label="Başarısız" value="0" />
          )}
        </MetricStrip>

        {result.failed.length > 0 ? (
          <Section title="Aktarılamayanlar">
            <ul className="space-y-1 text-sm">
              {result.failed.map((f) => (
                <li key={f.line}>
                  <span className="tabular-nums text-muted-foreground">{f.line}.</span> {f.subject} — {f.reason}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">Bir yanlışlık varsa geri alabilirsiniz.</p>
          <p className="mt-1 text-muted-foreground">
            Bu aktarımın oluşturduğu her kayıt bir arada tutuluyor. Üzerine işlem yapılmadığı sürece
            tek adımda geri alınabilir — Aktarım Geçmişi ekranından.
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => router.push('/import')} className="min-h-11">Aktarım Geçmişi</Button>
          <Button variant="outline" onClick={() => window.location.reload()} className="min-h-11">
            Yeni Aktarım
          </Button>
        </div>
      </main>
    )
  }

  const skipSteps: StepKey[] = kind === 'members' ? ['match'] : []

  return (
    <main className={PAGE}>
      <PageHeader title="Aktarım Sihirbazı" description={fileName || undefined} />
      <StepBar current={step} done={done} skip={skipSteps} />

      {/* 1 — WHAT */}
      {step === 'kind' ? (
        <Section title="Ne aktarıyorsunuz?">
          <StepNote>
            Her aktarım türü ayrı bir dosya bekler. Üyeleri ve paketlerini aynı anda aktaramazsınız —
            önce üyeler, sonra paketleri; ikincisi birincinin oluşturduğu üyeleri bulur.
          </StepNote>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['members', 'member_packages'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k)
                  advance('file', 'kind')
                }}
                className="flex items-start gap-3 rounded-2xl border p-4 text-left transition hover:border-accent hover:bg-accent/5"
              >
                {k === 'members' ? <UsersIcon className="mt-0.5 size-5 text-accent" /> : <PackageIcon className="mt-0.5 size-5 text-accent" />}
                <span>
                  <span className="block font-medium">{KIND_LABEL[k]}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {k === 'members'
                      ? 'Ad ve telefon. Yeni üye kayıtları oluşturur.'
                      : 'Her paket bir satır. Mevcut üyelere bağlar, bulunamayanı yeni üye olarak ekler.'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 2 — FILE */}
      {step === 'file' ? (
        <Section title="Dosyayı yükleyin">
          <StepNote>
            Excel (.xlsx) veya CSV. Dosya yalnızca okunur — bu adımda hiçbir şey kaydedilmez.
          </StepNote>
          <Input
            type="file"
            accept=".xlsx,.csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
            className="max-w-md"
          />
          {busy ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Okunuyor…</p> : null}
          <div className="mt-4">
            <Button variant="outline" onClick={() => setStep('kind')} className="min-h-11">Geri</Button>
          </div>
        </Section>
      ) : null}

      {/* 3 — HEADER ROW */}
      {step === 'header' ? (
        <Section title="Başlık hangi satırda?">
          <StepNote>
            Excel dosyalarında başlık çoğu zaman ilk satırda olmaz — üstte stüdyo adı, boş satır veya
            tarih bulunur. Aşağıdan başlık satırını seçin; altındaki satırlar veri kabul edilir.
          </StepNote>
          {truncated ? (
            <p className="mb-3 flex items-center gap-2 text-sm text-warning">
              <AlertTriangleIcon className="size-4" /> Dosya çok uzun; ilk 5.000 satır okundu.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[600px] text-sm">
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr
                    key={i}
                    onClick={() => setHeaderRowIndex(i)}
                    className={`cursor-pointer border-b last:border-0 ${i === headerRowIndex ? 'bg-accent/10' : 'hover:bg-muted/40'}`}
                  >
                    <td className="w-16 px-3 py-2 tabular-nums text-muted-foreground">
                      {i === headerRowIndex ? <Badge>başlık</Badge> : i + 1}
                    </td>
                    {r.slice(0, 8).map((c, j) => (
                      <td key={j} className="max-w-[180px] truncate px-3 py-2">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setStep('file')} className="min-h-11">Geri</Button>
            <Button onClick={() => void toMapping()} disabled={busy} className="min-h-11">
              {busy ? <Loader2Icon className="animate-spin" /> : null} Devam
            </Button>
          </div>
        </Section>
      ) : null}

      {/* 4 — MAPPING */}
      {step === 'mapping' ? (
        <Section title="Sütunları eşleştirin">
          <StepNote>
            Solda bizim alanlarımız, sağda sizin dosyanızdaki sütunlar. Başlıklara bakarak bir öneri
            hazırladım — hepsini değiştirebilirsiniz. Eşleşmeyen sütun kalması normaldir.
          </StepNote>
          <MappingStep
            fields={fields}
            header={header}
            sample={sample}
            mapping={mapping}
            onChange={(k, i) => setMapping((m) => ({ ...m, [k]: i }))}
          />
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setStep('header')} className="min-h-11">Geri</Button>
            <Button onClick={() => void runPreview(kind === 'members' ? 'preview' : 'match')} disabled={busy} className="min-h-11">
              {busy ? <Loader2Icon className="animate-spin" /> : null} Devam
            </Button>
          </div>
        </Section>
      ) : null}

      {/* 5 — GAPS */}
      {step === 'gaps' && preview ? (
        <Section title="Eksik alanları doldurun">
          <StepNote>
            Dosyanızda bu alanlar için sütun yok. Buraya yazdığınız değer <strong>her satır için</strong>{' '}
            kullanılır — sadece herkes için aynı olan bir şeyse doldurun, değilse geri dönüp sütun
            eşleştirin.
          </StepNote>
          <div className="max-w-md space-y-3">
            {preview.missing.map((key) => {
              const f = fields.find((x) => x.key === key)
              return (
                <div key={key}>
                  <label className="text-sm font-medium">{f?.label ?? key}</label>
                  {f?.hint ? <p className="mb-1 text-xs text-muted-foreground">{f.hint}</p> : null}
                  <Input
                    value={defaults[key] ?? ''}
                    onChange={(e) => setDefaults((v) => ({ ...v, [key]: e.target.value }))}
                    className="min-h-11"
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setStep('mapping')} className="min-h-11">Geri</Button>
            <Button onClick={() => void runPreview(kind === 'members' ? 'preview' : 'match')} disabled={busy} className="min-h-11">
              {busy ? <Loader2Icon className="animate-spin" /> : null} Devam
            </Button>
          </div>
        </Section>
      ) : null}

      {/* 6 — MATCH */}
      {step === 'match' && preview?.packages ? (
        <Section title="Bu paketler kime gidiyor?">
          <StepNote>
            Telefonu eşleşen satırlar burada görünmez — onlar kesin. Aşağıdakiler isimden{' '}
            <strong>önerildi</strong>, karar sizin.
          </StepNote>
          <MatchStep
            rows={preview.packages.ready.filter((r) => r.match.kind !== 'phone') as unknown as MatchRow[]}
            roster={preview.packages.roster}
            decisions={decisions}
            onChange={setDecisions}
          />
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setStep('mapping')} className="min-h-11">Geri</Button>
            <Button onClick={() => advance('preview', 'match')} className="min-h-11">Önizlemeye Geç</Button>
          </div>
        </Section>
      ) : null}

      {/* 7 — PREVIEW */}
      {step === 'preview' && preview ? (
        <PreviewStep
          preview={preview}
          decisions={decisions}
          busy={busy}
          onBack={() => setStep(kind === 'members' ? 'mapping' : 'match')}
          onApply={() => void apply()}
        />
      ) : null}
    </main>
  )
}

function PreviewStep({
  preview,
  decisions,
  busy,
  onBack,
  onApply,
}: {
  preview: Preview
  decisions: Record<number, Decision>
  busy: boolean
  onBack: () => void
  onApply: () => void
}) {
  const members = preview.members
  const packages = preview.packages

  const skipped = Object.values(decisions).filter((d) => d.skip).length
  const blockedRows = (packages?.ready ?? []).filter(
    (r) => decisions[r.line]?.skip !== true && r.match.kind !== 'phone' && (decisions[r.line]?.memberId ?? null) === null && r.needsPhoneToCreate,
  ).length
  // The headline number counts only what will actually land. A count that includes rows the apply
  // step will refuse is a promise the next screen breaks.
  const willCreate = members
    ? members.ready.filter((r) => !r.duplicateOf).length
    : (packages?.ready.length ?? 0) - skipped - blockedRows
  const rejected = (members?.rejected.length ?? 0) + (packages?.rejected.length ?? 0)
  const duplicates = members?.ready.filter((r) => r.duplicateOf).length ?? 0

  return (
    <Section title="Son kontrol">
      <StepNote>
        Aşağıdakiler <strong>henüz kaydedilmedi</strong>. Kaydet dediğinizde sisteme girecek olan tam
        olarak bu liste.
      </StepNote>

      <MetricStrip>
        <Metric label={members ? 'Eklenecek üye' : 'Eklenecek paket'} value={String(willCreate)} />
        {duplicates > 0 ? <Metric label="Zaten kayıtlı" value={String(duplicates)} /> : null}
        {skipped > 0 ? <Metric label="Atlanacak" value={String(skipped)} /> : null}
        {blockedRows > 0 ? <Metric label="Telefonsuz" value={String(blockedRows)} tone="danger" /> : null}
        {rejected > 0 ? (
          <Metric label="Reddedilen satır" value={String(rejected)} tone="danger" />
        ) : (
          <Metric label="Reddedilen satır" value="0" />
        )}
      </MetricStrip>

      {packages && packages.unknownProducts.length > 0 ? (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
          <p className="font-medium text-danger">Katalogda bulunamayan paket adları</p>
          <p className="mt-1 text-muted-foreground">
            Bu satırlar aktarılmayacak. Ya Excel’deki adı katalogdakiyle birebir aynı yazın, ya da
            paketi önce Paketler ekranından oluşturun.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {packages.unknownProducts.map((n) => <Badge key={n} variant="outline">{n}</Badge>)}
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Satır</th>
              <th className="px-3 py-2 text-left font-medium">Kim</th>
              {packages ? <th className="px-3 py-2 text-left font-medium">Paket</th> : null}
              {packages ? <th className="px-3 py-2 text-left font-medium">Kalan</th> : null}
              {packages ? <th className="px-3 py-2 text-left font-medium">Bitiş</th> : null}
              <th className="px-3 py-2 text-left font-medium">Ne olacak</th>
            </tr>
          </thead>
          <tbody>
            {members?.ready.map((r) => (
              <tr key={r.line} className="border-t">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
                <td className="px-3 py-2">{r.draft.fullName}<div className="text-xs text-muted-foreground">{r.phoneE164}</div></td>
                <td className="px-3 py-2">
                  {r.duplicateOf ? (
                    <span className="text-warning">Zaten kayıtlı — atlanacak</span>
                  ) : (
                    <span className="text-success">Yeni üye eklenecek</span>
                  )}
                </td>
              </tr>
            ))}
            {packages?.ready.map((r) => {
              const dec = decisions[r.line]
              const skip = dec?.skip === true
              const toExisting = r.match.kind === 'phone' || (dec?.memberId ?? null) !== null
              // Would create a member and has no phone to create her with. The apply step refuses
              // this row; saying so HERE is the difference between an informed choice and a
              // surprise in the failure list.
              const blocked = !skip && !toExisting && r.needsPhoneToCreate
              return (
                <tr key={r.line} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
                  <td className="px-3 py-2">{r.memberName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.productName}</td>
                  <td className="px-3 py-2 tabular-nums">{r.remainingCredits ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{d(r.validUntil)}</td>
                  <td className="px-3 py-2">
                    {skip ? (
                      <span className="text-muted-foreground">Atlanacak</span>
                    ) : toExisting ? (
                      <span className="text-success">Mevcut üyeye eklenecek</span>
                    ) : blocked ? (
                      <span className="text-danger">Telefon yok — yeni üye açılamaz</span>
                    ) : (
                      <span className="text-accent">Yeni üye + paket</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rejected > 0 ? (
        <div className="mt-4 rounded-xl border p-3">
          <p className="text-sm font-medium">Reddedilen satırlar ({rejected})</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {[...(members?.rejected ?? []), ...(packages?.rejected ?? [])].map((r) => (
              <li key={r.line}>
                <span className="tabular-nums">{r.line}.</span> {r.reason} <span className="opacity-60">— {r.preview}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onBack} className="min-h-11">Geri</Button>
        <Button onClick={onApply} disabled={busy || willCreate === 0} className="min-h-11">
          {busy ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} Kaydet ve İçeri Al
        </Button>
      </div>
    </Section>
  )
}
