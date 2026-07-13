# 28 — Notification Center (v1.25)

**Status:** **APPROVED and BUILT** (owner, 2026-07-13). All six decisions are locked — §12.
**Date:** 2026-07-13
**Milestone:** v1.25 — the channel the product has been missing

---

## 0. Why this is not a "send an SMS" feature

Three things make notifications dangerous in a way that the last three milestones were not:

1. **They leave the building.** Every other write in this system is reversible inside our own
   database. A sent SMS cannot be unsent. There is no compensating event for a message a member has
   already read.
2. **They cost money, per unit.** A bug in a projection is a wrong number. A bug in a notification
   loop is an **invoice**. The closure that cancelled 54 reservations must not become 54 SMS to the
   same member — and *that* is an architectural requirement, not an optimisation.
3. **They are regulated.** An operational message ("dersiniz iptal edildi") and a marketing message
   ("yeni kampanya!") look identical to a developer and are legally different acts under KVKK. Get
   the line wrong once and the studio is the one who pays.

The architecture below is shaped by those three facts more than by any feature on the owner's list.

---

## 1. The model the owner asked for, and why it is right

> **Event → Notification Intent → Delivery Attempt**

Three aggregates, three different lifetimes, and the separation is load-bearing:

```
 DOMAIN EVENT                 NOTIFICATION INTENT              DELIVERY ATTEMPT
 (already exists,             "this member should be           "we tried to reach her
  immutable, free)             told this thing"                 on THIS channel"
       │                              │                                │
       │  a pure RULES TABLE          │  fan-out per channel,          │  retries, provider refs,
       │  (event type → intent)       │  filtered by preference        │  status, error, cost
       ▼                              ▼                                ▼
  reservation.booked  ──────►  intent: booking_confirmed  ──┬──► attempt(in_app)  → delivered
                                                            ├──► attempt(sms)     → failed → retry
                                                            └──► attempt(email)   → suppressed
```

**Why the domain must never call `sendSms()`:** a booking that fails because an SMS gateway is down
is an outage the studio did not sign up for. The domain writes its event and finishes. Everything
below is downstream, asynchronous, and failable — *and a failure there must never fail the thing that
actually happened.*

**Why the intent exists at all** (rather than event → attempt): the intent is the **decision to
inform**, and it is where every business rule lives — audience, category, preferences, consent,
quiet hours, deduplication. The attempt is pure plumbing. Collapsing them puts KVKK logic inside a
retry loop, which is exactly where nobody will find it in 2028.

---

## 2. The three aggregates

### 2.1 `NotificationIntent`

```ts
{
  id, studioId,
  eventId, operationId,        // OP-2 — the act that caused it. The Activity Center joins on this.
  templateId, templateVersion, // the template as it was AT SEND TIME (snapshot rule, again)
  category: 'operational' | 'marketing',   // the KVKK line, decided at creation — §6
  recipient: { kind: 'member' | 'staff', id },
  params: Record<string, string>,          // rendered values, resolved from STATE at creation
  channels: Channel[],                     // after preferences & consent were applied
  status: 'pending' | 'dispatched' | 'cancelled',
  createdAt,
}
```

