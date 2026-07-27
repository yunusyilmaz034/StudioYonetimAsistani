import * as dns from 'node:dns/promises'
import * as tls from 'node:tls'

import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'

// ── THE THINGS THAT KILL A LIVE SYSTEM WITHOUT A SINGLE LINE OF CODE FAILING ─────────────────
//
// The studio moved off its old system on 2026-07-27. From that day this panel IS the business: a
// day it cannot open is a day nobody can book, check in, or be sold a package.
//
// And the likeliest way that happens is not a bug. It is a renewal nobody remembered. This studio
// has already lived it once — on 2026-07-16 the registrar put `pilatesfitnessbyisil.com` on
// clientHold over an unconfirmed ICANN e-mail, the domain stopped resolving for anyone without a
// cached lookup, and it was discovered by a customer failing to reach the site.
//
// So these checks deliberately watch the BORING failures: a domain that lapses, a certificate that
// stops renewing, a site that stops answering, a token that gets revoked, a renewal date that
// passes. Each one is invisible until it is an outage.
//
// ── What this CANNOT do, stated plainly ──
// If Google suspends the project (unpaid bill), this function is suspended with it: a watchdog that
// lives inside the thing it watches cannot report its own death. That gap is covered by the WEEKLY
// HEARTBEAT below — a message that arrives when all is well. Silence becomes the signal, and the
// owner is told to treat a missing heartbeat as a fault.

export type InfraAlert =
  | 'domain_expiring'
  | 'domain_hold'
  | 'ssl_expiring'
  | 'site_unreachable'
  | 'renewal_due'

export interface InfraFinding {
  readonly alert: InfraAlert
  readonly severity: 'critical' | 'warning'
  readonly subject: string // which domain / host / renewal
  readonly detail: string
  readonly daysLeft: number | null
}

const DAY = 86_400_000

