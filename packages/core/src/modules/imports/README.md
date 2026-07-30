# `imports` — the import wizard's domain

## Purpose

Bringing another system's spreadsheet into this one, **without** letting it write anything the studio
cannot undo or explain. Owner request, 2026-07-30.

The wizard's job is not parsing — it is refusing to guess. Every decision that could attach the wrong
record to the wrong person is either certain (a phone) or shown to a human (everything else).

## The invariants this module owns

1. **A name never attaches a package.** A phone match is certain and applied; a name match is a
   *proposal* an operator confirms row by row. `matchMember` has no outcome that attaches from a
   name, which is what stops this being loosened later.
2. **An import is a batch, and the batch is the unit of undo.** Everything created carries the batch
   id. Nothing is reverted by timestamp.
3. **A reversal is compensating events, never a deletion and never a backup restore.** Deleting
   breaks the one rule the ledger rests on; restoring a backup erases every real thing that happened
   since the import.
4. **A batch may be reverted only while it is inert.** Once an imported member has booked, entered,
   or paid — or an imported package has spent a credit — the reversal refuses and names what blocks
   it, in full, not one blocker at a time.
5. **An import writes no money.** No sale, no payment, no till movement. Those were settled in the
   old system; carrying them here would mix two systems' revenue and make no month comparable to
   another. (Owner, 2026-07-30.)
6. **Event payloads carry counts and ids, never PII.** Who was imported is recorded once, by the
   `member.registered` events the batch writes.

## Public API (`index.ts`)

- **Types** — `ImportBatch`, `ImportKind`, `MemberDraft`, `PackageDraft`.
- **Events** — `import.applied`, `import.reverted`.
- **Fields** (`domain/fields.ts`) — `MEMBER_FIELDS`, `PACKAGE_FIELDS`, `fieldsFor(kind)`. The
  left-hand side of the mapping screen: what we can fill, and the headings a file might call it.
- **Header matching** (`domain/headers.ts`) — `foldHeader`, `suggestMapping` (a *suggestion*, always
  overridable), `cellFor`.
- **Member matching** (`domain/match.ts`) — `matchMember`, `isAmbiguous`, `foldName`.
- **Undo** (`domain/revert.ts`) — `decideRevert`.

All of the above is **pure**. No I/O, no clock, no Firestore.

## Why the BulutGym adapter still exists

`members/domain/import-csv.ts` reads one customer's export and is frozen (Doc 1 §16). This module
replaces the *need* for the next such adapter; it does not replace that one, and the two deliberately
keep separate copies of header folding so this one can grow as real files arrive without changing
what the frozen adapter does.
