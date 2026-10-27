# OGT Portal

A collection tracker for the **OGTriple** ecosystem, covering **Drop Ded Gorgez** and
**OGT Certification**.

> Built by a DDG holder. Not an official OGTriple product.

## Collections

| Collection | Contract | Supply | Engine |
|---|---|---|---|
| Drop Ded Gorgez | `0x9c51a3cb5094b26aa1dcb380f3dc7e1a7c681c2d` | 8,888 minted · 7,788 live | full |
| OGT Certification | `0x0c212fdb58d31e36039efa2c85dfb0482af8f2ee` | 1,000 (ids 1–1000) | market + holders only |

### Why OGT Certification runs a reduced engine

Every OGT Certification token carries exactly one trait, a unique **Certification Pass
Number**. All 901 indexed values appear exactly once, so there is no rarity ordering to
compute. Rarity ranks, trait gaps, duplicates, the completion plan and trait-safety views
are switched off for that collection on purpose — running them would manufacture rankings
that mean nothing. Market and holder views stay on, because those are real.

## Adding another OGTriple collection

One config file and one index entry:

1. `collections/<slug>.json` — contract, chain, supply, modules, branding
2. add `"<slug>"` to `collections/_index.json`
3. `node scripts/bake-onchain.js <slug>` then `node scripts/refresh-market.js <slug>`

No code changes required.

## Read-only

No wallet connection is required to use it, nothing is signed, and no private key is ever
handled. All data comes from public sources: the contract itself, Alchemy, and OpenSea.

## Security configuration and verification

Private sign-in is fail-closed. It requires all of:
- `SESSION_SECRET`: a randomly generated secret of at least 32 bytes; no fallback is accepted.
- `APP_ORIGIN`: the exact HTTPS production origin, without a trailing slash.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: shared Redis REST storage supporting `SET NX/EX`, `GET`, atomic `GETDEL`, `SET XX/EX`, and `DEL`.

Use deployment secret settings, not committed files. No production secret values were inspected or changed by the security patch. If the old fallback secret was ever deployed, configure a fresh random secret. All legacy stateless cookies are rejected by the new versioned, shared-session protocol. Do not point separate environments at the same `APP_ORIGIN`; storage keys are scoped to that origin.

The server generates the exact SIWE message with Ethereum chain 1, an exact URI/domain, a five-minute expiry and a browser-bound nonce cookie. Verification atomically consumes the shared challenge. Sessions last at most two hours, can be revoked on logout, and cannot be revived by a concurrent linked-wallet update after revocation. Public address lookups remain available without signing. Closing the sign-in dialog, wallet/provider changes, sign-out and page navigation cancel the operation. A cancel-only token allows durable nonce cancellation, including across a late verify response; every session read checks that nonce. Session issuance is bounded by the signed challenge expiry. Cancellation records cover the entire possible session lifetime. Failed cancellation is surfaced rather than reported as success; pending cancellation is retried on reload, and authentic expired cancel-only tokens can finish cleanup after every possible session has expired.

`npm test` runs offline regressions with synthetic metadata, test-only keys, mocked providers and a mocked atomic store. `npm run check` checks application and generated bundle syntax. `npm run build:wallet` reproducibly rebuilds the custom-QR browser adapter from the pinned official UniversalProvider dependency and records an input/hash manifest. It deliberately excludes AppKit, embedded accounts and Coinbase CDP, removing the unused dependency branch carrying the reviewed Axios, follow-redirects and Zod findings. No automatic dependency override across Zod major versions is used.

Bounded wallet lookups accept at most six unique addresses, deduplicate and coalesce work, and limit parallel wallet fetches to two. IP and cache protections are per warm serverless instance; these are load bounds, not a claim of global rate enforcement. Production shared-store integration and real wallet interoperability must be verified separately from offline tests. A clean dependency audit does not clear wallet-provider site warnings.

## CodeQL follow-up and reproducible vendor correction

The wallet build applies one hash-pinned source transform to `@walletconnect/utils@2.26.0`: Telegram link formatting requires a parsed HTTPS URL with exact `t.me` hostname, no credentials, and no nondefault port. `scripts/wallet-vendor-patches.mjs` fails the build if the upstream file or expected single match changes. The manifest records upstream and transformed source hashes. This corrects link classification; it is not a general allowlist for every wallet deep-link destination. Do not edit generated bundle lines directly.

The remaining reviewed CodeQL paths have executable evidence in `tests/codeql-followup.test.cjs`: the two biased-randomness alerts point to string concatenations used only in invalid-hex error messages; the Verify URL check uses exact membership in an array of two fixed HTTPS origins; the reflected-XSS trace is a restricted NFT identifier returned as JSON with `nosniff`. JSON responses now also use an explicit content-type sink and encode HTML-significant characters without changing parsed data. No alert has been dismissed or excluded; updated GitHub results still require review after the branch is scanned.