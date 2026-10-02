'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  bookReservationAction,
  exemptionOptionsAction,
  expiredCreditOptionsAction,
  type ExemptionOption,
  type ExpiredCreditOption,
} from '@/server/actions/reservations'

// SÜRESİ DOLMUŞ PAKETİN YANAN HAKKI (owner, 2026-09-01).
//
// *"Paket süresi biten üyenin kredisi kalınca bazen Işıl bu üyeye süre de vermeden direkt o kredisine
// binaen bir ders rezerve etmek istiyor."*
//
// Süre eklemek paketi bir ay daha açar; bir ders saydırmak yalnızca o dersi verir. İkincisi hem daha
// az, hem daha dürüst — ve masanın gerçekten istediği o.
//
// AKIŞ, ve sırası owner'ın kuralı: **aktif ve bu dersi ödeyebilen paketi varsa hiçbir şey sorulmaz.**
// Rezervasyon normal yolundan gider, kredi normal düşer. Diyalog yalnızca o yol tıkandığında,
// ve yalnızca ortada gerçekten yanmış hak varsa açılır.
//
// Üç yerden rezervasyon yapılıyor (hızlı rezervasyon, üye kartı, ders paneli). Bu parça ortak, çünkü
// üç kopya üç farklı davranış demektir — ve bu, kredi defterine dokunan bir davranış.

export type BookOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly error: unknown }
  /** Yanan hak seçenekleri var: çağıran `<ExpiredCreditDialog>` gösterir. */
  | { readonly kind: 'choose'; readonly options: readonly ExpiredCreditOption[] }
  /** Aşılabilir bir engel var: çağıran `<CreditExemptionDialog>` gösterir (owner, 2026-10-02). */
  | { readonly kind: 'exempt'; readonly error: unknown; readonly options: readonly ExemptionOption[] }

// Yanmış hakla çözülen engeller: "bu dersi ödeyecek paket yok" ailesi. Dolu ders, kategori
// uyuşmazlığı ya da mükerrer rezervasyon başka şeylerdir ve yanmış hakla çözülmezler.
const YANAN_HAK_AILESI = new Set(['no_bookable_entitlement', 'entitlement_not_active', 'insufficient_credits'])

// ── İNİSİYATİFLE AŞILABİLİR ENGELLER (owner, 2026-10-02) ────────────────────────────────────
//
// Hepsi stüdyonun KENDİ koyduğu kurallar: paketin süresi, kredi, günlük/haftalık hak, gün/saat/
// eğitmen kısıtı. Listede olmayanlar bilerek yok — `class_full` odadaki alet sayısı,
// `category_mismatch` yanlış oda, `already_booked` aynı kişiyi iki kez yazmak, geçmiş ders ise
// kendi kapısından (backdating) geçiyor. Domain de bu listeyi `ExemptableGuard` olarak tutuyor;
// ikisi birlikte genişler.
const ISTISNA_EDILEBILIR = new Set([
  'no_bookable_entitlement',
  'entitlement_not_active',
  'entitlement_expires_before_session',
  'insufficient_credits',
  'day_not_allowed',
  'time_not_allowed',
  'trainer_not_allowed',
  'daily_reservation_limit_reached',
  'active_reservation_limit_reached',
  'weekly_quota_reached',
])

/**
 * Rezervasyonu normal yolundan dener; tıkanırsa masaya sırayla iki soru sorar.
 *
 * SIRA ÖNEMLİ: önce yanan hak (owner, 2026-09-01), sonra inisiyatifli istisna (2026-10-02). Çünkü
 * ilki DAHA AZINI yapıyor — üyenin kendi yanmış hakkından bir ders saydırmak, kuralı esnetmek
 * değil hakkını kullandırmaktır. İstisna, gerçekten alınacak hak kalmadığında devreye girer.
 */
export async function bookOrOfferExpiredCredit(
  memberId: string,
  sessionId: string,
  // Masa paketi açıkça seçtiyse onunla denenir. Engel (süre, kredi, günlük/haftalık hak) seçili
  // pakette de çıkabiliyor, ve çıktığında sorulacak soru aynı.
  entitlementId?: string | null,
): Promise<BookOutcome> {
  const res = await bookReservationAction({
    memberId,
    sessionId,
    ...(entitlementId ? { entitlementId } : {}),
  })
  if (res.ok) return { kind: 'ok' }
  const code = (res.error as { code?: string } | undefined)?.code ?? ''

  if (YANAN_HAK_AILESI.has(code)) {
    const { aktifVar, secenekler } = await expiredCreditOptionsAction({ memberId, sessionId })
    if (!aktifVar && secenekler.length > 0) return { kind: 'choose', options: secenekler }
  }

  if (ISTISNA_EDILEBILIR.has(code)) {
    try {
      const options = await exemptionOptionsAction({ memberId, sessionId })
      if (options.length > 0) return { kind: 'exempt', error: res.error, options }
    } catch {
      // Yetkisi olmayan (eğitmen) buraya düşer ve engelin kendi mesajını görür — owner'ın
      // *"1 bende ve resepisyonda olsun"* kuralı, sessizce yutulan bir hata değil.
    }
  }
  return { kind: 'error', error: res.error }
}

const gun = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

export function ExpiredCreditDialog({
  memberId,
  sessionId,
  memberName,
  options,
  onDone,
  onClose,
}: {
  memberId: string
  sessionId: string
  memberName: string
  options: readonly ExpiredCreditOption[]
  onDone: () => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string | null>(options.length === 1 ? (options[0]?.entitlementId ?? null) : null)
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  async function onayla() {
    if (!chosen) return
    setBusy(true)
    setHata(null)
    try {
      const res = await bookReservationAction({
        memberId,
        sessionId,
        entitlementId: chosen,
        honourExpiredCredit: true,
      })
      if (res.ok) onDone()
      else setHata('Rezervasyon yapılamadı. Paketi ve dersi kontrol edin.')
    } catch {
      setHata('İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aktif paketi yok — yanan hakkı kullanılsın mı?</DialogTitle>
          <DialogDescription>
            {memberName} bu dersi ödeyebilecek aktif bir pakete sahip değil. Süresi dolmuş paketlerinde
            kullanılmadan yanan hakları var; bu dersi hangisine sayalım?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {options.map((o) => (
            <label
              key={o.entitlementId}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                chosen === o.entitlementId ? 'border-primary bg-primary-soft/40' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <input
                type="radio"
                name="yanan-hak"
                checked={chosen === o.entitlementId}
                onChange={() => setChosen(o.entitlementId)}
                className="size-4 shrink-0 accent-[var(--color-primary)]"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{o.productName}</div>
                <div className="text-xs text-muted-foreground">{gun(o.validUntil)} tarihinde doldu</div>
              </div>
              <span className="ml-auto shrink-0 text-right">
                <b className="block text-[15px] tabular-nums text-foreground">{o.yananHak}</b>
                {/* "kalan kredi" DEĞİL. Süre dolarken krediler yandı; ekranda "3 kredi" yazmak
                    olmayan bir bakiye göstermek olurdu. */}
                <span className="block text-[11px] text-muted-foreground">yanan ders</span>
              </span>
            </label>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Seçtiğin paketten <b className="text-foreground">bir ders</b> geri verilip bu rezervasyona sayılır.
          Paketin süresi uzamaz, kalan yanık dersler yanık kalır. İşlem sebebiyle birlikte kayda geçer.
        </p>
        {hata ? <p className="text-sm text-danger">{hata}</p> : null}

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void onayla()} disabled={busy || !chosen}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Bu derse say ve rezerve et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
