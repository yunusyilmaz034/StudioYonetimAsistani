// Every secret the web tier reads, in one place — so that "what does production need?" is a file
// you can open rather than a grep you might get wrong.
//
// The rules this file exists to enforce:
//   • A DEPLOYED environment never falls back to a default. A check-in token signed with a key
//     that is published in this repository is not signed at all — it is a forgery anyone can mint.
//     Staging is deployed too, and gets no exemption: staging holds a copy of real members.
//   • Local development gets a fixed dev value, because the emulator has no secret manager and the
//     flow must stay testable. That is the ONLY place a fallback is allowed to exist.
//   • Secrets are read here and nowhere else. A `process.env.SOMETHING_SECRET` in a screen is a
//     secret one refactor away from being logged.

/** True in any built, deployed environment (staging and production alike). */
function isDeployed(): boolean {
  return process.env.NODE_ENV === 'production'
}

function required(name: string, devFallback: string): string {
  const value = process.env[name]
  if (value) return value
  if (isDeployed()) {
    // Loud, at the first use, rather than silently signing with a key the whole world can read.
    throw new Error(`${name} is not set — refusing to fall back to a development value`)
  }
  return devFallback
}

// ── QR check-in tokens (D10/D16) ────────────────────────────────────────────────────────────
// The key that signs a 60-second, single-use check-in token. If it leaks, every outstanding token
// stays valid for its remaining seconds and the remedy is to rotate — see below.
export function qrSigningSecret(): string {
  return required('QR_TOKEN_SECRET', 'dev-only-qr-secret')
}

// ROTATION (DEBT-013). Minting uses the active key; verification accepts the active key AND the
// outgoing one. To rotate with zero failed scans:
//
//   1. QR_TOKEN_SECRET_PREVIOUS := the current QR_TOKEN_SECRET
//   2. QR_TOKEN_SECRET          := a fresh key
//   3. deploy — tokens minted seconds ago under the old key still verify
//   4. after the TTL has passed (sixty seconds), remove QR_TOKEN_SECRET_PREVIOUS
//
// On a LEAK, skip step 1: drop the compromised key immediately and accept that the tokens minted
// in the last minute die with it. Sixty seconds of failed scans is the correct price for a key
// that a stranger holds.
export function qrVerificationSecrets(): readonly string[] {
  const previous = process.env.QR_TOKEN_SECRET_PREVIOUS
  return previous ? [qrSigningSecret(), previous] : [qrSigningSecret()]
}
