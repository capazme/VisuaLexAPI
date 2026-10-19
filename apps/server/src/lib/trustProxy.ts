/**
 * Which hops may tell the server the client's address (X-Forwarded-For).
 * Express walks the header from the right and stops at the first address
 * outside these ranges: loopback and the private ones, where the ingress, the
 * host's own gateway addresses and the stack's containers live. A client's
 * address (public, or an overlay one in 100.64.0.0/10) is outside them, so it
 * becomes req.ip, and per-address limits count each client apart.
 * Only containers reach the server in production; in development req.ip is the
 * loopback. Named presets only: an IPv4-mapped IPv6 subnet written with a
 * short prefix would trust every address (GHSA-jqcg-44mw-7w3h).
 * Spec: docs/superpowers/specs/2026-10-05-mcp-production-design.md, section 5.
 */
export const TRUST_PROXY = 'loopback, uniquelocal';
