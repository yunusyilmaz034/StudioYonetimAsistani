// `pnpm setup:infrastructure <studioId> [--domain d] [--host h] [--url u]` — tell the nightly
// watchdog what else it must keep an eye on.
//
// The watchdog reads `settings/infrastructure` = { domains, hosts, urls } and checks expiry,
// certificates and reachability. That document had been written by hand, which is the one thing
// this repository refuses to do to production data: a `domains` field written as a string instead
// of an array does not fail, it silently monitors nothing, and a monitor that watches nothing looks
// exactly like a monitor with nothing to report.
//
// Additive by design. It MERGES with what is already there and de-duplicates; it never removes an
// entry, because forgetting to re-list a domain would quietly stop watching it.
//
// Manual, admin-only, never in CI.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

const STUDIO = process.argv[2] ?? 'retro'

/** `--domain a --domain b` → ['a', 'b']. Unknown flags are refused rather than ignored. */
function collect(flag: string): string[] {
  const out: string[] = []
  const argv = process.argv.slice(3)
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== flag) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      console.error(`${flag} needs a value.`)
      process.exit(1)
    }
    out.push(value)
  }
  return out
}

const KNOWN = new Set(['--domain', '--host', '--url'])
for (const arg of process.argv.slice(3)) {
  if (arg.startsWith('--') && !KNOWN.has(arg)) {
    console.error(`Unknown flag ${arg}. Expected --domain, --host or --url.`)
    process.exit(1)
  }
}

const merge = (existing: unknown, added: readonly string[]): string[] =>
  [...new Set([...(Array.isArray(existing) ? (existing as string[]) : []), ...added])].filter(Boolean)

async function main(): Promise<void> {
  const domains = collect('--domain')
  const hosts = collect('--host')
  const urls = collect('--url')
  if (domains.length + hosts.length + urls.length === 0) {
    console.error('Nothing to add. Pass at least one --domain, --host or --url.')
    process.exit(1)
  }

  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()
  const ref = db.doc(`studios/${STUDIO}/settings/infrastructure`)
  const before = await ref.get()

  const next = {
    domains: merge(before.get('domains'), domains),
    hosts: merge(before.get('hosts'), hosts),
    urls: merge(before.get('urls'), urls),
  }
  await ref.set(next, { merge: true })

  console.log(`\n✅ ${STUDIO} · settings/infrastructure güncellendi\n`)
  console.log(`   Alan adları : ${next.domains.join(', ') || '—'}`)
  console.log(`   Sunucular   : ${next.hosts.join(', ') || '—'}`)
  console.log(`   Adresler    : ${next.urls.join(', ') || '—'}`)
  console.log(`\n   Gece çalışan bekçi bir sonraki turunda bunları da kontrol eder.\n`)
  process.exit(0)
}

void main()
