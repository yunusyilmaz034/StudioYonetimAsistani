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
npm install           # ⚠ npm, NOT pnpm — this app is OUTSIDE the pnpm workspace, so `pnpm install`
                      #   here installs the workspace and skips Expo. npm gives it its own node_modules.
npx expo start        # press i (iOS sim) / a (Android) / scan the QR with Expo Go
# If Expo warns about package versions: npx expo install --fix
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

## White-label: opening the app for a second studio (Faz A4)

Which studio a build is FOR is a build parameter, not a source edit. Everything studio-specific lives
in `studios/<id>.json`; `app.config.js` reads it and puts the answer in `expo.extra`, where
`src/config.ts` reads it back at runtime.

```bash
npx expo config --type public            # STUDIO defaults to 'retro'
STUDIO=novozen npx expo config           # inspect another studio's resolved config
```

**To add a studio:**

1. `cp studios/retro.json studios/<id>.json` and fill it in. The `studioId` must be the one the panel
   uses — it is what the member API is asked for.
2. Put that studio's `icon`, `adaptiveIcon` and `splashImage` under `assets/<id>/` and point the
   profile at them.
3. Create a **separate EAS project** for it and paste its `easProjectId` into the profile. Each
   white-label app is its own store listing, its own bundle identifier, its own review queue.
4. Add a build profile in `eas.json`:

   ```json
   "production-novozen": { "extends": "production", "env": { "STUDIO": "novozen" } }
   ```

   ⚠️ **The env var must be in the PROFILE, not on your shell.** `eas build` runs the build
   remotely and re-evaluates `app.config.js` there; a `STUDIO=` you typed locally never reaches it,
   so the remote build would quietly fall back to `retro` and ship one studio's app under another
   studio's name. This is why `production` pins `STUDIO: retro` explicitly instead of relying on the
   default.
5. `eas.json`'s `submit` block (`ascAppId`, the Play service-account key) is per studio too.

**Shared on purpose, do not parameterise:** `version` (releases go out in a batch — five customers on
five versions is five review queues), the Firebase project (the platform is multi-tenant on ONE
project; a studio is a `studioId`, never a project), permissions, plugins and the router.

An unknown `STUDIO` **throws**. It does not fall back to the pilot: a typo would otherwise produce a
build that looks correct and points at another studio's data, and the store does not let you take a
bundle identifier back.

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
