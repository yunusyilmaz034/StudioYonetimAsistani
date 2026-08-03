# Handover — where this project actually is

**Read this first in a new session.** It is the only document that answers "what is live, what is
half-done, and what is somebody waiting on". Everything else in `docs/` explains the system; this
explains the moment.

Keep it current the way the code is kept current: when the state changes, this changes in the same
commit. A handover document that lags is worse than none, because it is believed.

_Last true as of: **2026-08-03**._

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

Members are **Aktif, Duraklatılmış or Pasif** (OR-23) — the first two derived from the ledger, so they
are never stale. Memberships can be frozen, including past the allowance when the owner decides so
(OR-21). The movement guide and an in-app video player are in both the portal and the app.

**Members can buy and renew their own packages** from the app and the portal. A renewal is QUEUED
behind the package it renews so no paid day burns unused; a hybrid queues behind every category it
grants and refuses when they disagree. The studio is notified the moment a self-service sale lands.

## Store state

| | In members' hands | Uploaded, not yet released |
|---|---|---|
| iOS | 1.0.1 (build 4) — live since 2026-07-29 | **1.3.0** (build 8), processed by Apple; the App Store version must be created by hand |
| Android | **1.3.0** (versionCode 9) — closed test | — |

**Android's production clock: 12 testers, 14 days required, and on 2026-07-29 it stood at day 3** —
so it completes around **2026-08-09**. (Written as a date on purpose: a countdown in a document is
wrong the day after it is written.) If a tester leaves the test the counter RESETS — do not remove
testers. Publishing new builds does NOT reset it, which is why 1.2.0 and 1.2.1 could both go out
mid-count without costing a day.

**1.3.0 is the one to ship. 1.1.0, 1.2.0 and 1.2.1 are all superseded** — each is contained in it,
and 1.2.0's video player is broken. On iOS pick the **1.3.0** build; on Android it is already on the
closed test track. 1.3.0 adds the three navigation fixes (OR-25) and PF-44's show-password eye on top
of everything below.

**1.2.1 superseded 1.2.0 — never shipped.** (2026-08-01) 1.2.0 reached both stores with a video
player that failed on every exercise (YouTube "Hata 153"), caught in a simulator after upload; see
OR-22. 1.2.1 fixes it and carries everything 1.2.0 did: PF-42 (Cüzdan out of the tab bar for
Üyeliğim), PF-43 (past reservations collapsed), the movement guide and the in-app video player.
Android replaced the closed-test build automatically (versionCode 8); **on iOS pick the 1.2.1 build,
not 1.2.0's build 6.**

**1.1.0 was superseded, not shipped.** It was built and uploaded on 2026-07-29 and never sent for
review; everything in it is inside 1.2.1, so let both it and 1.2.0 lapse rather than spending a
review turn on either. The owner chose this on 2026-08-01.

Submissions are automated: `cd apps/mobile && npx eas-cli submit --platform android --profile
production --latest`. The Play service account key is gitignored at
`apps/mobile/google-play-service-account.json` (`eas-play-submit@studio-yonetim-prod...`); the
`androidpublisher` API is enabled on the project. iOS submits the same way but the App Store version
must still be created and sent for review by hand.

---

## Waiting on the owner

- **iOS 1.3.0 is uploaded; the App Store version has to be created by hand.** App Store Connect →
  + Version → 1.3.0 → fill "What's New" in BOTH Turkish and English (an empty Turkish field greys out
  "Add for Review", which cost a day last week) → pick the **1.3.0** build → submit. Skip 1.1.0,
  1.2.0 and 1.2.1 — all three are contained in it. Test credentials for the reviewer: `0500 000 00 01` / `Yu156211` — a member
  with a live package and a programme, excluded from every report.
- **The Meta invite template `uyelik_daveti_v2`.** Text is drafted and ready to paste into WhatsApp
  Manager (name, category Utility, Turkish, body and the two sample values) — see the section below.
  Once Meta approves it, the code change is ONE line in
  `packages/core/src/modules/notifications/infrastructure/providers.ts`, written out in a comment
  right above the current mapping. Do not switch before approval: an unapproved template name is
  refused at send time and every invitation fails silently.
- **Twenty-one members are DURAKLATILMIŞ** — no live package (2026-08-01, measured). After the fitness
  import that is most likely the genuine number (lapsed, or leads entered as members) rather than
  migration debt. They now have their own filter with a count, which is the list to work through.
- **Sixty-six invitations are still unopened.** The invite screen has the filter and a one-tap
  reminder that mints a fresh link.

## Waiting on us

- **`main` was rewritten once, on 2026-08-03, and the original is kept.** Three unrelated changes went
  out under one commit whose message described only the first of them; the tree was identical but the
  log was misleading, and in this repository the log IS the history. It was re-split into three
  commits (`67054b7` reservations · `fdd9ffb` mobile navigation · `c13cf26` PF-44) and force-pushed
  with `--force-with-lease`. **The pre-split commit is preserved as `backup/pre-split-2026-08-03`,
  both a branch and a tag**, and `git diff` between it and `main` is empty — nothing shipped changed.
  If you pulled between roughly 12:30 and 13:00 that day, reset to `origin/main`.

