import Link from 'next/link'

import { LEGAL_DOCS, LEGAL_UPDATED, SELLER } from '@/lib/legal'

// The shared frame every legal page wears: same header, same type scale, same footer index. It is a
// server component with no state, because a contract that needs JavaScript to be readable is a
// contract somebody cannot read.
//
// Mobile first (Doc 09 §9): one column, 15px body, generous line-height. Legal text is the longest
// reading anyone does on this site and most of them will do it on a phone, halfway through a checkout.

export function LegalSection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground sm:text-xl">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

/** A definition row — used for the seller's identity block and for package details. */
export function LegalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm font-medium text-muted-foreground sm:w-56">{label}</dt>
      <dd className="text-[15px] text-foreground">{children}</dd>
    </div>
  )
}

export function SellerIdentity() {
  return (
    <dl className="rounded-xl border border-border bg-muted/40 px-4 py-2">
      <LegalRow label="Ticari Unvan">{SELLER.legalName}</LegalRow>
      <LegalRow label="Marka">{SELLER.brand}</LegalRow>
      <LegalRow label="Adres">{SELLER.address}</LegalRow>
      <LegalRow label="Telefon">
        <a className="text-primary underline" href={`tel:${SELLER.phoneE164}`}>
          {SELLER.phone}
        </a>
      </LegalRow>
      <LegalRow label="E-posta">
        <a className="text-primary underline" href={`mailto:${SELLER.email}`}>
          {SELLER.email}
        </a>
      </LegalRow>
      <LegalRow label="Vergi Dairesi">{SELLER.taxOffice}</LegalRow>
      <LegalRow label="Vergi No">{SELLER.taxNumber}</LegalRow>
      <LegalRow label="MERSİS No">{SELLER.mersis}</LegalRow>
      <LegalRow label="Ticaret Sicil No">{SELLER.tradeRegistryNo}</LegalRow>
    </dl>
  )
}

const INDEX = [
  LEGAL_DOCS.privacy,
  LEGAL_DOCS.kvkk,
  LEGAL_DOCS.refund,
  LEGAL_DOCS.distance_sales,
  LEGAL_DOCS.preinfo,
  LEGAL_DOCS.health_consent,
]

export function LegalShell({
  title,
  version,
  children,
}: {
  title: string
  /** The document's own version, printed so a customer can name the text she read. */
  version?: string
  children: React.ReactNode
}) {
  return (
    // The page paints its OWN ground. These pages open from the dark panel, from the light marketing
    // site, and from an app-store reviewer's browser with no session at all; a transparent body
    // borrows whichever theme happens to be behind it, which is how a contract ended up as dark grey
    // text on a dark grey background.
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {/* The way out. A legal page is often the FIRST page somebody lands on — from a store
            listing, a footer link, a checkout — and until now it was a dead end with no way to the
            studio. `panel.` is the staff login for a visitor, so home is the public site. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
          <a
            href={SELLER.website}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <span aria-hidden>←</span> Ana sayfa
          </a>
          <a href={`tel:${SELLER.phoneE164}`} className="text-sm text-muted-foreground hover:text-foreground">
            {SELLER.phone}
          </a>
        </div>

        <header className="space-y-2 border-b border-border pb-6">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">{SELLER.brand}</p>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Son güncelleme: {LEGAL_UPDATED}
            {version ? ` · Sürüm ${version}` : ''}
          </p>
        </header>

        <div className="mt-8 space-y-9">{children}</div>

        <footer className="mt-14 border-t border-border pt-6">
          <p className="text-sm font-medium text-foreground">Diğer hukuki metinler</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {INDEX.map((d) => (
              <li key={d.key}>
                <Link href={d.path ?? '/'} className="text-[15px] text-primary underline underline-offset-2">
                  {d.title}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/iletisim" className="text-[15px] text-primary underline underline-offset-2">
                İletişim Bilgileri
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            {SELLER.legalName} · {SELLER.address}
            <br />
            <a className="underline" href={`tel:${SELLER.phoneE164}`}>
              {SELLER.phone}
            </a>{' '}
            ·{' '}
            <a className="underline" href={`mailto:${SELLER.email}`}>
              {SELLER.email}
            </a>{' '}
            ·{' '}
            <a className="underline" href={SELLER.website}>
              pilatesfitnessbyisil.com
            </a>
          </p>
          <p className="mt-4 text-sm text-muted-foreground">© 2026 {SELLER.brand}. Tüm hakları saklıdır.</p>
        </footer>
      </main>
    </div>
  )
}
