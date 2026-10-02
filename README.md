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
