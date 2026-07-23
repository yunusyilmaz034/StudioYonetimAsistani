import { money, sellPackage, type Grant, type MemberId, type Product, type SellPackageDeps, type TenantContext } from '@studio/core'

// Grant a HYBRID BUNDLE: one entitlement per component, each in its OWN category so the wall (I-9.7)
// holds. The FIRST component carries the full agreed price + the payment (PAYTR/collection); the rest
// are granted at 0 (included in the bundle). Mirrors the manual-sale bundle branch in
// assignSubscriptionAction — extracted so the PAYTR link + callback paths share ONE money loop.
type SellPackageArgs = Parameters<typeof sellPackage>[2]
type SellPayment = SellPackageArgs['payment']

export async function grantBundleComponents(
  deps: SellPackageDeps,
  ctx: TenantContext,
  args: {
    readonly product: Product
    readonly memberId: string
    readonly branchId: SellPackageArgs['branchId']
    readonly primaryPriceKurus: number // the FIRST component's priceAgreed (the whole bundle price)
    readonly componentOverrides?: readonly (number | null)[] | null
    readonly validFromMs: number
    readonly validUntilMs: number | null
    readonly method: SellPackageArgs['subscription']['method']
    readonly note: string
    readonly payment: SellPayment // recorded on the primary only
  },
): Promise<Awaited<ReturnType<typeof sellPackage>>> {
  const components = args.product.components ?? []
  let first: Awaited<ReturnType<typeof sellPackage>> | null = null
  for (let i = 0; i < components.length; i++) {
    const c = components[i]!
    const isPrimary = i === 0
    const override = args.componentOverrides?.[i] ?? null
    const isCredit = c.creditCount != null
    const grant: Grant = isCredit
      ? { kind: 'credits', credits: override ?? c.creditCount ?? 0, validForDays: args.product.durationDays }
      : { kind: 'period', durationDays: args.product.durationDays, access: 'unlimited' }
    const cEntry = isCredit ? c.entryAllowance : override ?? c.entryAllowance
    const r = await sellPackage(deps, ctx, {
      branchId: args.branchId,
      subscription: {
        memberId: args.memberId as MemberId,
        productId: args.product.id,
        productSnapshot: {
          productId: args.product.id,
          name: `${args.product.name} — ${c.label}`,
          category: c.category,
          grant,
          listPrice: money(args.product.priceInKurus),
          serviceIds: args.product.serviceIds,
          cancellationAllowanceCount: args.product.cancellationAllowanceCount,
          dailyReservationLimit: args.product.dailyReservationLimit,
          activeReservationLimit: args.product.activeReservationLimit,
          entryAllowance: cEntry,
        },
        policyRef: { policyId: args.product.id, version: 1 },
        priceAgreed: money(isPrimary ? args.primaryPriceKurus : 0),
        validFrom: args.validFromMs,
        validUntil: args.validUntilMs,
        freezeDays: args.product.freezeAllowanceDays > 0 ? args.product.freezeAllowanceDays : null,
        creditOverride: null,
        collectedAmount: money(0),
        method: args.method,
        note: args.note,
      },
      payment: isPrimary ? args.payment : null,
      discountCeilingPercent: null,
    })
    if (!r.ok) return r
    if (isPrimary) first = r
  }
  // A bundle always has ≥1 component (enforced upstream); `first` is set on i===0.
  return first ?? { ok: false as const, error: { code: 'no_bookable_entitlement' } }
}
