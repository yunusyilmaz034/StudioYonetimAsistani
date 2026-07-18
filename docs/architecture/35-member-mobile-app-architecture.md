# 35 — Member Mobile App Architecture (React Native · Expo)

**Status:** Approved direction (owner, 2026-07-19). Architecture-first; implementation not yet started.
**Author:** Technical Architect (Claude) with Product Owner
**Date:** 2026-07-19
**Supersedes:** the "Phase 2 frontend = Flutter" notes in `01-system-architecture.md §Drivers`, `05-folder-structure.md` (AD-7 framing) and `03-firestore-data-model.md §4`. The domain-stays-framework-free principle those docs defend is **unchanged**; only the client technology is now React Native + Expo.

---

## 1. Why this document exists

The web app runs the studio. The **member** — the woman who books a reformer class — touches the product through a server-rendered portal today (`docs/architecture/21-member-portal.md`). The owner has decided the member deserves a **native mobile app**: install from the store, open to today's classes, book in two taps, check in at the door, and — the reason it matters operationally — **receive a push** when her class is tomorrow, her credits are low, or the waitlist promoted her.

That last capability is why this is worth building: a push notification is the only channel that reaches a member without her opening anything. It is the member-side equivalent of the owner dashboard's "what needs attention today."

This document fixes the architecture **before any code**, because a mobile client is a new trust boundary and a new distribution channel, and both are expensive to get wrong. It resolves the technology, the auth bridge, the data-access model, and the push infrastructure, and sequences the work into three milestones matching the owner's priority order.

> **Scope guard.** This is the **member** app. Staff/owner stay on the web app. No staff feature is ported. The mobile app allocates no scarce resource and moves no money except through the same server-authoritative seams the web already uses.

---

## 2. The decision that was already made, and the one that matters more

**Framework — React Native + Expo + Reanimated (AD-68).** Chosen over Flutter. The decisive reason is not capability — both frameworks trivially handle a booking/QR/push app — but **the five-year cost of a solo maintainer and an AI pair.** The entire system is TypeScript: `apps/web` (Next.js), `apps/functions`, and the pure domain in `packages/core`. React Native keeps one language, one toolchain (pnpm, eslint, the strict `tsconfig.base.json`), and lets the mobile app **share the domain's types and validation** with the web. Flutter (Dart) would reuse none of it and open a second silo the one developer — and the AI agent — must reason about independently. Expo adds EAS Build/Submit and, critically, **EAS Update (OTA)**: JS fixes ship without an app-store review cycle, the same operational agility the web app already enjoys. Reanimated carries the premium motion the product's design language expects (`20-premium-design-system.md`).

**The deeper decision — data access (AD-69).** The framework is the smaller choice. The load-bearing one is *how a native client reads and writes*. The current security perimeter (`firestore.rules`, `21-member-portal.md`) **denies members every client-SDK Firestore read**: the portal is 100% server-rendered, and every byte a member sees passes through a Server Action that derived her identity from the `__session` cookie. Two options:

- **(A) Thin API client.** The mobile app calls a **token-authenticated member HTTP API** that wraps the existing member Server Actions; the server stays authoritative and keeps deriving identity from a verified Firebase ID token. The perimeter is untouched. Offline is app-managed (cache reads, queue nothing that allocates a resource).
- **(B) Scoped Firestore + offline-first.** Open per-member Firestore reads with new rules and use Firestore offline persistence. Native offline, but it **reopens the exact hole the rules deliberately closed** (a member token pointed at Firestore) and multiplies the rules surface.

