# Handover — where this project actually is

**Read this first in a new session.** It is the only document that answers "what is live, what is
half-done, and what is somebody waiting on". Everything else in `docs/` explains the system; this
explains the moment.

Keep it current the way the code is kept current: when the state changes, this changes in the same
commit. A handover document that lags is worse than none, because it is believed.

_Last true as of: **2026-08-01**._

---

## What this is, in one line

A live, multi-tenant Studio Operating System. One studio uses it for real — **Pilates Fitness by
Işıl**, 120 members — and it is the only system they have: they retired the old one on 2026-07-27.
A day this panel cannot open is a day the business cannot run.

- Panel · `panel.pilatesfitnessbyisil.com` (Firebase App Hosting, `studio-yonetim-prod`, europe-west4)
- Public site · `pilatesfitnessbyisil.com` — separate static site, reads prices from `/api/public/products`
- Studio id · `retro`. Nothing in the code may assume it is the only one.

---

## Live and working

Reservations, check-in (desk · kiosk · **printed daily QR**), attendance, the credit ledger,
packages incl. hybrids, payments through PAYTR (card, links, wallet), the member portal, the member
mobile app, WhatsApp AI reception, notifications, reports, payroll, and a nightly infrastructure
watchdog (domain expiry, TLS, reachability, renewal dates + a Monday heartbeat).

**Members can buy and renew their own packages** from the app and the portal. A renewal is QUEUED
behind the package it renews so no paid day burns unused; a hybrid queues behind every category it
grants and refuses when they disagree. The studio is notified the moment a self-service sale lands.

## Store state

| | Version | Where |
|---|---|---|
| iOS | 1.0.1 (build 4) | **LIVE on the App Store** — approved 2026-07-29 night, in members' hands. |
| Android | 1.0.1 (build 5) | **in closed test**, running normally. |

**Android's production clock is running: 12 testers, day 3 of 14 (2026-07-29).** If a tester leaves
the test the counter RESETS. Do not remove testers. Publishing new builds does not reset it —
which is why the 1.1.0 pair below can be built when its turn comes without costing a day.

**Next mobile release is 1.1.0**, holding two approved-and-deferred items: PF-42 (swap Cüzdan out of
the tab bar for Üyeliğim) and PF-43 (collapse past reservations, mobile + web). Both are specified
file-by-file in `docs/PRODUCT-FEEDBACK.md`. iOS is now clear of review, so the only remaining
constraint is that they ship together in one build rather than one review turn each.

Submissions are automated: `cd apps/mobile && npx eas-cli submit --platform android --profile
production --latest`. The Play service account key is gitignored at
`apps/mobile/google-play-service-account.json` (`eas-play-submit@studio-yonetim-prod...`); the
`androidpublisher` API is enabled on the project. iOS submits the same way but the App Store version
must still be created and sent for review by hand.

---

## Waiting on the owner

- **iOS 1.1.0 is built and uploaded; the App Store version has to be created by hand.** App Store
  Connect → + Version → 1.1.0 → fill "What's New" in BOTH Turkish and English (an empty Turkish
  field greys out "Add for Review", which cost a day last week) → pick build 5 → submit.
  Test credentials for the reviewer: `0500 000 00 01` / `Yu156211` — a member with a live package
  and a programme, excluded from every report.
- **The Meta invite template `uyelik_daveti_v2`.** Text is drafted and ready to paste into WhatsApp
  Manager (name, category Utility, Turkish, body and the two sample values) — see the section below.
  Once Meta approves it, the code change is ONE line in
  `packages/core/src/modules/notifications/infrastructure/providers.ts`, written out in a comment
  right above the current mapping. Do not switch before approval: an unapproved template name is
  refused at send time and every invitation fails silently.
- **Eighteen active members still hold no package.** After the fitness import that is most likely
  the genuine number (lapsed, or leads entered as members) rather than migration debt — worth one
  look before assuming either way.
