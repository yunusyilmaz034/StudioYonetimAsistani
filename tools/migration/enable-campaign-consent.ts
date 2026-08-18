import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// TURN THE CAMPAIGN PERMISSION ON — a break-glass script, run by hand, once.
//
//   pnpm tsx tools/migration/enable-campaign-consent.ts            (dry run — writes NOTHING)
//   pnpm tsx tools/migration/enable-campaign-consent.ts --apply
//
// ── WHY THIS EXISTS, AND WHOSE DECISION IT IS ───────────────────────────────────────────────
//
// The owner is the data controller and states that KVKK notice and explicit consent were collected
// from members on paper. On that basis he directed, on 2026-08-18, that the in-app campaign
// permission be switched on for everyone.
//
// The distinction was put to him before this ran, because it is the part a script cannot judge:
//
//   · 111 members had NO stored preference at all — they never opened that screen, so the written
//     consent is the only expression there is.
//   · 46 had `campaign: false` in a preferences object THEY caused to be written. The app writes
//     preferences in exactly one place — a member flipping a switch — so those people saw that
//     screen and left the campaign switch alone.
//   ·  3 had already turned it on themselves.
//
// He chose all of them, knowingly. It is recorded here rather than in a commit message because the
// question will be asked again the first time somebody replies "beni bu listeden çıkarın".
//
// ── WHAT THIS DOES NOT TOUCH ────────────────────────────────────────────────────────────────
//
// Only `campaign`. Not push, not e-mail, not SMS, not WhatsApp. A member who turned WhatsApp off
// keeps it off, and the marketing message simply reaches her by another channel or not at all.
// Widening the change beyond what was asked for is how a consent fix becomes a consent problem.

const STUDIO = 'retro'

interface Row {
  readonly id: string
  readonly name: string
  readonly state: 'no-prefs' | 'off' | 'already-on'
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const members = await db.collection(`studios/${STUDIO}/members`).get()
  const rows: Row[] = members.docs.map((d) => {
    const prefs = d.get('notificationPrefs') as Record<string, unknown> | undefined
    return {
      id: d.id,
      name: String(d.get('fullName') ?? ''),
      state: !prefs ? 'no-prefs' : prefs.campaign === true ? 'already-on' : 'off',
    }
  })

  const toChange = rows.filter((r) => r.state !== 'already-on')
  const count = (s: Row['state']) => rows.filter((r) => r.state === s).length

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')
  console.log(`toplam üye          : ${rows.length}`)
  console.log(`tercihi hiç yok     : ${count('no-prefs')}   → açılacak`)
  console.log(`kampanya kapalı     : ${count('off')}   → açılacak (owner kararı)`)
  console.log(`zaten açık          : ${count('already-on')}   → dokunulmayacak`)
  console.log(`\ndeğişecek kayıt     : ${toChange.length}`)

  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  // Batched, and only the one field. `merge` so a member's other switches survive untouched — a
  // whole-object write here would silently reset push/e-mail/SMS to whatever this file thinks.
  let written = 0
  for (let i = 0; i < toChange.length; i += 400) {
    const batch = db.batch()
    for (const r of toChange.slice(i, i + 400)) {
      batch.set(
        db.doc(`studios/${STUDIO}/members/${r.id}`),
        { notificationPrefs: { campaign: true } },
        { merge: true },
      )
      written++
    }
    await batch.commit()
  }

  const after = await db.collection(`studios/${STUDIO}/members`).get()
  const on = after.docs.filter((d) => (d.get('notificationPrefs') as { campaign?: boolean } | undefined)?.campaign === true).length
  console.log(`\n✓ ${written} kayıt güncellendi · kampanya izni açık olan: ${on}/${after.size}`)
  process.exit(0)
}

void main()
