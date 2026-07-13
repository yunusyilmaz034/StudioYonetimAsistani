import { createHash } from 'node:crypto'

import {
  eraseMember,
  ErasureReasons,
  FirestoreMemberRepository,
  systemClock,
  type ErasureReason,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

// KVKK / GDPR ERASURE — the break-glass script, run by hand.
//
//   pnpm kvkk:erase -- --studio=<sid> --member=<mid> --reason="KVKK silme talebi, 2026-07-20"
//   pnpm kvkk:erase -- --studio=<sid> --member=<mid> --reason="…" --apply
//
// ── The architectural claim this script is here to make good on ──────────────────────────────
//
// From the first commit, this system has held one line above almost all others: **PII never enters
// an event payload** (#6). Identity lives in `/members`; behaviour lives in `/events`. That rule has
// cost us convenience for two years, and THIS is what it bought:
//
//   **The event log does not have to be touched.**
//
// Her bookings, her credits, her payments, her check-ins — every fact the business is built on —
// stay in the log, permanently, and none of them says who she was. The ledger still balances. The
// revenue reports still add up. The AI still has its training data. And the woman who asked to be
// forgotten *is*, because every string that could identify her lived in exactly the places this
// script empties.
//
// A system that put her name in its events would face a choice here between obeying the law and
// keeping its own books. We do not have that choice to make, and that is not luck.
//
// ── What is ERASED ───────────────────────────────────────────────────────────────────────────
//   • /members/{id}                    — name, phone, e-mail, birth date, notes, emergency contact
//   • /reservations/*.memberSnapshot   — the denormalised copy (DEBT-003 said this day would come)
//   • /notifications/intents/*         — params and rendered body: her name, her address
//   • /members/{id}/inbox/*            — the in-app messages
//   • /members/{id}/invites/*          — token hashes tied to her
//   • Firebase Auth user               — her login
//
// ── What is NOT erased, and why that is lawful ───────────────────────────────────────────────
//   • /events                          — anonymous by construction. There is nothing to erase.
//   • the credit ledger, the sales, the payments — **financial records the studio is REQUIRED to
//     keep** (Turkish Commercial Code: ten years). They reference her by an opaque id that now
//     resolves to nobody. Erasure is not amnesia; it is severing the link between behaviour and a
//     person, and that is exactly what the id boundary already does.
//
// The member DOCUMENT is kept, tombstoned rather than deleted — deleting it would break every join
// in the system and turn a lawful erasure into a corrupt database. A tombstone says, truthfully:
// *this member existed, she asked to be forgotten, and on this date we forgot her.*

// The tombstone and the `member.erased` event are the DOMAIN's job (AD-67): they commit in one
// transaction, because an erasure that emptied her record and failed to log itself would be an
// unexplained deletion — and an unexplained deletion is indistinguishable, forever, from one
// somebody did to hide something.
//
// What this script owns is everything the aggregate CANNOT reach: the PII that leaked outward.

interface Plan {
  readonly memberDoc: boolean
  readonly reservationSnapshots: number
  readonly notificationIntents: number
  readonly inboxMessages: number
  readonly invites: number
  readonly authUser: boolean
}

async function buildPlan(db: Firestore, sid: string, mid: string): Promise<Plan> {
  const member = await db.doc(`studios/${sid}/members/${mid}`).get()

  const reservations = await db
    .collection(`studios/${sid}/reservations`)
    .where('memberId', '==', mid)
    .get()

  const intents = await db
    .collection(`studios/${sid}/notifications`)
    .where('recipient.id', '==', mid)
    .get()

  const inbox = await db.collection(`studios/${sid}/members/${mid}/inbox`).get()
  const invites = await db.collection(`studios/${sid}/members/${mid}/invites`).get()

  let authUser = false
  try {
    // The uid is derived from (studio, member) — see the portal's activation path.
    await getAuth().getUser(memberUid(sid, mid))
    authUser = true
  } catch {
    authUser = false // she never activated the portal
  }

  return {
    memberDoc: member.exists,
    reservationSnapshots: reservations.size,
    notificationIntents: intents.size,
    inboxMessages: inbox.size,
    invites: invites.size,
    authUser,
  }
}

function memberUid(sid: string, mid: string): string {
  // Mirrors the portal's derivation. An erasure that misses her LOGIN has not erased her.
  return `mbr_${createHash('sha256').update(`${sid}:${mid}`).digest('hex').slice(0, 24)}`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const sid = flag('studio')
  const mid = flag('member')
  const reason = flag('reason') as ErasureReason | undefined
  const note = flag('note') ?? null
  const admin = flag('admin')
  const apply = argv.includes('--apply')

  if (!sid || !mid || !reason || !admin) {
    console.error(
      'Kullanım: pnpm kvkk:erase -- --studio=<sid> --member=<mid> --admin=<platformAdminId> \\\n' +
        `           --reason=<${ErasureReasons.join('|')}> [--note="..."] [--apply]`,
    )
    // The reason is MANDATORY, and the ADMIN is mandatory. An erasure with no recorded reason and no
    // named actor is indistinguishable from a deletion somebody did to hide something — and this is
    // the one operation where that distinction is the entire point.
    process.exit(2)
  }

  // A CLOSED ENUM (owner, AD-67). Free text is the last place PII can hide in a permanent log
  // ("Ayşe Yılmaz'ın avukatı aradı"). The human's explanation goes in `--note`, which lives on the
  // tombstone in state — where it can itself be erased.
  if (!ErasureReasons.includes(reason)) {
    console.error(`❌ Geçersiz sebep: '${reason}'. Geçerli: ${ErasureReasons.join(' | ')}`)
    process.exit(2)
  }

  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
  const db = getFirestore()
  const plan = await buildPlan(db, sid, mid)

  console.log(`\nÜye: ${mid} · Stüdyo: ${sid}`)
  console.log(`Sebep: ${reason}\n`)
  console.log('Silinecek:')
  console.log(`  • üye kaydı (mezar taşı)      : ${plan.memberDoc ? 'evet' : 'YOK'}`)
  console.log(`  • rezervasyon memberSnapshot  : ${plan.reservationSnapshots}`)
  console.log(`  • bildirim intent’leri        : ${plan.notificationIntents}`)
  console.log(`  • uygulama içi mesajlar       : ${plan.inboxMessages}`)
  console.log(`  • davetler                    : ${plan.invites}`)
  console.log(`  • Auth kullanıcısı            : ${plan.authUser ? 'evet' : 'yok'}`)
  console.log('\nDOKUNULMAYACAK:')
  console.log('  • /events        — PII içermez (#6). Silinecek bir şey yok.')
  console.log('  • kredi defteri, satışlar, ödemeler — saklama yükümlülüğü (TTK 10 yıl).')
  console.log('    Artık kimseye çözülmeyen opak bir id’ye bağlılar.\n')

  if (!plan.memberDoc) {
    console.error('❌ Üye bulunamadı. Silme yapılmadı.')
    process.exit(1)
  }

  if (!apply) {
    console.log('DRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply')
    return
  }

  // ── 1. The AGGREGATE, through the domain. ─────────────────────────────────────────────────
  // The tombstone and the `member.erased` event commit together (#1). The actor is
  // `platform_admin` — the domain REFUSES anyone else, so reception cannot make a member vanish,
  // and neither can the owner in the middle of an argument.
  const ctx: TenantContext = {
    studioId: sid as StudioId,
    branchIds: [],
    role: 'platform_admin',
    actor: { type: 'platform_admin', id: admin as never },
  }
  const erased = await eraseMember(
    { repo: new FirestoreMemberRepository(db), clock: systemClock },
    ctx,
    { memberId: mid as MemberId, reason, note },
  )
  if (!erased.ok) {
    console.error(`❌ Domain reddetti: ${erased.error.code}`)
    process.exit(1)
  }
  if (!erased.value.erased) {
    // Idempotent. She was already forgotten; a second run must be safe, because the first run's
    // output scrolls away and somebody will re-run it.
    console.log('ℹ️  Üye zaten anonimleştirilmiş. Yeni event üretilmedi.')
  }

  // ── 2. Everything the aggregate cannot reach. ─────────────────────────────────────────────
  const batch = db.batch()

  const reservations = await db
    .collection(`studios/${sid}/reservations`)
    .where('memberId', '==', mid)
    .get()
  for (const r of reservations.docs) {
    // DEBT-003, come due. The snapshot exists so a trainer's roster costs ten reads instead of
    // twenty; the entry said, in writing, that an erasure would have to purge it. It does.
    batch.update(r.ref, {
      'memberSnapshot.displayName': '[silindi]',
      'memberSnapshot.phoneLast4': null,
    })
  }

  const intents = await db
    .collection(`studios/${sid}/notifications`)
    .where('recipient.id', '==', mid)
    .get()
  for (const i of intents.docs) {
    // The intent holds her name (in `params`), her rendered message, and her address. I-38 kept all
    // three OUT of the event log precisely so they could be deleted from here.
    batch.update(i.ref, {
      params: {},
      'recipient.email': null,
      'recipient.phone': null,
      'recipient.displayName': '[silindi]',
      erased: true,
    })
  }

  for (const doc of (await db.collection(`studios/${sid}/members/${mid}/inbox`).get()).docs) {
    batch.delete(doc.ref)
  }
  for (const doc of (await db.collection(`studios/${sid}/members/${mid}/invites`).get()).docs) {
    batch.delete(doc.ref)
  }

  await batch.commit()

  if (plan.authUser) {
    await getAuth().deleteUser(memberUid(sid, mid))
  }

  console.log('✅ Silindi.')
  console.log('\n⚠️  Bu koşumu KVKK kayıt defterine işleyin: tarih, üye id, sebep, kimin talebi.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
