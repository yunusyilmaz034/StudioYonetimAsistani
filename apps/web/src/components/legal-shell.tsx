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
      <h2 className="text-lg font-semibold text-neutral-900 sm:text-xl">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-neutral-700">{children}</div>
    </section>
  )
}

/** A definition row — used for the seller's identity block and for package details. */
export function LegalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-neutral-100 py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm font-medium text-neutral-500 sm:w-56">{label}</dt>
      <dd className="text-[15px] text-neutral-800">{children}</dd>
    </div>
  )
}

export function SellerIdentity() {
  return (
    <dl className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-2">
      <LegalRow label="Ticari Unvan">{SELLER.legalName}</LegalRow>
      <LegalRow label="Marka">{SELLER.brand}</LegalRow>
      <LegalRow label="Adres">{SELLER.address}</LegalRow>
      <LegalRow label="Telefon">
        <a className="text-[#7A1F3D] underline" href={`tel:${SELLER.phoneE164}`}>
          {SELLER.phone}
        </a>
      </LegalRow>
      <LegalRow label="E-posta">
        <a className="text-[#7A1F3D] underline" href={`mailto:${SELLER.email}`}>
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
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <header className="space-y-2 border-b border-neutral-200 pb-6">
        <Link href="/iletisim" className="text-sm font-medium tracking-wide text-[#7A1F3D] uppercase">
          {SELLER.brand}
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">{title}</h1>
        <p className="text-sm text-neutral-500">
          Son güncelleme: {LEGAL_UPDATED}
          {version ? ` · Sürüm ${version}` : ''}
        </p>
      </header>

      <div className="mt-8 space-y-9">{children}</div>

      <footer className="mt-14 border-t border-neutral-200 pt-6">
        <p className="text-sm font-medium text-neutral-900">Diğer hukuki metinler</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {INDEX.map((d) => (
            <li key={d.key}>
              <Link href={d.path ?? '/'} className="text-[15px] text-[#7A1F3D] underline underline-offset-2">
                {d.title}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/iletisim" className="text-[15px] text-[#7A1F3D] underline underline-offset-2">
              İletişim Bilgileri
            </Link>
          </li>
        </ul>
        <p className="mt-6 text-sm text-neutral-500">
          {SELLER.legalName} · {SELLER.address} ·{' '}
          <a className="underline" href={`tel:${SELLER.phoneE164}`}>
            {SELLER.phone}
          </a>{' '}
          ·{' '}
          <a className="underline" href={`mailto:${SELLER.email}`}>
            {SELLER.email}
          </a>
        </p>
      </footer>
    </main>
  )
}
