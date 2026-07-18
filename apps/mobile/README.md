# Studio Member App (React Native · Expo)

The member-facing native app for the Studio Operating System. It talks to the token-authenticated
member API (`apps/web/src/app/api/member/*`) — same domain, same rules as the web portal (AD-68…73,
`docs/architecture/35-member-mobile-app-architecture.md`).

## Why it's a standalone project

`apps/mobile` is **deliberately outside the pnpm workspace and the root `pnpm check` gate** (`pnpm-workspace.yaml`
excludes it; the root eslint/depcruise ignore it). Its React Native dependency tree never touches the
root `--frozen-lockfile`, so the web/functions gate stays green independently. It shares the one wire
contract by importing `@studio/core/client` through a Metro + tsconfig **path alias**, not `workspace:*`.

## Run it

```bash
cd apps/mobile
pnpm install          # or npm install — its own lockfile
npx expo start        # press i (iOS sim) / a (Android) / scan the QR with Expo Go
```

- Sign in with a member's **phone + password** (the same credentials as the web portal).
- Config (API base, studio id, public Firebase web config) is in `src/config.ts` — none of it secret.

## Ship to stores (owner)

```bash
npm i -g eas-cli
eas login
eas build --platform ios      # needs an Apple Developer account ($99/yr)
eas build --platform android  # needs a Google Play account ($25 one-time)
eas submit
```

OTA JS updates after launch: `eas update`.

## Layout

- `app/` — Expo Router screens. `(tabs)/` = Ana Sayfa · Ajanda · Antrenman · QR · Profil. Stack:
  `reservations`, `wallet`, `messages`.
- `src/lib/api.ts` — the typed member API client (attaches the Firebase ID token as a Bearer).
- `src/lib/firebase.ts` / `auth.tsx` — Firebase Auth (phone→synthetic-email→password) + session.
- `src/components/ui.tsx`, `src/theme.ts` — the small semantic UI kit + tokens.

## Status

- **M1 (done):** auth, dashboard, agenda + booking, reservations, training (programme + exercises +
  guides + measurements + feedback), QR check-in, profile + notification prefs, wallet (balance +
  packages), messages inbox.
- **M2 (next):** push notifications (device-token registration + Expo Push).
- **M3 (next):** in-app package purchase via PAYTR + payment history.
