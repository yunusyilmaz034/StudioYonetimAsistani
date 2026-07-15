// The shared kernel — the platform foundation everything else imports (Doc 5 §4).
// It imports nobody (dependency-cruiser `shared-imports-nothing`); it is pure
// types and framework-free helpers, no I/O.
export * from './brand'
export * from './category'
export * from './ids'
export * from './money'
export * from './time'
export * from './clock'
export * from './actor'
export * from './tenant-context'
export * from './studio-config'
export * from './event'
export * from './command'
export * from './result'
export * from './operation'
export * from './diff'
export * from './reservation-policy'
