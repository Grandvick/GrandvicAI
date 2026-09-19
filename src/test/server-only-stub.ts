// Vitest runs business-logic modules directly under Node, outside of
// Next.js's "react-server" bundler condition. The real `server-only`
// package throws unconditionally when imported outside that condition (it
// can't tell a test run from an accidental client-side import), so
// vitest.config.ts aliases `server-only` to this no-op stub for tests only.
// Production and dev builds still use the real package and get its full
// protection — this stub never ships.
export {};