**We choose (A) for v1**, and design (B) as a *later* seam if offline read demand is proven. Rationale: (A) preserves a security posture we already reasoned hard about, reuses `parseMemberClaims` / `memberClaimsToTenantContext` **verbatim**, and ships faster. The member app is a *thin* client anyway — the domain runs on the server (non-negotiable #8: clients read state and write commands, never state). Offline booking is undesirable regardless (it allocates a scarce resource; per the write-path test it can never be a `/commands` write). So (A) costs us almost nothing real and buys us the whole existing security model.

> The test for revisiting (B): *members repeatedly need to read their schedule/credits with no connectivity inside the studio.* Until measured, building (B) is a future phase built early — forbidden by the phase-discipline gate.

---

## 3. The auth bridge

Members **already authenticate with Firebase Auth** — phone + password, against a server-derived synthetic identifier (`{phone}@{studioId}.members.local`), uid = `mbr_{sha256(studioId:memberId)[:24]}`, custom claims `{ studioId, role:'member', memberId }` (`server/actions/portal-auth.ts`, `server/member-claims.ts`). The mobile app reuses this directly:

1. The app signs in with the **Firebase JS client SDK** (`signInWithEmailAndPassword`) — same call the web login form makes — obtaining a **Firebase ID token** on the device. The synthetic email is derived by an existing public action (`memberLoginIdentifierAction`) from the phone the member types; she never sees it.
2. Every API request carries `Authorization: Bearer <idToken>`.
3. The member API verifies it with `adminAuth().verifyIdToken(idToken, true)` → `parseMemberClaims` → `memberClaimsToTenantContext`. **This is the same identity path the cookie takes, minus the cookie** — `member-claims.ts` is reused unchanged (AD-70).

**Why ID token, not the session cookie (AD-70).** The httpOnly `__session` cookie is a browser mechanism; a native app has no cookie jar tied to Firebase Hosting SSR. Verifying the ID token directly is the cleaner "member API" and avoids a cookie-exchange round trip. The Firebase client SDK refreshes the ID token automatically (1-hour expiry); the app attaches the current token per request. No new credential type is invented.

**Refresh & revocation.** `verifyIdToken(token, true)` checks revocation, so the existing "revoke sessions on invite/password-reset" path (D17) still logs a device out. Password change on device re-auths through Firebase as it does on web.

---

## 4. The member API — a thin transport, not new logic

A new route group **`apps/web/src/app/api/member/*`** (Node runtime, on the same App Hosting backend) exposes the member surface. Each handler is a five-line adapter: verify bearer token → build `TenantContext` → **call the identical function the Server Action already calls** → return JSON. No business logic enters these handlers (the same rule as Server Actions — logic lives in `core`). The middleware public-prefix list gains `/api/member` for *reachability* (the handler itself authenticates; "public" means "no cookie gate," exactly like the PAYTR callback — see `middleware.ts`).

The v1 surface, all already implemented as member-scoped functions (see the surface map, §2 of the exploration): **reads** — dashboard, agenda (with `blockedReason`), reservations, profile, training program + guides + feedback + measurements + photos, fitness/streak, inbox, prefs; **writes** — `bookOwnReservation`, `cancelOwnReservation` (keeps its `reservation.memberId === memberId` ownership check), `updateOwnProfile`, `changeOwnPassword`, `mintCheckInToken`, `qrStudioBranch`, `leaveFeedback`, `markInboxRead`, `setPrefs`, and (new, §6) `registerDevice`.

**Contract sharing (AD-71).** Request/response types are defined once and shared. `@studio/core` ships as raw TS whose barrel drags in `firebase-admin` (server-only) — a React Native bundle must never import it. So `packages/core` gains a **client-safe subpath export** (`@studio/core/client`) that re-exports only pure types, enums, and framework-free domain predicates (e.g. `Channel`, `DomainError`, money/id brands, `ProgramFocus`), with **zero `firebase-admin` / `next` / `firestore` in its import graph** — enforced by a new dependency-cruiser rule (`apps/mobile` may import `@studio/core/client` but not the barrel, and never `firebase-admin`). This keeps one source of truth for the wire contract without leaking the server into the phone.

---

## 5. QR check-in — reused as-is

The member **displays** a short-lived signed QR; reception **scans** it (`15-qr-checkin-design.md`, `server/qr-token.ts`). This ports with zero domain change: the app calls `mintCheckInToken` over the member API, gets `{ token, expiresAt, ttlSeconds }`, renders it with a native QR component, and auto-refreshes before expiry — exactly what the web `qr-screen.tsx` does. **The HMAC secret and the jti single-use burn stay server-side**; the device only ever holds an opaque, expiring token (never the raw memberId). No native camera is needed for the member in v1 (reception scans). A future "member scans a branch/kiosk QR" flow would invert this and need a new verification endpoint — out of scope.

---

## 6. Push infrastructure — the one genuinely new backend capability

The notifications module is already **event → intent → delivery over a provider port** (`28-notification-center.md`, `modules/notifications`). `push` exists as a `Channel`, a `NotificationPrefs.push` toggle (default off), and a retry policy — but there is **no provider, no device-token store, and no push address** on `RecipientRef` / `RenderedMessage.to`. Building push means four additive pieces (AD-72):

1. **Device-token store.** A new subcollection `studios/{sid}/members/{memberId}/devices/{deviceId}` holding an **Expo push token**, platform, and `lastSeenAt`. Written by a new member-API endpoint `registerDevice` on app launch/login; pruned on logout and on Expo's "DeviceNotRegistered" receipt.
2. **`PushProvider implements NotificationProvider { channel = 'push' }`** added to `standardNotificationProviders(db, config)` — the single registry the delivery trigger and the resend action both use. Transport is the **Expo Push Service** (one HTTPS POST, the same shape as the Resend email provider), chosen over raw FCM because it fits the Expo managed workflow and needs no per-platform native credentials in v1 (AD-73). FCM/APNs remain reachable later without changing the port.
3. **Address plumbing.** Extend `RecipientRef` and `RenderedMessage.to` with a resolved push address (the member's device tokens), and fix `selectChannels`' address check so `push` reads device tokens, not `recipient.phone`. `enabledChannels` gains `'push'` for studios that opt in.
4. **PII discipline (non-negotiable #6).** A device token is not PII and MAY be stored; the **notification body still carries no PII into any event** — the push payload is rendered from templates + server-resolved names at send time, exactly as email/WhatsApp already are. A push event records only the intent/outcome, never the message text or the member's data.

Which events push in v1: **class reminder (T-… before session), credits-low, waitlist-promoted** — all already emitted; push is a new *delivery channel* for existing intents, not new events.

---

## 7. Monorepo placement

`apps/mobile` (Expo) — already covered by the `apps/*` workspace glob. It consumes `@studio/core/client` (§4) via `workspace:*`, extends `tsconfig.base.json`, and is added to the lint/depcruise run with rules that **forbid `firebase-admin` and the core barrel** (it is not on the `no-firestore-outside-infrastructure` allow-list, which is correct). No fourth `packages/*` is created; the shared contract lives in `core/shared` behind the client subpath, honoring AD-27 ("a fourth package must earn its way in"). Functions and the web app are untouched except for the additive member-API routes and the push provider.

---

## 8. Security posture — what stays true

- The perimeter is unchanged: members still cannot read Firestore from a client SDK (AD-69/A). The mobile app reads only through the token-authed member API, whose every handler derives identity from a verified ID token — never a request parameter.
- Ownership checks stay in the domain/actions (`cancelOwnReservation` verifies `reservation.memberId === memberId`), not the client.
- No secret ships to the device: not the QR HMAC key, not `firebase-admin`, not provider keys. The device holds only its Firebase ID token and opaque server-issued tokens.
- Booking and any money movement remain **synchronous, trusted, server-side** (non-negotiable #8, write-path test). The app queues nothing that allocates a resource offline.

---

## 9. Milestone roadmap (owner priority: 1 → 2 → 3)

Each milestone follows the standard cycle (`10-development-workflow.md`): Plan → UX → Implementation → Validation → Commit → **Stop**. `pnpm check` green at every boundary; the web app and functions stay in a working state throughout.

**M1 — Skeleton + Auth + Reservation + QR + Credits.**
Expo app scaffold in `apps/mobile` (Expo Router, Reanimated, Firebase JS SDK, native QR); `@studio/core/client` subpath + depcruise rule; the `apps/web/src/app/api/member/*` route group with ID-token verification; endpoints for login-identifier, dashboard, agenda, book, cancel, reservations, credits/packages, profile, QR mint. Member can: sign in, see today's/upcoming classes with `blockedReason`, book/cancel, view credits and package validity, show her check-in QR. **No push, no payments.**

**M2 — Push notifications.**
Device-token store + `registerDevice` endpoint; `PushProvider` (Expo Push Service) in the provider registry; `RecipientRef`/`RenderedMessage`/`selectChannels` push-address plumbing; opt-in via the existing `push` pref. Wire the three v1 triggers (class reminder, credits-low, waitlist-promoted). Deep-link a tapped notification to the relevant screen.

**M3 — Payment / package purchase.**
In-app purchase of a package via PAYTR, reusing the existing checkout/link flow (the `createCollectionCheckout` / member checkout seam) inside a native WebView or redirect, landing through the same verified callback. Member self-serve payment history read (a new member-API endpoint; today it is staff-only).

---

## 10. What the owner owns (actions & costs, before store launch)

- **Apple Developer Program** — $99/yr (required to ship to the App Store / TestFlight).
- **Google Play Developer** — $25 one-time.
- **Expo/EAS account** — free tier is enough to start; EAS Build has a free monthly quota, paid if we build often.
- App identity: name, icon, splash — drawn from the studio brand (`Pilates Fitness By Işıl`), same as the web.

None of these block M1 development (Expo runs on a simulator/Expo Go and via EAS internal builds without store accounts); they are needed for **public distribution** at the end of M1/M2.

---

## 11. Decision register

| # | Decision | Rejected alternative |
|---|---|---|
| **AD-68** | Member app = **React Native + Expo + Reanimated**. One TS language across web/functions/domain; shared types; EAS OTA; solo-maintainer + AI-friendly. | Flutter (Dart) — reuses none of the TS domain, second silo, harder to maintain solo. |
| **AD-69** | Data access = **(A) thin token-authed API client**; the member never reads Firestore from a client SDK. (B) scoped Firestore + offline-first is a *later* seam, built only if offline reads are measured as needed. | (B) now — reopens the closed member-read hole, multiplies rules surface, builds a future phase early. |
| **AD-70** | Mobile auth = **Firebase ID token (Bearer)** verified server-side via `parseMemberClaims`; no cookie. | Session-cookie exchange — extra round trip, browser-shaped mechanism on a native client. |
| **AD-71** | Shared wire contract via a **client-safe `@studio/core/client` subpath** (pure types/enums/predicates, zero `firebase-admin`), enforced by depcruise. | Import the core barrel (drags `firebase-admin` into the app) / duplicate types in the app (drift). |
| **AD-72** | Push = **new device-token subcollection + `PushProvider` in the existing registry + additive address plumbing**; push is a delivery channel for existing intents, not new events. | New push events / a parallel notification path — duplicates the event→intent→delivery model. |
| **AD-73** | Push transport = **Expo Push Service** in v1 (one HTTPS POST, no per-platform native credentials). | Raw FCM/APNs now — more native config for no v1 benefit; still reachable later behind the same port. |

---

## 12. Open questions for the owner

- **OQ-M1 — App store timing.** Ship to the stores at the end of **M1** (bookings + QR, no push) so members install early, or hold until **M2** (with push) so the first store impression includes notifications? *(Recommendation: TestFlight/internal-track at end of M1, public store listing at end of M2.)*
- **OQ-M2 — Login parity.** Keep phone + password (identical to the web portal), or add a "magic link / OTP by SMS" convenience for mobile? *(Recommendation: phone + password for v1 — reuses everything, no new SMS cost; revisit OTP after WhatsApp go-live gives us a message channel.)*

Everything else in this document is an architect decision and needs no owner sign-off to proceed.
