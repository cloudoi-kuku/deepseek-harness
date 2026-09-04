// Declarations for launch-token.mjs.
//
// The module is JSDoc-typed, but a TypeScript spec importing it across the .mjs boundary cannot see
// those annotations, so the import lands as `any` and the strict build fails (TS7016). These mirror
// the JSDoc rather than restating it — if the module's shape changes, this file should too.

/** Claims carried by a CoreNet/Hosting launch token. Email is deliberately absent. */
export interface LaunchClaims {
  tid: string
  uid: string
  product?: string
  exp: number
  brief?: string
}

/** Longest lifetime this validator honours, whatever a token claims. Ten minutes. */
export declare const MAXIMUM_LIFETIME_S: number

/** Returns the claims, or null for a bad signature, missing ids, an expired token, or one claiming longer than MAXIMUM_LIFETIME_S. */
export declare function validateLaunchToken(
  token: string | null | undefined,
  secret: string | null | undefined,
): LaunchClaims | null

/** Reads the token from the harness_launch cookie, else a Bearer header. Empty string when absent. */
export declare function launchTokenFromRequest(req: import('node:http').IncomingMessage): string
