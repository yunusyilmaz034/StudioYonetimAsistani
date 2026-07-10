// A nominal-typing brand. `Brand<string, 'MemberId'>` is a string at runtime but a
// distinct type at compile time, so a MemberId can never be passed where an
// EntitlementId is expected (AD-16, Doc 3 §9).
export type Brand<T, B extends string> = T & { readonly __brand: B }
