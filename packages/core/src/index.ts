// @studio/core — the product. Framework-free domain and application code.
//
// This is the package's only public door (AD-29). Phase 1 exposes the shared
// kernel (ids, money, time, actor, event envelope, TenantContext, Result, Clock);
// the domain modules are re-exported here as each is built.
export * from './shared/index'
export * from './modules/members/index'
export * from './modules/scheduling/index'
export * from './modules/entitlements/index'
export * from './modules/reservations/index'
