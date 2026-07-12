# 21 — Member Portal & Auth · Design (v1.21)

> **Status: SHIPPED (v1.21). All eight batches owner-reviewed and approved. Verified end-to-end
> against the emulator: 32 portal checks + 7 QR checks + 20 Firestore-rules checks, all green.**
>
> The first surface a **customer** ever touches. Everything before this was staff-facing:
> if reception mis-reads a screen, reception asks someone. A member who mis-reads a screen
> books the wrong class, or sees another member's data. The bar is different.
>
> This document locks the product decisions: **D1–D11** from the owner's first directive, and
> **D12–D17** answering the six open questions (§14). The six answers changed the shape of the
> milestone: v1.21 is **no longer a UI-only layer over an untouched domain.** It now carries
> three real domain changes — service-level eligibility, PT ownership, and a stamped
> cancellation window — each of which touches an **event schema**, and event schemas are
> permanent. §15 states exactly what that costs and what it does *not* do to historical data.

---

## 1. Purpose & scope

**A member logs into her own account, sees her packages and remaining credits, sees only the
sessions her packages entitle her to, books and cancels her own reservations, and shows a QR
to get in.**

Phase-1 rules do not change. The portal is a **second front-end onto the existing domain** —
it introduces a new *principal*, not a new *domain*. Every booking, cancellation, and credit
movement still goes through the same pure decision functions the owner UI uses.

**In scope:** member auth (invite → set password → phone + password login) · member dashboard ·
an eligibility-filtered reservation agenda · self-booking · self-cancellation · profile
self-service (a narrow field set) · a check-in QR · the security perimeter that makes all of
this safe.

**Not in scope:** waitlist · payments/online purchase · class notes to members · push
notifications · a member's own attendance history beyond what the dashboard shows · trainer
app · SMS.

---

## 2. The blocking security gate — read this first

**Today the security rules say: any authenticated user in the studio may read almost every
document in the studio.**

```
firestore/firestore.rules:39-41
match /{col}/{docId} {
  allow read:  if tenant() && !(col in ['events', 'commands']);
  allow write: if false;
}
```

`tenant()` is only `request.auth.token.studioId == sid`. There is no role check on reads.
This was safe because **every** authenticated principal was staff (`parseStaffClaims` in
`apps/web/src/server/claims.ts:39` rejects any token whose `role` is not
`owner | receptionist | trainer`, so no other principal could ever exist).

**The moment a member is issued a token carrying `studioId`, that member can read
`/members` — every member's name, phone, birth date, emergency contact — plus every
entitlement, payment, and reservation in the studio, straight from the client SDK.** No UI
would show it; the SDK does not need the UI.

This is the single load-bearing prerequisite of v1.21, and it is why the milestone starts at
the perimeter and not at a screen.

**The rule (D-SEC):** *a member principal gets **no client-SDK read access at all**.*

- The portal is **server-rendered**. Member pages read through Server Components / Server
  Actions on the Admin SDK, with the member's identity taken **only** from the verified
  session cookie.
- The rules are tightened so reads require a **staff** role. A member token matches no read
  rule and is denied everything — the perimeter, not the UI, is what protects the data.
- **The client never sends a `memberId`.** Not in a booking, not in a cancel, not in a
  profile save. The server derives it from the cookie. A `memberId` arriving from a client is
  ignored, always. (This is the owner's directive in §"Güvenlik", made structural: there is
  no parameter to forge, because there is no parameter.)

Consequence, stated honestly: **member self-booking cannot use the offline `/commands`
path.** `/commands` is client-writable by design (AD-15); a member writing a command doc is a
member writing state we then trust. Booking is a Server Action — which is already the rule
for anything that allocates a scarce resource (CLAUDE.md, write-path test). The member portal
is **online-only**. Reception's offline path is untouched.

---

## 3. Principal & authentication

The seam already exists and is unused:

- `ActorRef` already has `{ type: 'member'; id: MemberId }` — `packages/core/src/shared/actor.ts:18`.
- `member.portal_login` is already catalogued as a Phase-2 event — Doc 04 §"Phase 2".
- `parseStaffClaims` already refuses non-staff tokens — so staff routes are safe against a
  member token **by construction**, today, with no change.

**What v1.21 adds:**

| Piece | Shape |
|---|---|
| Member claims | `{ studioId, role: 'member', memberId }` — a **separate** claim shape and a separate parser (`parseMemberClaims`). It is never accepted by `requireTenantContext()`. |
| Member context | `requireMemberContext()` — the single door for every portal read and write. Returns `{ studioId, memberId }`. Throws otherwise. |
| Session | The same Firebase session cookie mechanism as staff (`__session`, 5 days). |
| Firebase user | One Firebase Auth user per activated member. `uid ≠ memberId`; the link is the `memberId` **custom claim**, minted server-side at activation. |