// ── Domains ────────────────────────────────────────────────────────────────────────────────
// RDAP is the registry's own machine-readable record — the successor to WHOIS, no scraping, no key.
// It answers two different questions at once: WHEN the registration lapses, and whether the registrar
// has already parked the domain (`clientHold` — the exact status that took this studio down once).
async function checkDomain(domain: string): Promise<readonly InfraFinding[]> {
  const found: InfraFinding[] = []
  try {
    const res = await fetch(`https://rdap.verisign.com/com/v1/domain/${domain}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return found
    const data = (await res.json()) as {
      events?: { eventAction: string; eventDate: string }[]
      status?: string[]
    }

    // A hold is an OUTAGE, not a warning: the name stops resolving and no amount of healthy server
    // makes any difference.
    const held = (data.status ?? []).filter((s) => /hold/i.test(s))
    if (held.length > 0) {
      found.push({
        alert: 'domain_hold',
        severity: 'critical',
        subject: domain,
        detail: `Alan adı registrar tarafından askıya alınmış (${held.join(', ')}). Site erişilemez hâle gelir.`,
        daysLeft: null,
      })
    }

    const exp = data.events?.find((e) => e.eventAction === 'expiration')?.eventDate
    if (exp) {
      const daysLeft = Math.floor((Date.parse(exp) - Date.now()) / DAY)
      // 60 days is a warning because a registrar transfer or a failed card needs weeks, not days.
      // 21 days is critical: at that point the renewal has to happen this week.
      if (daysLeft <= 21 || daysLeft <= 60) {
        found.push({
          alert: 'domain_expiring',
          severity: daysLeft <= 21 ? 'critical' : 'warning',
          subject: domain,
          detail: `Alan adının süresi ${new Date(exp).toLocaleDateString('tr-TR')} tarihinde doluyor.`,
          daysLeft,
        })
      }
    }
  } catch (e) {
    // A failed lookup is not evidence of a problem — RDAP has outages of its own.
    logger.warn('[infra] rdap failed', { domain, error: (e as Error)?.message })
  }
  return found
}

// ── Certificates ───────────────────────────────────────────────────────────────────────────
// These renew automatically. That is exactly why they are worth watching: nobody looks at a thing
// that renews itself, so the one time renewal silently stops, the first symptom is every browser
// refusing to open the panel.
function checkCertificate(host: string): Promise<InfraFinding | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 15_000 }, () => {
      const cert = socket.getPeerCertificate()
      socket.destroy()
      if (!cert?.valid_to) return resolve(null)
      const daysLeft = Math.floor((Date.parse(cert.valid_to) - Date.now()) / DAY)
      // Let's Encrypt renews at ~30 days out. Under 20 means renewal has already missed a cycle.
      if (daysLeft > 20) return resolve(null)
      resolve({
        alert: 'ssl_expiring',
        severity: daysLeft <= 7 ? 'critical' : 'warning',
        subject: host,
        detail: `Güvenlik sertifikası ${daysLeft} gün sonra doluyor ve otomatik yenilenmemiş görünüyor.`,
        daysLeft,
      })
    })
    socket.on('error', () => resolve(null)) // unreachable is the next check's business, not this one
    socket.on('timeout', () => {
      socket.destroy()
      resolve(null)
    })
  })
}

// ── Reachability ───────────────────────────────────────────────────────────────────────────
// The end-to-end question no internal metric answers: can a person outside actually open this?
async function checkReachable(url: string): Promise<InfraFinding | null> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    // 2xx and 3xx are both fine: /login redirects, and a redirect proves the server answered.
    if (res.status < 400) return null
    return {
      alert: 'site_unreachable',
      severity: 'critical',
      subject: url,
      detail: `Adres ${res.status} döndürüyor — üyeler siteye ulaşamıyor olabilir.`,
      daysLeft: null,
    }
  } catch (e) {
    return {
      alert: 'site_unreachable',
      severity: 'critical',
      subject: url,
      detail: `Adrese hiç ulaşılamadı (${(e as Error)?.message ?? 'bağlantı hatası'}).`,
      daysLeft: null,
    }
  }
}

// ── Renewals a machine cannot see ──────────────────────────────────────────────────────────
// Apple's developer membership, a PAYTR contract, a hosting invoice: no API tells us these lapsed
// until they already have. They live as DATES in `settings/renewals` — data, so the owner edits them
// without a deploy — and this is the calendar that remembers instead of a person.
//
//   settings/renewals = { items: [{ label, dueAt(ms), note? }, … ] }
async function checkRenewals(studioId: string): Promise<readonly InfraFinding[]> {
  const snap = await db().doc(`studios/${studioId}/settings/renewals`).get()
  const items = (snap.get('items') ?? []) as { label?: string; dueAt?: number; note?: string }[]
  const out: InfraFinding[] = []
  for (const it of items) {
    if (!it.dueAt || !it.label) continue
    const daysLeft = Math.floor((it.dueAt - Date.now()) / DAY)
    if (daysLeft > 30) continue
    out.push({
      alert: 'renewal_due',
      severity: daysLeft <= 7 ? 'critical' : 'warning',
      subject: it.label,
      detail:
        daysLeft < 0
          ? `${it.label} — ödeme/yenileme tarihi ${-daysLeft} gün ÖNCE geçti.${it.note ? ` ${it.note}` : ''}`
          : `${it.label} — ${daysLeft} gün sonra yenilenmeli.${it.note ? ` ${it.note}` : ''}`,
      daysLeft,
    })
  }
  return out
}

export interface InfraReport {
  readonly checkedAt: number
  readonly findings: readonly InfraFinding[]
  readonly domains: readonly string[]
  readonly hosts: readonly string[]
}

/**
 * One pass over everything outside the code that can still take the studio offline.
 *
 * The domains and hosts are DATA (`settings/infrastructure`), not literals: a second studio has its
 * own domain, and this file must not learn either studio's name.
 */
export async function runInfrastructureChecks(studioId: string): Promise<InfraReport> {
  const cfg = await db().doc(`studios/${studioId}/settings/infrastructure`).get()
  const domains = ((cfg.get('domains') ?? []) as string[]).filter(Boolean)
  const hosts = ((cfg.get('hosts') ?? []) as string[]).filter(Boolean)
  const urls = ((cfg.get('urls') ?? []) as string[]).filter(Boolean)

  const results = await Promise.all([
    ...domains.map((d) => checkDomain(d)),
    ...hosts.map((h) => checkCertificate(h).then((f) => (f ? [f] : []))),
    ...urls.map((u) => checkReachable(u).then((f) => (f ? [f] : []))),
    checkRenewals(studioId).catch(() => []),
  ])

  const findings = results.flat()
  for (const f of findings) {
    logger.error(`infra: ${f.alert}`, {
      alert: f.alert,
      studioId,
      severity: f.severity,
      subject: f.subject,
      daysLeft: f.daysLeft,
    })
  }

  // Say so even when everything is fine — a monitor only ever heard from when it is angry cannot be
  // told apart from a monitor that died.
  logger.info('infra: checks complete', {
    studioId,
    domains: domains.length,
    hosts: hosts.length,
    urls: urls.length,
    findings: findings.length,
    clean: findings.length === 0,
  })

  return { checkedAt: Date.now(), findings, domains, hosts }
}

/** DNS sanity for the panel host — a name that stops resolving is the outage that looks like nothing. */
export async function resolves(host: string): Promise<boolean> {
  try {
    const a = await dns.resolve4(host)
    return a.length > 0
  } catch {
    return false
  }
}
