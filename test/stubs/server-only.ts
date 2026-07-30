// A no-op stand-in for Next.js's `server-only` guard.
//
// That package has no runtime module: importing it from a client component fails the BUILD, which is
// the whole point and must keep working. Vitest is neither a client nor a build, so it needs
// something to resolve — and stubbing it here is better than dropping the guard from files that
// genuinely must never reach the browser.
export {}
