// The payments module's only public door (Plus Phase 6). It owns the PaymentIntent lifecycle and the
// PaymentProvider port; the concrete PAYTR adapter lives in infrastructure. Business logic composes
// this port and never imports PAYTR (Doc 26 §9).
export type {
  CallbackVerdict,
  PaymentFlow,
  PaymentIntent,
  PaymentIntentContext,
  PaymentProviderId,
  PaymentPurpose,
  PaymentStatus,
} from './domain/types'
export { isTerminalPaymentStatus } from './domain/types'
export * from './events'
export {
  decideCallbackResult,
  decideCancel as decideCancelPaymentIntent,
  decideCreateIntent as decideCreatePaymentIntent,
  decideExpire as decideExpirePaymentIntent,
  decideFlag as decideFlagPaymentIntent,
  decideRefundConfirmed,
  decideRequestRefund,
  decideSessionCreated,
  type DecideContext as PaymentsDecideContext,
  type IntentOutcome,
} from './domain/decide'
export type {
  CallbackVerification,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentIntentRepository,
  PaymentProviderPort,
  PaymentsDeps,
  RefundInput,
  RefundResult,
} from './application/ports'
export { paytrProvider, PaytrProvider, UnconfiguredPaymentProvider, type PaytrConfig } from './infrastructure/paytr-provider'
export { FirestorePaymentIntentRepository } from './infrastructure/repos'
export { reconcilePayments } from './application/reconcile'