**Login identity is the phone number.** Firebase Auth needs an email-shaped username, so the
portal logs in with a **synthetic identifier derived from the normalised phone** (e.g.
`+905321234567@members.<studio>.local`) and a password. The member types **phone + password**;
the mapping is invisible and server-side. Phones are already E.164-normalised or the row is
rejected (AD-40) — so the identifier is total and collision-free by the same rule.

*Why not Firebase phone auth (SMS)?* Owner decision, already recorded (OQ-5 = A1): no SMS
dependency, no per-message cost, works with a WhatsApp-delivered link.

---

## 4. Account creation — the invite

**Reception never creates a member's account, and never sets a member's password.** Reception
creates the *Member record*; the system creates the *invite*; the member creates the
*account*.

```
reception creates Member                → member.registered            (exists today)
reception hits "Davet Linki Oluştur"    → member.invited               (NEW event)
   → /invites/{token} written, expires in 72 h, single active per member
reception copies the link → WhatsApp (manual, out of the system)
member opens the link → sets a password  → member.portal_activated     (NEW event)
   → Firebase user created, claims minted, invite consumed
member logs in (phone + password)        → member.portal_login         (catalogued, Phase 2)
```

**Invite rules (owner directive, locked):**

- **72-hour expiry.** Stamped on the document as `expiresAt`; checked server-side at open.
- **One active invite per member.** Issuing a new one **invalidates the previous** — the doc
  records `supersededBy`. (A "resend" is therefore a *new* invite, not a re-send of the old
  link, and the old link stops working. This is the safe reading of "tek aktif davet".)
- **Single use.** Consumed at activation; a consumed invite is inert.
- The token is a **high-entropy random secret**, not a ULID and not derived from `memberId` —
  an invite link is a bearer credential, so it must not be guessable or enumerable.
- **The invite document carries no PII** (I-13 applies to events; we hold the same line for
  this doc): it stores `memberId`, `expiresAt`, `status`, never a name or phone.
- Opening an expired/consumed/unknown invite gives one message — *"Bu davet artık geçerli
  değil, lütfen stüdyodan yeni bir bağlantı isteyin."* — and never reveals whether the member
  exists.

**D17 — forgotten password: no self-service reset in v1.21.** E-mail is optional and
**unverified** on `Member`, and there is no SMS provider — so there is **no channel we can
prove belongs to her**. A reset link sent to an unverified address is an account-takeover
primitive, not a convenience. The flow is therefore the invite flow, deliberately:

1. The member contacts the studio.
2. Owner/reception **revokes her existing sessions** (Firebase `revokeRefreshTokens` **and**
   the session cookie — a 5-day cookie outlives a password change otherwise) **and invalidates
   the outstanding invite**.
3. A **new single-use, 72-hour** invite is issued.
4. She sets a new password through it.

One code path for activation *and* reset — fewer ways to be wrong. When a **verified** SMS or
e-mail channel exists, self-service reset becomes its own milestone.

---

## 5. Member dashboard

One screen, mobile-first, answering *"what's next, what do I have, what do I owe?"* — the
member's equivalent of the owner dashboard's one-glance rule.

| Block | Source |
|---|---|
| **Yaklaşan rezervasyonum** (next 1–3, with time, class, trainer, room) | `reservations.listByMember` (exists) |
| **Aktif paketlerim** — product name, **kalan hak**, **bitiş tarihi** | `entitlements.listByMember` (exists); `available` + `validUntil` |
| **Açık bakiye** (only when > 0) | the v1.14 payment seam: `priceAgreed − paid` |
| **Rezervasyon Yap** · **Rezervasyonlarım** · **QR Kodum** | navigation |

An unlimited (`period`) package shows **"Sınırsız"**, not a number — the credit ledger has no
count to show, and inventing one would be a lie.

Balance is shown **as information, never as a demand**: the portal has no payment flow in
v1.21, so the copy points at the studio ("Stüdyoda ödeyebilirsiniz"), not at a dead end
(UX-6).

---

## 6. What a member may see — the eligibility rule

> **A member sees only the sessions her active packages entitle her to.** With several active
> packages, she sees the **union**.

This is not new logic. It is the **category wall** (invariant I-9.7), which the domain already
enforces at booking time:

```
packages/core/src/modules/reservations/domain/decide.ts:112
// I-9.7 — the category wall
if (entitlement.productSnapshot.category !== session.category) → 'category_mismatch'
```

`Category` is a closed enum of exactly three values — `packages/core/src/shared/category.ts:4`:

```
'pilates_group' | 'fitness' | 'private'
```

Which maps precisely onto the owner's example: a **fitness** member does not see **grup
pilates**; a **pilates** member does not see **fitness**.

**The visible set** = `{ sessions whose category ∈ (categories of the member's active,
non-expired entitlements) }`, minus cancelled sessions, within the booking window
(`policy.maxDaysInAdvance`).

**But the category wall alone is no longer the rule** — see **D12**. Eligibility becomes
**service-level**, with the category wall kept beneath it as the coarse guard it already is.

### D12 — eligibility is service-level, and it is snapshotted

