# External dependencies — what is finished in code and waiting on the outside world

**This is not a to-do list and it is not the debt register.** Every item below is **complete on our
side**: the port exists, the mapping exists, the tests pass against a mock, and the pipeline around it
is exercised end to end. What is missing is a credential, a contract, or a DNS record — something no
amount of engineering produces.

They are collected here because the alternative is worse: an unlisted external blocker gets discovered
on cutover morning, by reception, when the message does not arrive.

> **The rule.** Nothing here is "half-built". If it were half-built it would be in
> [`ALPHA-GAPS.md`](ALPHA-GAPS.md). Each of these is one config value away from live.

---

## ED-1 — WhatsApp: the Meta transport

**Status:** code complete · **Blocked on:** a Meta Business account, a verified sender number, and
approved message templates. **Owner:** Yunus.

**What exists in code (v1.25, verified at Alpha closure):**

- `WhatsAppProvider` (`notifications/infrastructure/providers.ts`) implements the same
  `NotificationProvider` port as e-mail. Nothing above it knows which channel it is talking to.
- `META_TEMPLATE` — our template ids mapped to the names Meta approves. A template Meta has **not**
  approved is refused **permanently and loudly**: Meta would accept the request and silently drop the
  message, and we would report `sent` for something nobody ever received. That is the worst outcome
  available to us, so it is the one case that is hard-refused.
- The 24-hour window, the params pass-through, permanent-vs-transient error classification, and the
  "unclassifiable error ⇒ permanent, we never spend money on a guess" rule — all tested.
- **It is a MOCK until it is given a transport.** The constructor takes the send function; absent, the
  whole pipeline — intent → attempt → retry → quiet hours → the Notification Center — runs and is
  provable **without a Meta contract**. That is deliberate, and it is why this is a credential
  dependency rather than an engineering one.

**Go-live steps (no code):**

1. Meta Business account + verified sender number.
2. Submit the templates named in `META_TEMPLATE` for approval.
3. Set the credentials as secrets; construct `WhatsAppProvider` with the real send function.
4. Webhook signature verification is a *deploy-time* config, not a code change.

**Until then:** WhatsApp is **off**, and the Notification Center says so. Messages fall to in-app and
e-mail. Nothing silently pretends to have sent.

---

## ED-2 — E-mail: the Resend API key and DNS

**Status:** code complete (v1.25) · **Blocked on:** a Resend API key and the studio's SPF/DKIM records.

`ResendEmailProvider` is written and tested (idempotency key, 4xx = permanent, 429/5xx = transient, a
network failure = transient). It reports **sent**, never **delivered** — a claim we cannot make is a
claim we do not make.

Without the DNS records the mail will send and land in spam, which is worse than not sending: it looks
like it worked. **Set the records before the key.**

---

## ED-3 — Firebase: the production project

**Status:** code complete · **Blocked on:** the production project, its secrets, and the first deploy.

- `apps/web/src/server/secrets.ts` **refuses to start** in a deployed environment without its secrets.
  A missing secret is a boot failure, never a silent fallback to a dev value.
- QR token rotation is a secret **list** (`QR_TOKEN_SECRET` + `QR_TOKEN_SECRET_PREVIOUS`).
- Functions are pinned to `europe-west1`, next to the `eur3` Firestore.
- The first user is created by `pnpm bootstrap:owner` — there is no setup wizard, deliberately: a
  public "create the first owner" endpoint is a public "create an owner" endpoint on the day somebody
  forgets to remove it.

See [`CUTOVER.md`](CUTOVER.md) for the order of operations and [`RUNBOOK.md`](RUNBOOK.md) for what to
do when one of the five health signals fires.

---

## ED-4 — The emulator needs a JVM

**Status:** resolved on this machine · **Note:** the Firebase emulator is a Java program.

`pnpm test:integration` and `pnpm emulators` now locate a JDK themselves (`/usr/libexec/java_home`,
falling back to Homebrew's `openjdk`). A fresh machine with no JDK will fail with *"Unable to locate a
Java Runtime"* — install one, and nothing else changes.