**`params` is resolved from state, never copied from the event** — because events carry no PII (#6)
and a message needs a name, a phone, a class time. The intent is where identity and behaviour finally
meet, and it is therefore **PII-bearing**: it lives in `/notificationIntents`, it is erasable with the
member, and **nothing about its content ever goes back into `/events`**.

> **New invariant, I-38: a notification's rendered body never enters the event log.** The events say
> *that* we tried to reach her, on which channel, with which template, and how it went. They never say
> what the message said, and they never carry her phone number.

### 2.2 `DeliveryAttempt`

```ts
{
  id, intentId, channel, provider,
  status: 'pending' | 'queued' | 'sent' | 'delivered' | 'failed' | 'cancelled' | 'suppressed',
  attemptNo, nextRetryAt, error: { code, message } | null,
  providerRef: string | null,   // evidence, not truth
  sentAt, deliveredAt, costKurus | null,
}
```

**One attempt chain per channel, and the channels are independent.** SMS failing does not touch the
in-app notification, which is already delivered. This is the owner's rule 3, and it falls out of the
model for free.

### 2.3 `NotificationTemplate` — data, never code (AD-41, again)

```ts
{ id, version, name, category, channels: { sms?: string, email?: {subject, body}, ... },
  requiredParams: string[], active }
```

Turkish text, `{{memberName}}` placeholders, versioned. **A technical event name never appears in a
template** (owner rule 7) — and the same discipline as the v1.22 presenter applies: a template that
fails to render every required param is a **failing test**, not a message that says
`Merhaba {{memberName}}`.

**The version is stamped on the intent.** Years later, "what exactly did you send me?" has an exact
answer — the same reason `productSnapshot` and `SaleLine` exist.

---

## 3. Provider ports — and the truth about delivery

```ts
interface NotificationProvider {
  readonly channel: Channel
  send(message: RenderedMessage): Promise<ProviderResult>   // { providerRef, accepted }
  // Optional: a webhook the provider calls back on. Verified, idempotent — like the POS webhook.
}
```

**The provider's answer is evidence, not truth** (owner rule 4). Our `DeliveryAttempt` is the record;
a provider callback *updates* it and never *is* it. Providers lose messages, report `delivered` for a
phone that was disconnected, and go out of business. The studio's own log survives all three.

**Every provider webhook is verified and idempotent**, and — exactly as decided for the POS webhook
in Doc 27 — it **writes a `/commands` document, never state**. It is untrusted input at a public
endpoint; there is one door for that in this system, and it already exists.

---

## 4. Deduplication and batching — the requirement that is really about money

A studio closure cancels 54 reservations. Twelve of them belong to Ayşe.

**Ayşe must receive ONE message.** Not twelve. This is not a nicety; it is the difference between a
notification system and a harassment system, and — at 0,15 ₺ per SMS across a real studio — it is also
the difference between a bill and a mistake.

Two mechanisms, both in the intent layer:

- **Collapse by `(recipient, operationId, template)`.** Every event of a bulk act carries the same
  OperationId (OP-2 — this is the second time that decision pays for itself). One intent per member
  per operation, with the *count* as a param: *"Kurban Bayramı nedeniyle 12 dersiniz iptal edildi,
  kredileriniz iade edildi."*
- **A short aggregation window** (seconds) for high-frequency events, so a recurring booking of eight
  sessions becomes *"8 ders rezervasyonunuz oluşturuldu"*, not eight messages.

**And a hard ceiling.** A per-studio, per-day send budget (data, in settings). When it trips, intents
are created but attempts are **suppressed** and the owner is told, loudly. A runaway loop must cost a
warning, not a month's revenue.

---

## 5. Retry — per channel, as data

```
in_app : no retry (it is a write to our own database; if that fails, everything is failing)
push   : 3 attempts, 1m / 5m / 30m
email  : 3 attempts, 5m / 30m / 4h
sms    : 2 attempts, 5m / 1h        ← every retry costs money; the ceiling is deliberate
whatsapp: 2 attempts, 5m / 1h
```

**The policy is data** (studio settings / policy document), not an `if` — the same rule as the
cancellation window, the low-credit threshold and the discount ceiling (#4).

A scheduled worker sweeps `nextRetryAt <= now`. **A permanent failure is not retried**: an invalid
phone number will still be invalid in an hour, and retrying it is a bill with no upside. The error
taxonomy therefore has to distinguish `permanent` from `transient` — and when a provider will not
tell us which, we treat it as permanent, because the alternative spends money on a guess.

---

## 6. The KVKK line — operational vs marketing (owner rule 6)

This is the decision that must be right on day one, because getting it wrong is not a bug — it is a
regulatory finding.

| | **Operational** | **Marketing** |
|---|---|---|
| Examples | booking confirmed, class cancelled, payment received, invite link, password reset, low credits, instalment due | campaign, new class announcement, "we miss you", birthday offer |
| Legal basis (KVKK) | performance of the contract — **no separate consent required** | **explicit consent (açık rıza)**, per channel, with a record |
| Can the member turn it off? | **Channel preferences yes; the message no.** She may say "not by SMS", she may not say "never tell me my class was cancelled" | Yes, and the opt-out must be honoured immediately and permanently |
| Consent record | not required | **required**: who, when, which channel, from which surface — stored, and shown in her profile |

**Two rules fall out, and they are absolute:**

1. **`category` is set at intent creation, from the template — never at send time.** A template is
   born operational or marketing; there is no reclassification, because reclassification is how a
   campaign gets sent under the contract's legal basis.
2. **An operational message can never be blocked by a marketing opt-out**, and a marketing message
   can never be sent without a consent record. The `suppressed` status exists to make that visible:
   *we chose not to send this, and here is why.*

**Phase 1 ships operational only.** Marketing needs a consent-collection surface, an opt-out link, and
a legal review — and that is a milestone, not a checkbox. The seam is here from day one so that adding
it later cannot accidentally reuse the operational path.

---

## 7. Preferences

Per member, per channel: `sms · whatsapp · email · push · in_app` — on/off. Plus quiet hours
(studio-level, e.g. 22:00–08:00: operational messages queue until morning unless the template is
marked `urgent`, e.g. "your class in 2 hours is cancelled").

**`in_app` cannot be turned off.** It is not a message; it is her record of what happened to her
account. Turning it off would be turning off her own history.

**Where preferences live:** on the member (`/members/{id}.notificationPrefs`). Changing them is an
event (`member.notification_prefs_changed`) — carrying the *flags*, never the phone number.

---

## 8. Channels — and what actually ships

| Channel | v1.25 | Notes |
|---|---|---|
| **In-app** | **ships** | No provider, no cost, no consent question. It is a write to our own database and a screen in the portal. It should have existed already. |
| **E-mail** | **ships** | Cheap, no per-message billing surprise, no template pre-approval. |
| **SMS** | **port + one adapter** | The Turkish market means a local gateway (NetGSM / İleti Merkezi / Twilio). Per-message cost ⇒ the ceiling in §4 is a prerequisite, not a nicety. |
| **WhatsApp** | **port only** | WhatsApp Business API requires pre-approved templates, a verified business, and a 24-hour session window with different rules inside and outside it. That is an integration project, and pretending otherwise is how a milestone doubles. |
| **Push** | **port only** | Needs FCM tokens, a PWA/app install story, and a permission prompt. The member portal is a web app today. |

**The point of the port:** adding WhatsApp later must be *an adapter and a template*, not a redesign.
That is the whole reason the intent does not know what a channel is.

---

## 9. Where intents come from

A **pure rules table**, consumed by the existing `onEventCreated` trigger (it already has a projector;
this is its second consumer):

```ts
// event type → what to say, to whom, in which category. PURE, table-driven, unit-testable.
const RULES: Record<EventType, IntentRule[]> = {
  'reservation.booked':        [{ template: 'booking_confirmed',  to: 'member',  category: 'operational' }],
  'reservation.moved':         [{ template: 'booking_moved',      to: 'member',  category: 'operational' }],
  'class_session.cancelled':   [{ template: 'session_cancelled',  to: 'roster',  category: 'operational' }],
  'waitlist.promoted':         [{ template: 'waitlist_promoted',  to: 'member',  category: 'operational' }],
  'entitlement.expiring':      [{ template: 'package_expiring',   to: 'member',  category: 'operational' }],
  'payment.received':          [{ template: 'payment_received',   to: 'member',  category: 'operational' }],
  'drawer.discrepancy_recorded': [{ template: 'cash_discrepancy', to: 'owner',   category: 'operational' }],
  …
}
```

**Note `to: 'owner'`.** The owner's list ends with *"sistemsel hata veya başarısız operasyon"* — and
that is the most important line on it. A failed bulk operation, a cash discrepancy, a projection that
stopped folding, a payment webhook that failed signature verification: **the person who needs to know
is the owner, and today nothing tells her.** Staff notifications are not an afterthought in this
design; they are half of it.

**Some of these events do not exist yet** — nothing emits "your package expires in three days",
because nothing happened; time merely passed. Those come from a **scheduled scanner** (the sweep
pattern from v1.10) that emits `entitlement.expiring` / `plan.instalment_due` / `credits.low` once,
idempotently, per member per window. *A reminder is a domain event, not a cron job that sends an SMS.*

---

## 10. Idempotency — because the trigger is at-least-once

The intent's id is **derived, not random**: `hash(eventId, templateId, recipientId)`. A redelivered
event finds the intent already there and does nothing. The same discipline as the daily projection's
marker documents, and for the same reason: *a duplicated notification is worse than a missing one,
because the member learns to ignore us.*

Provider webhooks are idempotent on `providerRef`.

---

## 11. The Notification Center screen (owner rule 10)

One row per **attempt**, with everything the owner asked for: message · recipient · channel · time
(GG.AA.YYYY HH:mm:ss) · what triggered it (the event, in Turkish, through the v1.22 presenter) ·
status · error · retry count · **OperationId** (clickable → the operation that caused it).

Plus the two views that make it a working screen rather than a log:

- **Failed deliveries** — the owner's actual question is *"who did we fail to reach?"*, and a member
  who was never told her class was cancelled is a phone call reception must make **today**.
- **Suppressed** — with the reason (preference · no consent · quiet hours · budget ceiling). A silent
  suppression is indistinguishable from a bug.

Manual **re-send**, owner-only, with a reason — because sometimes the answer to a failed delivery is a
human deciding to try again.

---

## 12. Open questions — the owner's call

**OQ-1 — Which channels actually ship in v1.25?**
*Recommendation:* **in-app + e-mail now; SMS with one Turkish adapter (NetGSM or İleti Merkezi);
WhatsApp and push as ports only.* WhatsApp's template pre-approval and session-window rules are a
milestone of their own, and shipping it half-done means shipping it twice.

**OQ-2 — SMS gateway and sender ID.** Which provider, and what is the *başlık* (sender name) the studio
has registered? This is a procurement question with a lead time — if it is not started now, v1.25 ships
with a port and no SMS.

**OQ-3 — The daily send ceiling.** *Recommendation: a per-studio daily cap in settings (data), with the
owner alerted when it trips.* A runaway loop must cost a warning, not a month's revenue.

**OQ-4 — Quiet hours.** *Recommendation: 22:00–08:00, operational messages queue; `urgent` templates
(a class cancelled within 12 hours) send anyway.* The alternative — waking a member at 23:40 to tell
her tomorrow's class moved — is worse than the delay.

**OQ-5 — Marketing: now or later?** *Recommendation: **later**, and the seam is in place. It needs a
consent surface, an opt-out link in every message, and a legal review.*

**OQ-6 — Who gets the operational alerts?** Owner only, or owner + reception? *Recommendation: a cash
discrepancy and a failed bulk operation go to the **owner**; a failed member delivery goes to
**reception**, because reception is who will pick up the phone.*

---

## 13. What v1.25 does NOT build

- No marketing campaigns, no segments, no scheduling UI (v1.25 sends what *happened*, not what someone
  decided to say).
- No WhatsApp integration, no push tokens, no in-app chat.
- No notification content in the event log (I-38).
- **No coupling of the domain to a channel.** Not one line in `packages/core/modules/{reservations,
  finance,…}` learns that notifications exist.

---

## 13.1 As built

- **Channels:** in-app + e-mail ship. SMS, WhatsApp and push are **ports** with a `MockSmsProvider`
  behind them, so the whole pipeline — intent, attempt, retry, permanent-vs-transient failure, the
  Notification Center — is proven end to end without a contract, a sender ID or a kuruş of SMS credit.
  The real adapter lands after Production Hardening, **in one file, changing nothing else**.
- **Reminders are DOMAIN EVENTS.** `entitlement.expiring` and `entitlement.credits_low` are emitted by
  a scheduled scanner (idempotent, one marker per entitlement per window) — not by a cron job that
  reaches for a gateway. They therefore appear in the member's timeline, obey the same rules table and
  collapse under the same OperationId.
- **Staff alerts work:** a cash discrepancy reaches the owner; a failed delivery reaches reception.
- **The daily ceiling, quiet hours and per-channel retry are all DATA** (studio settings / policy),
  never literals.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| A bulk operation floods a member (and the bill) | Collapse by `(recipient, operationId, template)` (§4) + a daily ceiling |
| A marketing message is sent on the operational legal basis | `category` is fixed by the template at intent creation and can never be reclassified (§6) |
| The provider says "delivered" and the member never got it | Our aggregate is the truth; the provider's answer is evidence (§3). Failed and suppressed are both visible |
| A retry loop on a permanently invalid number | Permanent vs transient error taxonomy; unknown ⇒ **permanent** (do not spend money on a guess) |
| PII leaks into the log through a rendered message | I-38, enforced by a golden test over every notification event's payload |
| Notification failure breaks a booking | The domain never calls a provider. Intents are created downstream of the event, and a failure there is a failed *delivery*, never a failed *booking* |
