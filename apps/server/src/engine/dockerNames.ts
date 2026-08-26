/**
 * Docker object names the platform owns.
 *
 * These live in their own leaf module — it imports nothing — because both
 * `engine/proxy.ts` and `lib/serviceBridge.ts` need them and those two import
 * each other. When the constants lived in `proxy.ts`, that cycle was a boot
 * crash rather than a style problem: `serviceBridge.ts` evaluates
 * `RESERVED_NETWORKS = [NETWORK]` at module scope, so whenever the entry graph
 * reached `serviceBridge` first, `NETWORK` was still in its temporal dead zone
 * and the server exited with
 *
 *   ReferenceError: Cannot access 'NETWORK' before initialization
 *
 * on every start. TypeScript cannot see it (the types are fine) and the test
 * suites happened to load `proxy` first, so it only ever surfaced in
 * production. A module with no imports can never be half-initialised, which
 * removes the hazard rather than reordering around it.
 *
 * `proxy.ts` re-exports all three, so existing `from '../engine/proxy.js'`
 * imports keep working.
 */

/** The Traefik container the panel manages. */
export const TRAEFIK_CONTAINER = 'ninedeploy-traefik';

/**
 * Stay on Traefik v3 major — minor/patch updates are pulled automatically.
 * Pin to a specific version only if you need reproducibility (e.g. "traefik:v3.3").
 */
export const TRAEFIK_IMAGE = 'traefik:3';

/** Shared Docker network that app + database containers join to reach each other. */
export const NETWORK = 'ninedeploy';