> **A package covers an explicit list of `serviceId`s. Eligibility is never inferred from a
> package's name or its category text.**

Today `Product.serviceIds` is *"informational in Phase 1"* (`catalog/domain/types.ts:18`) and —
the deeper problem — **it is not carried into `ProductSnapshot`** (`entitlements/domain/types.ts`
holds only `productId · name · category · grant · listPrice`). The entitlement does not remember
which services its product named, so the decider *could not* scope by service even if it wanted
to. That is what changes:

| Change | Where |
|---|---|
| `ProductSnapshot` gains `serviceIds` | `entitlements/domain/types.ts` — **copied at purchase**, never re-read from the product |
| `decideBooking` gains a service check | `reservations/domain/decide.ts` — new refusal `service_not_covered` (+ Turkish copy) |
| `isBookable` / `selectEntitlement` mirror it | `select-entitlement.ts` — the advisory path must agree with the decider, or the UI lies |
| `entitlement.purchased` payload carries it | **event schema change → version bump + upcaster** |

**Why the snapshot is the whole point.** The owner's rule — *"paket tanımının sonradan
değiştirilmesi mevcut üyelerin geçmişte satın aldığı hakkı geriye dönük değiştirmemeli"* — is
satisfied **structurally**, not by discipline: the entitlement carries its own copy of the
service list, taken the day it was sold. Editing the product tomorrow changes what the *next*
buyer gets and nothing else. This is the same reason `productSnapshot.category` exists.

**Legacy entitlements (sold before this change) have no `serviceIds`.** They are treated as
**category-wide** — the rights they were sold under. This is a deliberate, permanent rule:

> `serviceIds` absent (legacy) → the old category wall alone. `serviceIds` present → the
> service list is the wall.

**We must NOT backfill `serviceIds` onto existing entitlements from today's products.** That
would retroactively narrow rights a member already paid for — precisely the thing the owner's
rule forbids. Absence is not missing data; **absence is the record of what was sold.**

**Going forward, a product must name at least one service.** An empty list is refused at
product creation — otherwise "covers nothing" and "covers the whole category" become
indistinguishable, and we are back to guessing.

### D13 — PT ownership is modelled, not inferred *(final — owner, 2026-07-12)*

> **A private session may be RESERVED for a member. Ownership is an explicit field, never
> derived from whether a reservation happens to exist — and its absence means the slot is
> OPEN, not hidden.**

`ClassSession` gains:

```
readonly assignedMemberId: MemberId | null   // only meaningful when category === 'private'
```

**There are two PT business models, and the field distinguishes them:**

| `assignedMemberId` | What the slot is | Who sees it | Who may book it |
|---|---|---|---|
| **`null`** *(default)* | an **OPEN PT slot** — the trainer's time, offered to whoever wants it | **every member whose package covers the PT service** | any of them, under the ordinary capacity + eligibility rules |
| **`memberA`** | a **RESERVED slot** — memberA's appointment | **memberA only** | **memberA only** — even another member holding a valid PT package is refused |

The rules that follow:

- **`null` does not mean "unavailable" and does not mean "hidden".** It is the default and it is
  the *open* case. This was the single most important correction to this design: an earlier
  draft treated an unassigned PT slot as invisible studio inventory, which would have made the
  portal hide exactly the slots the studio most wants sold.
- **Booking an open slot does NOT assign it.** The first member through the door acquires no
  ownership; `assignedMemberId` stays `null`. Ownership is granted by an admin, deliberately —
  never as a side-effect of a booking.
- **Fullness is governed by `capacity`, never by ownership.** There is deliberately **no
  `capacity === 1` rule** (owner): a future **partner/duo PT** may have capacity 2, and the
  ownership field must not quietly encode a capacity assumption.
- **A reserved slot refuses by *member*, not by *actor*** — so reception may still book that
  member into her own slot on her behalf.
- **Clearing the assignment turns the slot back into an open one.** Re-assignment is refused
  once the slot has a reservation (`session_has_reservations`): cancel it first, which is an
  explicit act with its own credit effect.
- The owner's session workspace gains an **"Üyeye Ayır"** control, shown only when the category
  is `private`.

**This is a scheduling-domain change with an event-schema consequence:** `class_session.scheduled`
carries `assignedMemberId` (v2), and re-assignment has its own event (`class_session.assigned`).
Both land in §15.

### The portal's visible set is computed by the SAME eligibility code (owner, 2026-07-12)

> **The agenda filter is not a second rule. It calls `coversService` — the one the decider
> calls.** The UI never derives eligibility of its own.

The visible set for a member = the sessions for which **at least one of her active entitlements
passes the same eligibility test the booking would run**:

| Her packages | She sees |
|---|---|
| Fitness only | fitness sessions only — **no pilates at all** |
| Reformer (service-scoped) | Reformer sessions — **not Mat Pilates**, even though both are `pilates_group` |
| Legacy (no service list) | the **category-wide** set she was sold |
| A PT package | **every OPEN PT slot** her package covers (`assignedMemberId === null`) **plus any slot RESERVED for her** — and never a slot reserved for someone else |
| Several packages | the **union** |

