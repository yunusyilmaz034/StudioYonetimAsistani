'use client'

import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { formatTimeWithSeconds } from '@/lib/datetime'
import { loadHealthAction, type HealthScreenReport } from '@/server/actions/health'

// SİSTEM UYARILARI (v1.27 S7).
//
// Five things in this system can break **without anything looking broken**: a check-in that never
// landed, a dashboard quietly showing yesterday, a class that silently refuses members it has room
// for, a credit ledger that stopped adding up, a package about to expire while still holding a
// credit. None of them raises an error. Until today none of them reached a human who could act.
//
// So each alert is written the way the owner would say it out loud, and each one says WHAT TO DO.
// A warning that names a symptom and stops is a warning that gets ignored twice and then hidden.
//
// There is no "fix it" button, and there will not be one. A drift is not a number to be corrected —
// it is the evidence that a write path bypassed a transaction, and repairing it destroys the only
// proof that anything went wrong.

interface Copy {
  readonly title: string
  readonly what: string
  readonly todo: string
}

const COPY: Record<string, Copy> = {
  commands_stuck: {
    title: 'Kaydedilmemiş check-in var',
    what: 'Resepsiyonun ekranı "girdi" dedi ama kayıt sisteme düşmedi. Bu üyeler bugün gelmiş görünmüyor.',
    todo: 'Hemen bize haber verin. Bu arada gelen üyeleri elle işaretlemeye devam edin.',
  },
  projection_lag: {
    title: 'Gösterge paneli geride kalmış',
    what: 'Genel Görünüm’deki sayılar güncel değil. Ekran bunu size söylemez — olduğu gibi gösterir.',
    todo: 'Bugünkü kararları bu sayılara dayandırmayın. Raporlar ekranı doğrudan kayıtlardan okur, o güvenilir.',
  },
  booked_count_drift: {
    title: 'Bir dersin kontenjan sayacı tutmuyor',
    what: 'Ders, yeri olduğu hâlde üye kabul etmiyor olabilir — ya da kapasitesinin üstünde doluyor olabilir.',
    todo: 'Aşağıdaki dersleri kontrol edin ve bize bildirin. Rezervasyon almaya devam edebilirsiniz.',
  },
  credit_ledger_drift: {
    title: 'Bir üyenin kredi hesabı tutmuyor',
    what: 'Kalan ders sayısı, hareketlerin toplamıyla uyuşmuyor. Bu bir veri hatası değil, bir yazılım hatasıdır.',
    todo: 'Bize bildirin. Sayıyı elle düzeltmeyin — düzeltmek, hatanın tek kanıtını siler.',
  },
  expiring_with_held: {
    title: 'Bitmek üzere olan pakette bekleyen ders var',
    what: 'Paketin süresi doluyor ama üzerinde henüz sonuçlanmamış bir rezervasyon duruyor.',
    todo: 'Bu üyelerin yoklamasını bugün işaretleyin; aksi hâlde kredi paketle birlikte kapanır.',
  },
}

export function SystemAlerts() {
  const [report, setReport] = useState<HealthScreenReport | null>(null)
  const [busy, setBusy] = useState(true)

  const run = useCallback(async () => {
    setBusy(true)
    try {
      setReport(await loadHealthAction())
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const findings = report?.findings ?? []
  const critical = findings.filter((f) => f.severity === 'critical').length

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Sistem uyarıları</h2>
        <div className="flex items-center gap-2">
          {report ? (
            <span className="text-xs text-muted-foreground">
              {formatTimeWithSeconds(report.checkedAt)} itibarıyla
            </span>
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
            <RefreshCwIcon className={busy ? 'animate-spin' : ''} />
            <span className="sr-only">Yenile</span>
          </Button>
        </div>
      </div>

      {/* Normal is QUIET, abnormal is LOUD (Doc 20). But quiet is not silent: a monitor you only ever
          hear from when it is angry is one you cannot tell apart from a broken one. */}
      {!busy && findings.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
          <CheckCircle2Icon className="size-4 text-success" />
          <span>Her şey yolunda. Beş kontrolün beşi de temiz.</span>
        </div>
      ) : null}

      {findings.map((f) => {
        const copy = COPY[f.alert]
        const bad = f.severity === 'critical'
        return (
          <div
            key={f.alert}
            className={`rounded-xl border p-4 shadow-sm ${
              bad ? 'border-danger/30 bg-danger/5' : 'border-warning/30 bg-warning/5'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertTriangleIcon
                className={`mt-0.5 size-5 shrink-0 ${bad ? 'text-danger' : 'text-warning'}`}
              />
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${bad ? 'text-danger' : 'text-warning'}`}>
                  {copy?.title ?? f.alert}
                  {f.count > 1 ? ` (${f.count})` : ''}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{copy?.what}</p>
                <p className="mt-1 text-sm font-medium">{copy?.todo}</p>
                {f.detail ? (
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                ) : null}
                {f.ids.length > 0 ? (
                  <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
                    {f.ids.join(' · ')}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      {critical > 0 ? (
        <p className="text-xs text-muted-foreground">
          Bu uyarılar düzeltilmez, yalnızca bildirilir: bir sayıyı sessizce düzeltmek, hatanın tek
          kanıtını silmek olur.
        </p>
      ) : null}
    </section>
  )
}
