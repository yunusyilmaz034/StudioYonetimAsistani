'use client'

import { PrinterIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RECEIPT_KIND_TR, type ReceiptData } from '@/lib/receipt'

// The slip itself.
//
// It is designed to be READ BY A MEMBER STANDING AT A DESK, and then folded into a bag. So: one
// column, big numbers where the money is, no colour that a black-and-white printer will turn to mud,
// and the disclaimer where the eye lands last.
//
// `@media print` strips the app around it. What comes out of the printer is the slip, and nothing
// else — no navigation, no button, no URL bar full of a session id.

const tl = (kurus: number) =>
  `${(kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`

const date = (ms: number) =>
  new Date(ms).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const METHOD_TR: Record<string, string> = {
  cash: 'Nakit',
  credit_card: 'Kredi kartı',
  bank_transfer: 'Havale / EFT',
  pos: 'POS',
  gift_card: 'Hediye kartı',
  online: 'Online',
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground print:text-black">{label}</span>
      <span className={`text-right tabular-nums ${strong ? 'text-lg font-semibold' : 'text-sm font-medium'}`}>
        {value}
      </span>
    </div>
  )
}

export function ReceiptView({ data }: { data: ReceiptData }) {
  const c = data.company

  return (
    <>
      {/* Everything in this block disappears when the slip is printed. */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-muted-foreground">
          Yazdır veya PDF olarak kaydet. Bu belge mali belge değildir.
        </p>
        <Button onClick={() => window.print()}>
          <PrinterIcon className="size-4" />
          Yazdır
        </Button>
      </div>

      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* ── The studio, from ONE source (settings/studio) ─────────────────────────────── */}
        <header className="border-b border-border pb-4 text-center">
          <h1 className="text-h2 font-semibold">{c.displayName}</h1>
          {c.legalName && c.legalName !== c.displayName ? (
            <p className="text-sm text-muted-foreground print:text-black">{c.legalName}</p>
          ) : null}
          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground print:text-black">
            {c.address ? <p>{c.address}</p> : null}
            <p>
              {[c.phone, c.email, c.website].filter(Boolean).join(' · ')}
            </p>
          </div>
        </header>

        {/* ── What this slip is about ───────────────────────────────────────────────────── */}
        <section className="border-b border-border py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-h3 font-semibold">{RECEIPT_KIND_TR[data.kind]}</span>
            <span className="text-sm tabular-nums text-muted-foreground print:text-black">
              {dateTime(data.issuedAt)}
            </span>
          </div>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground print:text-black">Üye: </span>
            <span className="font-medium">{data.memberName}</span>
          </p>
        </section>

        {/* ── The package ───────────────────────────────────────────────────────────────── */}
        <section className="border-b border-border py-2">
          <Line label="Paket" value={data.productName} />
          {data.durationDays !== null ? (
            <Line label="Paket süresi" value={`${data.durationDays} gün`} />
          ) : null}

          {data.creditsGranted !== null ? (
            <>
              <Line label="Satın alınan ders" value={`${data.creditsGranted}`} />
              <Line label="Kullanılan ders" value={`${data.creditsUsed}`} />
              {/* The number she came here to find out. */}
              <Line label="Kalan ders" value={`${data.creditsRemaining}`} strong />
            </>
          ) : (
            <Line label="Kapsam" value="Sınırsız" />
          )}

          <Line
            label="Geçerlilik"
            value={`${date(data.validFrom)} – ${date(data.validUntil)}`}
          />
        </section>

        {/* ── The money ─────────────────────────────────────────────────────────────────── */}
        <section className="border-b border-border py-2">
          <Line label="Paket tutarı" value={tl(data.priceKurus)} />
          {data.method ? (
            <Line label="Ödeme yöntemi" value={METHOD_TR[data.method] ?? data.method} />
          ) : null}
          <Line label="Ödenen tutar" value={tl(data.paidKurus)} strong />
          {/* Shown ONLY when she owes something. A "0,00 ₺ kalan borç" line on a paid-in-full receipt
              plants a doubt that is not there. */}
          {data.balanceKurus > 0 ? (
            <Line label="Kalan bakiye" value={tl(data.balanceKurus)} strong />
          ) : null}
        </section>

        {data.note ? (
          <section className="border-b border-border py-3">
            <p className="text-sm text-muted-foreground print:text-black">Açıklama</p>
            <p className="mt-0.5 text-sm">{data.note}</p>
          </section>
        ) : null}

        {/* ── The disclaimer. Large, last, and unmissable. ──────────────────────────────── */}
        <footer className="pt-5 text-center">
          <p className="text-base font-bold uppercase tracking-wide">
            Bu belge mali belge değildir.
          </p>
          <p className="mt-1 text-sm text-muted-foreground print:text-black">
            İşlem özeti amacıyla düzenlenmiştir.
          </p>
        </footer>
      </div>
    </>
  )
}