**The PT rule in the portal query, stated exactly** (Batch 7 must implement this and nothing
else):

```
visible(session, member) =
    eligible(member's active entitlements, session)        // category + service walls
AND (session.assignedMemberId == null                      // an OPEN slot — visible
     OR session.assignedMemberId == member.id)             // or reserved for HER
```

This is deliberately the same predicate as `isBookable` minus capacity/credit state (a full
class is still *visible* — it is her class; it just cannot be booked). One definition, in
`entitlements/domain/eligibility.ts`. If the portal ever grew its own copy, the list and the
booking would drift, and the member would be offered a class the server then refuses.

**Built in Batch 7** (the portal agenda); **the rule is fixed now** so that batch has nothing
to invent.

**The filter is a convenience, not a security boundary.** The server filters the list *and* the
domain re-checks every booking (§8). A member who guesses a session id still gets
`category_mismatch`, `service_not_covered`, or `session_not_assigned_to_member`. Visibility and
authorization are computed from the same rule but **enforced twice** — the list may be wrong;
the booking cannot be.

---

## 7. Class colour language

Colour is bound to the **service category**, never to the package name — the owner's rule, and
also the only one that survives a rename: a package is a commercial object that changes name
and price; a category is a closed enum of three values that the domain depends on.

| Category | Reads as | Token |
|---|---|---|
| `pilates_group` | Grup Pilates | `--cat-pilates` |
| `fitness` | Fitness | `--cat-fitness` |
| `private` | PT | `--cat-private` |

Three **semantic tokens** added to DS v2 (Doc 20), used as a soft tint + accent rail — the
calendar-chip language the owner already approved, not three saturated blocks. **Colour never
carries meaning alone** (Doc 09 §7): every chip is also labelled with the class name, so the
distinction survives colour-blindness and a printed page.

They are **category tokens, not status tokens** — they must not collide with
success/warning/danger, which already mean something across the product.

---

## 8. Booking rules — reuse, do not reinvent

**No new reservation logic. None.**

`bookReservation` / `cancelReservation` (`modules/reservations`) already do: entitlement
selection (earliest-expiring-first, deterministic tie-break) · the category wall · capacity ·
the booking window · credit **hold** (not consume) · daily limits · the refusal codes and
their Turkish messages.

The portal's Server Action therefore does exactly this:

```
requireMemberContext()            → memberId from the COOKIE (never from the client)
load session, entitlements, policy
decide (the same pure function the owner UI calls)
transact (state + event, atomically)
```

The deciders are **principal-agnostic** — `decideBooking` never asks *who* is booking — so
they need no change at all to serve a member.

