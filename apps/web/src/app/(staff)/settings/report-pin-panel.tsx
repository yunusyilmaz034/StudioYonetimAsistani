'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LockIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { changeReportPinAction, reportPinStatusAction } from '@/server/actions/report-pin'

// AYARLAR → RAPOR PIN'İ (owner, 2026-09-30).
//
// Bu kart PIN'i GÖSTERMEZ, yalnızca değiştirir. Owner'ın kararı: *"eskisini söylemesin, böylece
// gizlilik sağlanmış olur; biri değiştirirse zaten bilgi okunmuş anlamına gelir, o ayrı bir
// mesele."* Yani burada "mevcut PIN" bir bilgi değil, bir KANITTIR — bilen kişi değiştirebilir.
//
// Değişiklik owner'ın e-postasına haber gidiyor ve kalıcı olarak kaydediliyor (ne zaman, kim —
// PIN'in kendisi hiçbir yere yazılmıyor).
export function ReportPinPanel({ canEdit }: { canEdit: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [varsayilan, setVarsayilan] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void reportPinStatusAction()
      .then((s) => setVarsayilan(s.varsayilan))
      .catch(() => setVarsayilan(false))
  }, [])

  async function save() {
    if (next !== again) {
      toast.error('Yeni PIN iki alanda aynı değil.')
      return
    }
    setBusy(true)
    try {
      const res = await changeReportPinAction({ current, next })
      if (res.ok) {
        toast.success('Rapor PIN’i değiştirildi. E-posta ile haber verildi.')
        setCurrent('')
        setNext('')
        setAgain('')
        setVarsayilan(false)
      } else {
        toast.error(res.code === 'weak_pin' ? 'PIN altı haneli bir sayı olmalı.' : 'Mevcut PIN doğru değil.')
      }
    } catch {
      toast.error('Değiştirilemedi. Tekrar deneyin.')
    }
    setBusy(false)
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <LockIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Rapor PIN&apos;i</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Raporlar ekranı bu PIN ile açılır. Oturumun açık kalsa bile, ekranı açan kişinin sen olduğunu
        doğrular. PIN burada gösterilmez — yalnızca değiştirilir.
      </p>

      {varsayilan ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bu PIN hiç değiştirilmedi. Kendi PIN&apos;ini belirlemeden kilit gerçekten kurulmuş sayılmaz.
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Mevcut PIN"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={!canEdit || busy}
        />
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Yeni PIN (6 hane)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={!canEdit || busy}
        />
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Yeni PIN (tekrar)"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          disabled={!canEdit || busy}
        />
      </div>

      <div className="mt-3">
        <Button onClick={() => void save()} disabled={!canEdit || busy || current === '' || next === '' || again === ''}>
          {busy ? 'Kaydediliyor…' : 'PIN’i değiştir'}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Değişiklik e-posta adresine bildirilir ve kaydı tutulur. E-postada PIN yer almaz.
      </p>
    </section>
  )
}
