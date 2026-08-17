import { paytrProvider, tamiProvider, type PaymentProviderPort, type PaytrConfig, type TamiConfig, type TenantContext } from '@studio/core'

import { adminDb } from './firebase-admin'

// ── Payment provider wiring (Plus Phase 6). ──────────────────────────────────────────────────
//
// The NON-SECRET config (merchant id, test mode, URLs, which flows are on) lives in a studio settings
// doc; the SECRETS (merchant key + salt) come from the environment / Secret Manager, never Firestore,
// never the UI, never an event — the same discipline as RESEND_API_KEY (owner, §1). When either is
// missing the factory returns the Unconfigured provider, and every flow shows `configuration_required`
// rather than a fake success.

export interface PaymentProviderConfig {
  // Which adapter serves this studio. One at a time, chosen in settings — not per transaction: two
  // live providers means two reconciliations and two places a payment can be missing from.
  readonly provider: 'paytr' | 'tami'
  readonly merchantId: string
  readonly testMode: boolean
  readonly callbackUrl: string
  readonly successUrl: string
  readonly failUrl: string
  readonly posEnabled: boolean
  readonly linkEnabled: boolean
  readonly active: boolean
  // ── TAMI (2026-08-17). Non-secret half only; the secret key and the JWK come from the environment.
  readonly tamiMerchantNumber?: string
  readonly tamiTerminalNumber?: string
}

export const DEFAULT_PAYMENT_CONFIG: PaymentProviderConfig = {
  provider: 'paytr',
  merchantId: '',
  testMode: true,
  callbackUrl: '',
  successUrl: '',
  failUrl: '',
  posEnabled: true,
  linkEnabled: true,
  active: false,
}

export async function getPaymentProviderConfig(ctx: TenantContext): Promise<PaymentProviderConfig> {
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/paymentProvider`).get()
  return snap.exists ? { ...DEFAULT_PAYMENT_CONFIG, ...(snap.data() as Partial<PaymentProviderConfig>) } : DEFAULT_PAYMENT_CONFIG
}

/**
 * TAMI's secrets. `TAMI_JWK_K` / `TAMI_JWK_KID` are OPTIONAL and their absence is meaningful: a
 * checkout can still be minted, but nothing can be confirmed, so no payment completes. That is the
 * state until the merchant account is approved — and it is the safe one to be in.
 */
function tamiSecrets(): { secretKey: string; jwk: { kid: string; k: string } | null } | null {
  const secretKey = process.env.TAMI_SECRET_KEY
  if (!secretKey) return null
  const kid = process.env.TAMI_JWK_KID
  const k = process.env.TAMI_JWK_K
  return { secretKey, jwk: kid && k ? { kid, k } : null }
}

// The secrets — env only (Secret Manager via apphosting.yaml). Returns null when not provisioned.
function paytrSecrets(): { merchantKey: string; merchantSalt: string } | null {
  const merchantKey = process.env.PAYTR_MERCHANT_KEY
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT
  return merchantKey && merchantSalt ? { merchantKey, merchantSalt } : null
}

// Build the provider for a studio: real PAYTR only when the config is active AND the merchant id AND
// the secrets are all present. Anything missing ⇒ the Unconfigured provider.
export async function paymentProviderFor(ctx: TenantContext): Promise<{ provider: PaymentProviderPort; config: PaymentProviderConfig }> {
  const config = await getPaymentProviderConfig(ctx)

  if (config.provider === 'tami') {
    const s = tamiSecrets()
    const tamiConfig: TamiConfig | null =
      config.active && config.tamiMerchantNumber && config.tamiTerminalNumber && s
        ? {
            merchantNumber: config.tamiMerchantNumber,
            terminalNumber: config.tamiTerminalNumber,
            secretKey: s.secretKey,
            testMode: config.testMode,
            jwk: s.jwk,
          }
        : null
    return { provider: tamiProvider(tamiConfig), config }
  }

  const secrets = paytrSecrets()
  const paytrConfig: PaytrConfig | null =
    config.active && config.merchantId && secrets
      ? { merchantId: config.merchantId, merchantKey: secrets.merchantKey, merchantSalt: secrets.merchantSalt, testMode: config.testMode }
      : null
  return { provider: paytrProvider(paytrConfig), config }
}

// A truthful "is it ready?" for the settings screen — never reveals a secret, only whether it exists.
export function paymentSecretsPresent(): boolean {
  return paytrSecrets() !== null
}