The event's `actor` is `{ type: 'member', id: memberId }` — which is *the entire point of the
actor taxonomy*: the same `reservation.booked` event, attributable to the member who made it
rather than to the receptionist who didn't. No booking made by a member borrows a staff
identity (non-negotiable #5).

**`allowMemberSelfBooking` does not exist yet.** It is named in Doc 10 and Doc 19 as a seam,
but there is no such field in `SchedulingPolicy` today. v1.21 **adds it to `SchedulingPolicy`**
— the versioned, snapshotted home where a credit-affecting switch belongs (#4: policy is
versioned data, never an `if`). Adding a field is a **`policyVersion` bump, not a migration**;
sessions created before it carry the old snapshot and simply read the default.

*Where the switch is read matters:* it is a **studio/service** decision about whether members
may book at all — so it is checked in the **member Server Action** (a portal-level gate),
**not** inside `decideBooking`, which must stay a statement about the reservation domain and
not about which UI is calling it.

---

## 9. The cancellation window — and where it is resolved

The owner's chain:

```
1. session-specific cancellation window
2. service / class default
3. studio default
4. initial installation default (6 h)
```

**What exists today:** the window lives on the **Service** (`SchedulingPolicy.cancellationWindowHours`)
and is **snapshotted onto every session at creation** — `ClassSession.policySnapshot`, invariant
**I-24**, decision **AD-49**. The cancel decider reads it from that snapshot
(`reservations/domain/decide.ts:185`). So levels **2** and **4** exist (4 as seed data); levels
**1** and **3** do not.

**The design decision that matters — and it is an architectural one, not a UI one:**

> **The chain is resolved when the session is created, and the answer is stamped on the
> session. It is never resolved at read time.**

Because policy is **versioned data stamped at the moment of the decision** (non-negotiable #4),
a session must carry the window it was judged under. If the portal resolved the chain live, a
studio-default change tonight would silently rewrite the cancellation terms of a class a member
booked last week — retroactively, invisibly, in her disfavour. That is exactly the class of bug
the policy snapshot exists to prevent.

**D14 (locked).** The chain is:

```
1. session-specific override
2. the service default in force AT SESSION CREATION
3. the studio default in force AT SESSION CREATION
4. the system default: 6 h
```

resolved **once, at session creation**, and stamped into
`policySnapshot.cancellationWindowHours`. **New settings affect only sessions created after
them.** Everything downstream — the cancel decider, the owner UI, the portal — reads the
snapshot, which they already do.

**A dead end in the current types that must be opened.** `SchedulingPolicy.cancellationWindowHours`
is a **required `number`** on every `Service`. Since every session has a service, and every
service has a concrete number, **levels 3 and 4 can never be reached** — the chain would be
decorative. To make inheritance real, the value must be able to say *"I don't have an opinion"*:

- `Service.policy.cancellationWindowHours: number | null` — `null` = **inherit the studio
  default**.
- Studio default: `number | null` — `null` = **inherit the system default (6 h)**.
- Session override: `number | null` — `null` = inherit the service.

Existing services all carry concrete numbers, so **nothing changes for them**: they keep
overriding, exactly as today. `null` is only ever chosen deliberately, from now on.

**What the session records.** The snapshot stores the **resolved** number; the
`class_session.scheduled` event records the effective window **and where it came from**
(`override | service | studio | system`) — so a year from now the log can answer *"why was this
class 4 hours?"* without re-deriving a chain from settings that have since changed. That is an
event-schema change (§15).

**Accepted consequence (D14):** editing the studio or service default does **not** change
already-created sessions. Confirmed by the owner.

**The portal never hard-codes 6.** It shows the number on the session — and if
`lateCancellationConsumesCredit` is `false`, it must **not** threaten a credit loss that will
not happen.

The portal's cancel screen states the truth in words, not a number in isolation: *"Bu dersi
**{X} saat** öncesine kadar ücretsiz iptal edebilirsiniz"*, and after the window: *"Bu ders için
iptal süresi doldu — iptal ederseniz hakkınız düşer."* (`lateCancellationConsumesCredit` is a
policy field, and it may be `false` — in which case we must **not** threaten her with a credit
loss that will not happen.)

---

## 10. Profile

| Member may change | Member may never change |
|---|---|
| e-posta | ad soyad |
| acil durum kişisi (ad) | telefon |
| acil durum telefonu | doğum tarihi |
| şifre | üyelik durumu (aktif/pasif) |

The immutable set is not a UI decision — **it is enforced in the Server Action**, which builds
the update from an allow-list of exactly four fields and ignores anything else in the request
body. A member cannot change her phone because the phone is her **login identity** and the
studio's link to her record; she cannot change her name or birth date because those are what
reception verifies her against.

Wanting a name corrected is a legitimate need with a legitimate answer: **she asks the studio**
(UX-6 — no dead end; the screen says so).

The existing `member.profile_updated` event already carries **changed field names only, no
PII** (AD-25) — so it works unchanged, with `actor: member`. **Emergency-contact phone is
normalised to E.164 or refused** (AD-40) — the same rule reception is held to.

Password change is a Firebase Auth operation (re-authentication required); it is **not** a
domain event about the member — it changes a credential, not a business fact.

---

## 11. QR — this **supersedes** Doc 15 · D1

Doc 15 §9 locked **D1: the QR encodes `memberId`** (an opaque ULID), and explicitly left "a
rotatable `checkInToken` … a clean future seam if QR leakage ever becomes a threat".

**The owner has now called that threat.** The reasoning is sound and I agree with it: a static
`memberId` QR is a **bearer token with no expiry**. Once a member can see her own QR on her own
phone, she can screenshot it and send it to a friend — and the friend walks in as her, forever.
That is a *product* leak, not a theoretical one, and it only becomes possible **because** of
this milestone.

**New decision (supersedes D1):**

- The portal's QR encodes a **short-lived, server-signed token** — `{ memberId, exp }` signed
  with a server secret; **~60 seconds**, auto-refreshing while the screen is open.
- **The scanner sends the token; the server verifies the signature and the expiry and derives
  the `memberId` from it.** A `memberId` scanned from anywhere else is not accepted.
- Doc 15's static-`memberId` QR remains valid **only** for the printed/reception-issued card,
  and even that should be reconsidered — **→ OQ-4**.

**D15 / D16 (locked). QR check-in is online-only, and the static QR is dead.**

Check-in sits on the **offline `/commands` path** (AD-15) precisely so reception's door keeps
working when the internet does not. A server-verified token is, by definition, an **online**
check. The owner has chosen correctness over offline tolerance for this one input — and the
cost is close to zero, because **the member's QR is already an online artefact**: her phone had
to reach the server to display it.

| | Rule |
|---|---|
| **QR check-in** | **Online-only.** A Server Action verifies the token — **signature · expiry · member · branch · not-already-used** — and only then records the check-in. |
| **The token** | Short-lived (~60 s), server-signed, **single-use**. Single-use needs a small server-side used-token store (a `jti` with a TTL); a token that has been redeemed is inert even inside its lifetime. |
| **`memberId` from the client** | **Never trusted.** It comes out of the verified signature, not out of the camera. |
| **No internet** | **No QR check-in.** Reception falls back to **manual member search** — which already exists and stays on the offline command path, untouched. |
| **Loose verification** | **Refused.** No offline QR validation, no trigger-side "verify later with a long TTL". A token whose expiry is checked minutes after it was scanned is not a short-lived token; it is a long-lived one wearing a costume. |
| **Static / printed QR** | **Deprecated now, removed at the v1.23 cutover.** The member-workspace QR card (`qr-card.tsx`) is marked deprecated in v1.21 and deleted during migration. A printed card carrying `memberId` re-opens exactly the leak D10 closes. |

**What this changes in the check-in path:** QR check-in becomes a **Server Action**, not a
`/commands` write. `checkIn.record` **stays** on the whitelist for reception's manual check-in —
so the offline whitelist does not change, and neither does the two-entry rule.

**A related hardening, worth doing regardless.** The check-in path **never loads the Member**:
`recordCheckIn` reads branch + presence + occupancy and decides
(`checkin/application/checkin.ts`), so *a scanned string that is not a real member id is written
as a `member.checked_in` for a member who does not exist.* Today the human at the desk is the
authentication (Doc 15 · D2), so this is latent. A server-verified token closes it by
construction — the `memberId` now comes from a signature, not from a camera.

---

## 12. Events — proposed (owner owns event schemas)

Per CLAUDE.md, **event schema changes are permanent and are the human's decision.** These are
proposals, not commitments:

| Event | Actor | Payload (no PII, I-13) |
|---|---|---|
| `member.invited` | receptionist / owner | `{ expiresAt }` — no token, no phone |
| `member.portal_activated` | **member** | `{}` |
| `member.portal_login` | **member** | `{}` — already catalogued (Doc 04, Phase 2) |
| `reservation.booked` / `.cancelled` / `.late_cancelled` | **member** | unchanged — only the actor is new |
| `member.profile_updated` | **member** | unchanged — `{ changedFields }` |

**The invite token never enters an event.** It is a credential; events are permanent.

Nothing here is a new *state machine* — the reservation lifecycle is untouched.

---

## 13. Decisions — locked by the owner's directive

| | Decision |
|---|---|
| **D1** | Reception creates the **Member record only**. The system issues an invite; the **member sets her own password**. Reception never knows it. |
| **D2** | Invite: **72 h**, **one active per member** (a new one supersedes the old), single-use, high-entropy secret, delivered manually (WhatsApp). |
| **D3** | Login is **phone + password**; the phone is E.164-normalised (AD-40). No SMS. |
| **D4** | Dashboard shows: next reservation · active packages · remaining credits · package end date · outstanding balance (if any) · the three actions. |
| **D5** | A member sees **only the sessions her active packages entitle her to** — the **union** of her entitlements' **categories** (the existing category wall, I-9.7). |
| **D6** | Class colour is bound to the **service category**, never the package name. Three category tokens in DS v2. |
| **D7** | **No new reservation logic.** The portal calls the existing deciders; **the server always re-validates**; the visible list is convenience, not authorization. |
| **D8** | The cancellation window is **resolved at session creation and stamped on the session** (AD-49 / I-24). The portal always displays the session's real window. |
| **D9** | Profile: member may change **e-mail, emergency contact (name + phone), password**; never name, phone, birth date, or status — **enforced server-side by an allow-list**. |
| **D10** | QR is a **short-lived server-verified token**, not a static `memberId`. **Supersedes Doc 15 · D1.** |
| **D11** | **Security:** a member principal has **no client-SDK read access**; the portal is server-rendered; **`memberId` always comes from the session cookie, never from the client**. |

---

## 14. The six questions — RESOLVED (owner, 2026-07-12)

| | Was | Now locked |
|---|---|---|
| **OQ-1 → D12** | category-level vs service-level eligibility | **Service-level.** Explicit `serviceId` list, **copied into the entitlement snapshot at purchase**. Editing a product never changes a right already sold. Eligibility is never inferred from a name or a category. |
| **OQ-2 → D13** | PT ownership derived vs modelled | **Modelled.** `ClassSession.assignedMemberId`. Assigned PT is visible and bookable **only** by that member; unassigned PT never appears in the portal. **Never derived from an existing reservation.** |
| **OQ-3 → D14** | does a settings change reach existing sessions? | **No.** The effective window is resolved and **stamped at session creation**; new settings affect only sessions created afterwards. Chain: session override → service default → studio default → **6 h**. |
| **OQ-4 → D15** | does the printed/static QR survive? | **No.** Static `memberId` / non-expiring bearer QR is **not accepted as secure**. Deprecated in v1.21, **removed at the v1.23 cutover**. Reception keeps manual search/check-in. |
| **OQ-5 → D16** | QR check-in online-only vs trigger-verified | **Online-only.** Short-lived, server-verified token (signature · expiry · member · branch · single-use). **No offline QR validation, no loose trigger-side verification.** No internet → manual check-in. |
| **OQ-6 → D17** | self-service password reset? | **Not in v1.21.** No verified channel exists. Reset = revoke sessions + invalidate the old invite + issue a new single-use 72 h invite. Self-service waits for a verified SMS/e-mail channel — its own milestone. |

**These six answers change the milestone's nature.** v1.21 is no longer "a new front-end on an
unchanged domain": D12, D13 and D14 are **domain changes, and each touches an event schema.**
That is not a reason to avoid them — they are all *correctness* moves, and correctness outranks
simplicity. But it must be said out loud, because event schemas are the one thing we cannot
take back.

---

## 15. Domain changes, event schemas, and migration impact

This is the section to argue with. Everything here is **permanent**.

### 15.1 Domain changes (three)

| # | Change | Module | New refusal |
|---|---|---|---|
| **1** | `ProductSnapshot.serviceIds` — copied at purchase; `decideBooking` checks `session.serviceId ∈ snapshot.serviceIds` | `entitlements` + `reservations` | `service_not_covered` |
| **2** | `ClassSession.assignedMemberId` — assigned PT bookable only by that member | `scheduling` + `reservations` | `session_not_assigned_to_member` |
| **3** | Cancellation-window chain: nullable `cancellationWindowHours` on service policy + a studio default + a per-session override, **resolved and stamped at creation** | `scheduling` | — (no new refusal; it is a resolution, not a rule) |

Plus one **policy field**: `allowMemberSelfBooking` on `SchedulingPolicy` (a `policyVersion`
bump, not a migration).

Every new refusal needs **Turkish copy that tells the member what to do next** — an error she
cannot act on is a phone call to the studio (UX-6).

### 15.2 Event-schema changes — the permanent part

| Event | Change | Requires |
|---|---|---|
| `entitlement.purchased` | payload carries the snapshot's `serviceIds` | **v2 + upcaster** |
| `class_session.scheduled` | payload carries `assignedMemberId` + the **effective cancellation window and its source** (`override \| service \| studio \| system`) | **v2 + upcaster** |
| `class_session.assigned` *(new)* | PT assignment / re-assignment after creation | new golden fixture |
| `member.invited` *(new)* | `{ expiresAt }` — **never the token** | new golden fixture |
| `member.portal_activated` *(new)* | `{}` | new golden fixture |
| `member.portal_login` | already catalogued (Doc 04, Phase 2) — now implemented | new golden fixture |

**The upcasters are the price of D12 and D13.** An old `entitlement.purchased` v1 has no
`serviceIds`; an old `class_session.scheduled` v1 has no `assignedMemberId`. The upcaster reads
them as **absent**, and absent has a defined meaning (below) — it never invents a value.

Golden fixtures come **before** the code (the feature recipe, CLAUDE.md), and **no payload gains
PII** — not the invite token, not a phone, not a name.

### 15.3 Migration impact — and the one thing we must NOT do

**No data backfill. None.** This is the load-bearing sentence of the whole milestone.

| Existing data | What happens |
|---|---|
| **Entitlements sold before D12** | `productSnapshot.serviceIds` is **absent** → they keep the **category-wide** rights they were sold under. **We do not backfill them from today's products.** Backfilling would retroactively narrow a right a member already paid for — the exact thing the owner's rule forbids. **Absence is not missing data; absence is the record of what was sold.** |
| **Sessions created before D13/D14** | `assignedMemberId` absent → **unassigned** (correct: nobody owned them). `policySnapshot.cancellationWindowHours` already holds a concrete number → the window they were created under is preserved, untouched. |
| **Services** | All carry a concrete `cancellationWindowHours` today → they keep overriding exactly as now. `null` ("inherit") is only ever chosen deliberately, going forward. |
| **The old static QR** | Deprecated in v1.21, **deleted at the v1.23 cutover**. Until then the member portal shows only the dynamic token; the static card is not re-issued. |
| **Events already written** | **Never touched.** Upcasters read old shapes; the log is append-only (unbreakable #1, #9). |

**Cutover interaction (v1.23).** The migration imports the old system's members and packages.
Those imported entitlements will be **new** writes — so they *can* carry `serviceIds` from the
start, if the source data supports the mapping. If it does not, they import as category-wide
legacy rights, and that is an honest representation of what the old system actually sold. **The
importer must not guess a service list from a package name** — that is D12's rule, and it binds
the migration too.

### 15.4 New index

`classSessions (assignedMemberId, startsAt)` — the portal's "my PT sessions" read. The **only**
new index; every other member-scoped query is already indexed.

## 16. What already exists vs. what v1.21 must build

The seam was designed for this milestone, and it holds. The **domain is essentially done**;
almost all the work is at the perimeter and the surface.

**Exists, reusable unchanged:**

- The `member` variant of `ActorRef` (`shared/actor.ts:18`) — an event written by a member is
  attributable *today*, no retrofit.
- The closed `Category` enum and the **category wall** (I-9.7) — the whole eligibility rule.
- `SchedulingPolicy` **snapshotted onto every session** (I-24 / AD-49) — the cancellation
  window is already policy-driven and pure.
- `bookReservation` · `cancelReservation` · `selectEntitlement` — **principal-agnostic**; they
  take `ctx.actor` and never ask who is calling.
- `Reservation` denormalises `sessionCategory`, so "**my** PT sessions" is a filter on a read
  that already exists — no new query, no new index.
- **Every member-scoped Firestore index already exists** — my reservations
  (`memberId, sessionStartsAt`), my credits (`memberId, status`), my check-ins
  (`memberId, occurredAt`). **The read side needs no new index.**
- `phoneNormalized` is already a unique document-id lookup (`/byPhone/{phoneNormalized}`) —
  which is exactly what "phone as username" needs.
- PII-free read shapes (`MemberReservationRow`, the upcoming-sessions row) are already
  portal-shaped.

**Must be built:**

| | Why it is new |
|---|---|
| **Self-scoped security rules** | The catch-all read rule exposes the whole studio to any `studioId`-claimed principal. **Highest severity; blocks everything.** |
| Member claims + `requireMemberContext()` | `parseStaffClaims` *rejects* `role: 'member'` today (`claims.ts:45`) — a fork, not an edit. `TenantContext.role` is `StaffRole` and has no member. |
| A **production claim-minting path** | Claims are minted **only by the emulator seed** (`tools/seed/index.ts:54`). There is no production path to create an auth user at all. |
| The invite mechanism | Does not exist in any form. |
| `allowMemberSelfBooking` on `SchedulingPolicy` | Named in the docs, absent from the code. |
| `member.invited` · `member.portal_activated` · `member.portal_login` | Two new, one catalogued. **Owner owns these schemas.** |
| A non-static QR credential | Today's QR is a raw static `memberId` (`qr-card.tsx:15`). |
| Category colour tokens | Three new semantic tokens in DS v2. |
| The portal surface | Login · set-password · dashboard · agenda · booking · cancel · profile · QR. |

**Note on `/commands`:** the rule requires `actor.id == request.auth.uid`. A member's Firebase
`uid` is not her `MemberId`, so a member **cannot** write a command — which is exactly the
outcome §2 wants, and it means the whitelist does not need to change. It stays two entries.

## 17. Sequencing — domain before perimeter before surface

The order is not negotiable: **the domain changes come first**, because they are the permanent
ones and everything else is built on their shape. The portal is the *last* thing built, because
it is the only thing that is cheap to rebuild (CLAUDE.md, the feature recipe).

| Batch | Work | Gate |
|---|---|---|
| **1 — Domain: eligibility (D12)** | `ProductSnapshot.serviceIds` · `entitlement.purchased` **v2 + upcaster** · `decideBooking` + `isBookable` service check · `service_not_covered` + Turkish copy · product form requires ≥1 service | golden fixtures first; table-driven decider tests incl. the **legacy-absent** case |
| **2 — Domain: PT ownership (D13)** | `ClassSession.assignedMemberId` · `class_session.scheduled` **v2 + upcaster** · `class_session.assigned` · booking refusal · owner session form "Üyeye ata" · new index | decider tests: assigned/unassigned/other-member |
| **3 — Domain: cancellation chain (D14)** | nullable service window · studio default · session override · **resolve-and-stamp at creation** · window source on the event | boundary tests (`exactly 6 h` is not `5 h 59 m`) |
| **4 — Perimeter** | member claims · `requireMemberContext()` · **tightened Firestore rules** · `allowMemberSelfBooking` · **rules tests** | **a member token must be able to read nothing** |
| **5 — Invite & activation** | invite doc (72 h, single active, single use) · `member.invited` / `member.portal_activated` / `member.portal_login` · reception's "Davet Linki" action · **session revocation** (reset path, D17) · set-password screen | rules + integration |
| **6 — Portal: shell + dashboard** | DS v2, mobile-first | 375 · 430 · 768 · 1280 |
| **7 — Portal: agenda + booking + cancel** | eligibility filter (service-level) · category colour tokens · the **real** window · the refusals in Turkish | — |
| **8 — Portal: profile + dynamic QR** | 4-field allow-list · short-lived signed token · single-use store · **static QR marked deprecated** | — |

`pnpm check` + `next build` green at every batch. **Rules tests are not optional in this
milestone** — they are the milestone.

**Batches 1–3 are, strictly speaking, not "member portal" work.** They are domain corrections
the portal *forces us to confront*. If the owner ever wants to ship them separately, batches
1–3 are a coherent milestone on their own and 4–8 depend on them — not the other way round.

## 18. Risks

- **The perimeter is the whole milestone.** A member principal on today's rules is a
  studio-wide PII leak. This is why §2 comes before every screen.
- **A member is not reception.** Every refusal she can hit needs Turkish copy that tells her
  what to do next (UX-6) — an error she cannot act on is a support call.
- **Scope pressure.** Payments, waitlist, and notifications will all feel "small" from inside
  this milestone. They are not in it.
