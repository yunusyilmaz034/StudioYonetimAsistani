# 25 — Training & Progress System (v1.27) — **architecture backlog**

**Status:** backlog — accepted onto the roadmap (owner, 2026-07-13). **No code. No schema. Not
designed yet.** This is the brief the architecture will be written against when the milestone opens.
**Nothing here is binding** except where it is marked as a consequence of an existing invariant.

---

## 1. What the owner asked for

> *"Amaç sadece antrenman programı yazmak değil, üyenin gelişimini yönetmek."*

- **Measurement history** — weight, fat, muscle, water, BMI, BMR, visceral fat, and *whatever else
  the device emits*. Charts over time.
- **Programme management** — **a programme is never edited**. Every change creates a new
  **Program Version**. History is kept forever.
- **Weekly programme** — named days (Pzt/Çrş/Cum, or a member's own). Each day: exercise · set · rep
  · rest · tempo · note.
- **Exercise library** — one home for each exercise: Turkish and English name, description, muscle
  group, machine/free, photo, GIF, video, cues, common mistakes, alternatives. **A programme only
  references these.**
- **Program snapshot** — at creation, the exercise, description, sets, reps, video reference and the
  trainer's note are **snapshotted**, so that years later the member sees *exactly the programme she
  was given that day*.
- **Member portal** — she sees her programme, watches the video, reads the description, and leaves a
  short note per exercise (*"omzum ağrıdı", "kolay geldi", "makine doluydu"*). **She cannot change
  the programme.**
- **Trainer** — creates, revises, reads member notes, replies.
- **Programme term** — start → end; expiry moves it to the archive.
- **AI readiness** — a later AI reads measurements + programme history + member notes + attendance +
  check-ins + reservations together, and proposes the next programme.

---

## 2. What this already fits — and the one thing it collides with

**It fits the grain of the system almost perfectly.** Three of the owner's requirements are things
this architecture already does everywhere, and they should be built with the existing machinery
rather than a new mechanism:

- **"Program düzenlenmez; her değişiklik yeni versiyon yaratır"** *is* the append-only rule (#1, #9).
  A `ProgramVersion` is a new aggregate version, and the change that produced it is an event. The
  same reasoning as the credit ledger: you do not overwrite a fact, you append the next one.
- **"Program snapshot"** *is* `entitlement.productSnapshot` again (AD-41's sibling): the catalogue is
  data, and a sale freezes what was sold. Here the *exercise library* is data, and a programme
  freezes what was prescribed. **The snapshot is the point:** if a programme referenced only live
  exercise ids, an edit to the library in 2028 would silently rewrite what the member was told to do
  in 2026. That is the "presumption written as an observation" failure (#11) wearing gym clothes.
- **"Üye programı değiştiremez"** is the member principal (v1.21) — she reads state and writes
  nothing but a comment.

**And one collision, which is the milestone's real design problem:**

> **Measurements and body composition are health data.** Under KVKK (and GDPR Art. 9) body-fat,
> weight and visceral-fat readings are *special-category personal data* — a stricter class than the
> name and phone we already guard. And non-negotiable #6 says **PII never enters an event payload**.
>
> So: **a measurement value may never appear in an event.** The event says *"a measurement was
> recorded"* (`member.measurement_recorded`, with the metric *kind* and the device, and no value);
> the value lives in a state document under `/members/{id}/measurements/…`, erasable with the member.
> A chart reads the state, never the log.
>
> This is not a detail to discover during implementation. It decides the data model, and getting it
> wrong is **unrecoverable** — an event log cannot be edited to remove a body-fat percentage.

Likewise the member's exercise notes (*"omzum ağrıdı"*) are, in effect, health complaints. Same rule:
the note is state on the programme's day-entry; the event records that a note was left.

---

## 3. The shape it will probably take (indicative, not binding)

```
/studios/{sid}/
    exercises            ← the library. Data, not code (the AD-41 rule again).
    programs             ← one per member per term: { memberId, startsAt, endsAt, status, currentVersion }
      /versions/{n}      ← IMMUTABLE. The weekly plan, fully snapshotted. Never edited, never deleted.
    members/{id}/
      measurements       ← health data. State only. Erasable. NEVER in an event.
```

New events (names indicative): `program.created` · `program.revised` (→ a new version) ·
`program.archived` · `program.note_added` (by member) · `program.note_replied` (by trainer) ·
`member.measurement_recorded` (**kind + device only — no value**).

**Modules:** a new `training` module in `packages/core`, with the library as its own aggregate.
No existing module changes. No migration. Nothing in the credit ledger, the reservation engine or the
event envelope moves.

---

## 4. The questions the owner will have to answer when this opens

1. **Who may see a measurement?** Owner + the member herself + her trainer — or every trainer?
   (Health data: the default must be the narrowest, not the most convenient.)
2. **Does a programme belong to a member, or to a member *and* a trainer?** It decides what happens
   when the trainer leaves.
3. **Is the exercise library per-studio or platform-wide?** Platform-wide is a *product* decision with
   a multi-tenancy consequence — the catalogue rule (AD-41) says data, but says nothing about scope.
4. **Video hosting.** Files are the first non-Firestore asset this product has ever had (Storage +
   rules + cost). Or: reference external URLs and store nothing. The second is cheaper and smaller,
   and it can be changed later.
5. **Does a member's note need a trainer's reply to be "closed"?** (A note nobody answers is a
   promise the studio quietly broke.)

---

## 5. Why it is scheduled *before* the AI, and not after

The AI Studio Manager's most valuable observation is not *"14 rezervasyon yapıldı"* — the owner can
see that. It is *"bu üyenin programı üç aydır aynı, ölçümleri durdu, katılımı düşüyor"*. That
sentence requires measurements, programme history and member notes to exist. **Build the data before
the thing that reads it.**
