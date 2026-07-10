// The category wall's closed enum (AD-41, AD-47). Adding a category is a code
// change on purpose: `entitlement.productSnapshot.category === session.category`
// (I-9.7) must stay type-safe, never a stringly-typed admin field.
export type Category = 'pilates_group' | 'fitness' | 'private'