- **Sixty-six invitations are still unopened.** The invite screen has the filter and a one-tap
  reminder that mints a fresh link.

## Waiting on us

- **The freeze initiative (OR-21) is DEPLOYED and unexercised.** The owner may freeze past a member's
  allowance — fourteen days on a seven-day package — deliberately, behind a tick, recorded as
  `overageDays`. Shipped the night of 2026-08-01: App Hosting revision `build-2026-07-31-016` (the
  name is UTC; see the RUNBOOK) and a functions deploy, because the nightly sweep reads the approved
  duration now. **It has no unit tests** (the owner's call, taken knowingly): the ordinary freeze
  arithmetic is covered as before, and the override path was reasoned through rather than asserted.
  Nobody has used it on a real member yet — worth watching the first one: the membership must extend
  by the approved days (not the budget), the allowance must read 0, and the sweep must resume her on
  the approved day. If it misbehaves, the two places to look are `grantedDays` in `decideFreeze` and
  `budgetEndsOn` in the sweep.
- **Nothing from 2026-07-31 is unfinished.** The fitness migration (61 packages), the programme
  rollout (65 members on the real starter plan), the import wizard, the QR fix and the mobile 1.1.0
  build all landed. The evening added the check-out policy (OR-20) and a camera in the member's web
  panel; both deployed the same night — App Hosting revision `build-2026-07-31-014` and a functions
  deploy that created the hourly `occupancySweep`. Five separate defects were introduced and fixed the same day, every one of them
  a hand-written Firestore document that did not match its declared type — see the note under
  "Things that will bite you".
- **Hybrid purchase, tested live.** One sale must produce N entitlements correctly through the real
  PAYTR path. The rules are written and unit-tested; the path has never run in production.
- **External uptime monitoring.** The watchdog cannot report its own suspension — if the project is
  suspended over an unpaid bill, every alarm goes quiet, which looks exactly like all-clear. The
  Monday heartbeat covers this partially by making silence the signal.
- **Product roadmap Faz A** (`docs/PRODUCT-ROADMAP.md`) — per-studio WhatsApp number, per-studio
  e-mail sender, one-command studio provisioning. Nothing blocks a second studio until these exist.
  No urgency; a second studio (Novozen) has asked but nothing is agreed.

---

## Things that will bite you

Read `docs/OWNER-RULES.md` §"Traps" before touching the areas it names. In short:

- **Every deploy breaks whatever tab is already open.** Next.js gives each Server Action a
  content-hashed id baked into the page; a new build changes the ids, and a page loaded before it
  gets `Failed to find Server Action … from an older or newer deployment` on the next save. It looks
  like the feature is broken. It is not — that copy of the panel is stale.
  **So: batch fixes into one push while the studio is open, and tell reception to reload once after.**
  Three pushes in ninety minutes on 2026-07-29 cost reception a member registration she could not
  save and a member an invite she could not activate; both were healthy, both tabs were not.
  Staff forms now name the cause and offer a reload button; the invite page reloads itself
  (`apps/web/src/lib/stale-deployment.ts`). Neither helps a page that was already open — only the
  reload does.
- **"Deploy oldu mu?" sorusunun tek doğru cevabı Cloud Run'ın trafik dağılımıdır.** App Hosting'in
  `builds`/`rollouts` listeleme uçları sıralamasız çağrıldığında eski bir sayfa döndürüyor ve
  2026-07-30'da iki kez "deploy tetiklenmedi" diye yanlış teşhise yol açtı — dağıtım çalışıyordu.
  Komut `docs/RUNBOOK.md`'de. Yanlış bir yeşil, kırmızıdan kötüdür: o gün stüdyo açıkken deploy
  edilmediği sanıldığı için resepsiyona haber verilmedi (OR-17).
- **Never hand-write a production document. Go through the use-case.** On 2026-07-31 five documents
  were written directly, each missing or mistyping a field its type declares, and each broke
  something: an `archivedAt` froze the member workspace; an entitlement with numeric dates where
  Timestamps were expected TOOK THE WHOLE PANEL DOWN; a `createdAt` on five exercises broke the
  training panel again; `photoUrl: ''` (the type says `string | null`) crashed the exercise detail;
  and two programme templates written with four of their nine fields showed as passive and
  unlabelled. The type is the contract — the screen you happen to be looking at is one reader of it.
  If no use-case exists for what you need, write one.
- **Core changes need TWO deploys.** Push updates App Hosting; the Cloud Functions need
  `firebase deploy --only functions`. The PAYTR callback that actually runs is the FUNCTION.
- **The emulator does not enforce Firestore indexes.** Ordering changes must be verified in prod.
- **`pnpm check` does not run `next build`.** Some rules only exist there (DEBT-031).
- **Production data is never edited by hand.** A paid-but-not-granted payment is settled through the
  break-glass endpoint on the callback function (`?admin=settle`, token = `WHATSAPP_VERIFY_TOKEN`),
  which runs the same domain path and writes the same events, with the actor recorded as
  `platform_admin/break_glass`.

## The invite template waiting for Meta approval

Paste into WhatsApp Manager → Message Templates → Create.

- **Name** `uyelik_daveti_v2` · **Category** Utility / "Bilgilendirme" · **Language** Turkish (tr)
- No header, no footer, no buttons.
- **Body:**

```
Merhaba {{1}} 🌸 Pilates Fitness by Işıl'da üyeliğin artık dijital. Derslerini kendin ayırtabilir, kalan ders hakkını ve antrenman programını görebilirsin.

Üyelik sayfan hazır, buradan açabilirsin:
{{2}}

Daha sonra dilediğin zaman şu adresten ulaşırsın:
https://panel.pilatesfitnessbyisil.com/portal/login?s=retro

Bir sorun olursa bize yazman yeterli, yardımcı olalım 💛
```

- **Samples** (Meta refuses to review without them): `{{1}}` = `Ayşe`,
  `{{2}}` = `https://panel.pilatesfitnessbyisil.com/invite/retro/ORNEK-BAGLANTI`

### Do NOT accept the "Kimlik Doğrulama" category Meta suggests

Meta's classifier reads "şifreni oluştur" and "giriş yaparsın" as authentication and offers that
category as *Recommended*. It is a trap. Authentication templates are locked to a one-time-passcode
shape — fixed body, copy-code button, no arbitrary links — so ours cannot exist there at all, and
accepting it would break invitations entirely.

The category is genuinely Utility: this is a message about an account the member already has. The
wording above therefore says nothing about passwords or logging in; the invite page explains that
step when she arrives, which is where the explanation belongs anyway.

### If it is still rejected

Replace the second URL with a button: name `Giriş sayfası`, static URL
`https://panel.pilatesfitnessbyisil.com/portal/login?s=retro`. Meta prefers URLs in buttons, and a
body with only one link classifies more cleanly.

## Where the rest lives

| | |
|---|---|
| Why the system is shaped this way | `docs/architecture/` (`AD-nn`, 21 invariants) |
| How we work, milestone policy | `docs/architecture/10-development-workflow.md` |
| Standing owner decisions | `docs/OWNER-RULES.md` |
| Deliberate debt + repayment triggers | `docs/DEBT.md` |
| Ideas raised, not yet built | `docs/PRODUCT-FEEDBACK.md` (`PF-nn`) |
| Selling this to a second studio | `docs/PRODUCT-ROADMAP.md` |
| Operational procedures, backups | `docs/RUNBOOK.md` |
| What changed, milestone by milestone | `CHANGELOG.md` |

**And the git log.** Commit messages in this repository are written to explain *why*, not what —
`git log --oneline` is the honest history of every decision, including the ones that turned out
wrong and were reversed.