- **Hybrid purchase, tested live.** One sale must produce N entitlements correctly through the real
  PAYTR path. The rules are written and unit-tested; the path has never run in production.
- **Sanal POS, a real charge.** Also never run for real. Together with the hybrid sale these are the
  two money paths this system has never actually executed — close them before a second studio.
- **The freeze initiative (OR-21) has never been used on a real member.** Watch the first one: the
  membership must extend by the APPROVED days (not the budget), her allowance must then read 0, and
  the nightly sweep must resume her on the approved day. It has no unit tests — the owner's call,
  taken knowingly. If it misbehaves the two places to look are `grantedDays` in `decideFreeze` and
  `budgetEndsOn` in the sweep.
- **Twenty-one duraklatılmış members are a work list nobody has worked.** They now have a filter with
  a count; that is the win-back call list.
- **Hybrid purchase, tested live.** One sale must produce N entitlements correctly through the real
  PAYTR path. The rules are written and unit-tested; the path has never run in production.
- **External uptime monitoring.** The watchdog cannot report its own suspension — if the project is
  suspended over an unpaid bill, every alarm goes quiet, which looks exactly like all-clear. The
  Monday heartbeat covers this partially by making silence the signal.
- **Product roadmap Faz A** (`docs/PRODUCT-ROADMAP.md`) — per-studio WhatsApp number, per-studio
  e-mail sender, one-command studio provisioning. Nothing blocks a second studio until these exist.
  No urgency; a second studio (Novozen) has asked but nothing is agreed.

---

## What shipped on 2026-08-01 — a long day, four pieces

Panel live at **`build-2026-08-01-008`**. Mobile **1.2.1** uploaded to both stores. All of it is
deployed; none of it needs another push. Read this before assuming something is half-done.

**1 · The freeze initiative (OR-21).** The owner may now freeze a member PAST her allowance — fourteen
days on a seven-day package — deliberately, behind a tick that says what it is about to do. Reception
still sees the plain refusal; only owner/platform_admin may exceed. The freeze records `grantedDays`
(what was approved) and the event carries `overageDays`, present only when the terms were exceeded, so
*"how often, and for whom, do we go past our own terms?"* has an answer. The unfreeze and the nightly
sweep both read the approval, never the budget. Shipped App Hosting + **functions** (the sweep lives
in a function). `098c5f8`.

**2 · The movement guide reached the app, and video plays in place.** Tapping an exercise in the
mobile app opens the panel's guide — target-muscle body diagram, movement summary, correct movement
with photos and cues, common mistakes. Everything it renders was already in the training payload; the
app simply was not showing it. Which muscles to paint is now resolved SERVER-side into
`ExerciseGuide.primaryMuscles/secondaryMuscles`, so a new exercise lights up in both clients with no
app release. Form videos no longer throw her out to YouTube: they play in a popup (iframe on web,
WebView in the app), both built from one shared `youtubeEmbedUrl`. `9a39ecc`.

**3 · Three member states (OR-23).** Aktif · Duraklatılmış · Pasif, all three filters on the members
page with counts. Only *pasif* is stored (it is a decision); the other two are derived from the ledger
at render time, so selling a package moves her to Aktif with nothing to run. The derivation also
checks the DATE, so it never depends on whether the nightly expiry sweep fired. `5b0b5a0`.

**4 · The corrections, which matter more than the features.** Two things were said wrongly and then
fixed — both are written down because a handover that explains a number wrongly is worse than one
that does not explain it:

- 1.2.0 went to both stores with a video player that failed on EVERY exercise. It compiled,
  typechecked, `pnpm check` was green and `next build` was clean. It was found only because the owner
  asked to see it in a simulator. → **OR-22**, and 1.2.1.
- The dashboard's "aktif üye" moving 101 → 105 was attributed to frozen members. There are none. The
  four are members whose package started the NEXT day (three new sales, one renewal bought after the
  old one lapsed). The rule stands; the reason was wrong.

Today's shape: **128 records — 105 aktif · 21 duraklatılmış · 2 pasif.**

### Shipped since, in 1.3.0 (2026-08-03)

Three navigation faults and PF-44. Cüzdanım had no stack entry, so it had no header, no back button
and no tab bar — the member opened her wallet and the app stopped. Üyeliğim was the mirror of it,
passing `header` on a TAB and running under the notch. The training tab derived its own label from
her subscriptions while the screen used the server's answer, so the two could disagree; both read the
server now and it reads "Ölçümlerim". PF-44 put a show-password eye in all six password fields, one
component per platform. **Both navigation fixes were seen in a simulator before upload** (OR-22);
the "Ölçümlerim" label was not — it needs a pilates-only member, so check it on a real account.

Also that day: **recording a class that already happened** (OR-24) — reception adds a walk-in to a
finished class from the attendance panel and the credit is consumed. Web-only; no app change.

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
