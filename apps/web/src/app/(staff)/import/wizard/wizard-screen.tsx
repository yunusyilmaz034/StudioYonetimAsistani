'use client'

import { useEffect, useState } from 'react'
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

import { AliasStep, ALIAS_SKIP, type UnknownLabel } from './alias-step'
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

// ── THE WORK SURVIVES A RELOAD (2026-07-30) ─────────────────────────────────────────────────
//
// The matching step is the long one: seventy-odd rows, each confirmed by hand. The owner had done
// most of it when a deploy landed underneath him, his tab went stale, and every answer went with it.
// He had to start over — and starting over is the reason people abandon an import and go back to
// typing members in one at a time.
//
// So the wizard keeps its state in sessionStorage and offers it back. Session, not local: this is a
// half-finished job on one desk, not a preference, and it should not outlive the browser window.
// The file's own rows are kept too, because re-picking the file is the one step that cannot be
// restored from anything else.
const DRAFT_KEY = 'import-wizard-draft-v1'

interface Draft {
  kind: Kind | null
  fileName: string
  rows: readonly (readonly string[])[]
  headerRowIndex: number
  mapping: Record<string, number | null>
  defaults: Record<string, string>
  aliases: Record<string, string>
  decisions: Record<number, Decision>
  step: StepKey
  savedAt: number
}

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
  // File label → productId ('' or ALIAS_SKIP means: skip those rows).
  const [aliases, setAliases] = useState<Record<string, string>>({})

  // "Bu satırları atla" is a decision the SCREEN remembers, not a product. Sending it to the server
  // would have it looked up as a product id and fail as "paket bulunamadı" — technically the right
  // outcome, arrived at by the wrong route and reported with the wrong words. Stripped here, so
  // those rows are simply rejected as an unmatched package, which is exactly what they are.
  const sentAliases = Object.fromEntries(
    Object.entries(aliases).filter(([, v]) => v && v !== ALIAS_SKIP),
  )
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyWizardAction>> | null>(null)

  const [restorable, setRestorable] = useState<Draft | null>(null)

  // Offer, never impose. A draft silently reapplied is a wizard that seems to remember the wrong
  // file, and the operator has no way to tell what she is looking at.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      if (d.rows?.length) setRestorable(d)
    } catch {
      // A draft we cannot read is a draft we do not have. Nothing here is worth an error for.
    }
  }, [])

  // Saved on every change once a file is loaded. Cheap, and the alternative is what happened today.
  useEffect(() => {
    if (rows.length === 0) return
    try {
      const draft: Draft = {
        kind, fileName, rows, headerRowIndex, mapping, defaults, aliases, decisions, step,
        savedAt: Date.now(),
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Over quota on a very large file. The import still works; only the safety net is gone.
    }
  }, [kind, fileName, rows, headerRowIndex, mapping, defaults, aliases, decisions, step])

  function restore(d: Draft) {
    setKind(d.kind)
    setFileName(d.fileName)
    setRows(d.rows)
    setHeaderRowIndex(d.headerRowIndex)
    setMapping(d.mapping)
    setDefaults(d.defaults)
    setAliases(d.aliases)
    setDecisions(d.decisions)
    setRestorable(null)
    // Back to mapping rather than where she left off: the preview must be recomputed on the server
    // before it can be trusted, and showing a restored preview as if it were fresh would be a lie.
    setStep('mapping')
  }

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
      const res = await previewWizardAction({ kind, rows, mapping, defaults, aliases: sentAliases, headerRowIndex })
      setPreview(res)
      if (res.missing.length > 0) {
        setStep('gaps')
        return
      }
      // Package labels the catalogue does not know. Asked ONCE per distinct label rather than
      // rejecting every row that uses it — the real export writes "6 AY", not a product name.
      //
      // The guard is "am I already there", not "where am I going". The first version compared
      // against the DESTINATION, which from the alias step is always 'match' — so an answered file
      // bounced straight back to the alias step, for ever, with nothing on screen to explain it.
      if (res.unknown.length > 0 && step !== 'alias') {
        advance('alias', 'mapping')
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
        aliases: sentAliases,
        headerRowIndex,
        branchId,
        resolutions: Object.values(decisions),
      })
      setResult(res)
      // Done means done — a finished import must not be offered back on the next visit.
      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clean up */ }
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

  const skipSteps: StepKey[] = kind === 'members' ? ['match', 'alias'] : []

  return (
    <main className={PAGE}>
      <PageHeader title="Aktarım Sihirbazı" description={fileName || undefined} />
      <StepBar current={step} done={done} skip={skipSteps} />

      {restorable && rows.length === 0 ? (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm font-medium">Yarım kalmış bir aktarım var</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong>{restorable.fileName}</strong> — {restorable.rows.length} satır,{' '}
            {Object.keys(restorable.decisions).length} karar verilmiş.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => restore(restorable)} className="min-h-11">Kaldığım yerden devam et</Button>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* already gone */ }
                setRestorable(null)
              }}
            >
              Baştan başla
            </Button>
          </div>
        </div>
      ) : null}

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

      {/* 4b — PACKAGE LABELS */}
      {step === 'alias' && preview ? (
        <Section title="Paket adlarını eşleştirin">
          <StepNote>
            Dosyanızdaki paket adları katalogdakiyle birebir aynı olmak zorunda değil. Her adı bir kez
            seçin — o ada sahip bütün satırlara uygulanır.
          </StepNote>
          <AliasStep
            unknown={preview.unknown as unknown as UnknownLabel[]}
            products={preview.catalogueOptions}
            aliases={aliases}
            onChange={setAliases}
          />
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setStep('mapping')} className="min-h-11">Geri</Button>
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
            activePackages={preview.activePackages}
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
  // Still blocked = would create a member, the file gave no phone, and none was typed either.
  const blockedRows = (packages?.ready ?? []).filter((r) => {
    const d = decisions[r.line]
    if (d?.skip === true) return false
    if (r.match.kind === 'phone' || (d?.memberId ?? null) !== null) return false
    return r.needsPhoneToCreate && !(d?.phone ?? '').trim()
  }).length
  // The headline number counts only what will actually land. A count that includes rows the apply
  // step will refuse is a promise the next screen breaks.
  const willCreate = members
    ? members.ready.filter((r) => !r.duplicateOf).length
    : (packages?.ready.length ?? 0) - skipped - blockedRows
  const rejected = (members?.rejected.length ?? 0) + (packages?.rejected.length ?? 0)

  // Rows landing on a member who already holds a live package. Usually a duplicate — and also
  // exactly what a renewal looks like — so it is counted and shown, never refused.
  const ownerOf = (r: { line: number; match: { kind: string; memberId?: string } }): string | null =>
    r.match.kind === 'phone' ? (r.match.memberId ?? null) : (decisions[r.line]?.memberId ?? null)
  const alreadyHas = (packages?.ready ?? []).filter((r) => {
    if (decisions[r.line]?.skip === true) return false
    const id = ownerOf(r as never)
    return id != null && Boolean(preview.activePackages[id])
  }).length
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
        {alreadyHas > 0 ? <Metric label="Zaten paketi var" value={String(alreadyHas)} tone="warning" /> : null}
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
              const blocked = !skip && !toExisting && r.needsPhoneToCreate && !(dec?.phone ?? '').trim()
              return (
                <tr key={r.line} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
                  <td className="px-3 py-2">
                    {r.memberName}
                    {(() => {
                      const id = ownerOf(r as never)
                      const has = id ? preview.activePackages[id] : null
                      return has ? <div className="text-xs text-warning">zaten var: {has}</div> : null
                    })()}
                  </td>
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
