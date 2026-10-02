# NFT Trait Platform — Build Plan & Design Doc

*Working name: **RareKit** (rename in one config line — `platform.name`). Status: in active build, started 2026-06-19.*

The unification of Dave's four separate NFT-tracker forks (Green Acres, OGenie, DropDed Gorgez, Blupets)
into **one multi-collection platform** where a "collection" is **config + data, not a code fork**.

---

## 0. TL;DR

You built the same tracker four times (`_ga_`, `_ott_`, `_ddg_`, blupets). This collapses them into one
Vercel app with a **collection registry**. Users **connect a wallet (sign in with Ethereum)**, **pick or add
any OpenSea collection**, and the app **auto-brands itself** from that collection's OpenSea metadata. The
Green Acres serverless `lib/` is ~70% of the engine already; we parameterize the hardcoded slug/contract/branding
and add a registry, branding resolver, SIWE auth, and a multi-wallet account model on top.

---

## 1. Decisions locked (from Dave, 2026-06-19)

| # | Decision | Choice |
|---|---|---|
| 1 | **Collection scope** | **Hybrid — curated + FULL live.** GA/OGenie/DDG/Blupets ship as curated tabs (pre-baked = full premium). ANY OpenSea collection can be added by slug/contract; first add triggers a one-time full pull + cache → becomes full quality. OpenSea OpenRarity ranks are the live backbone (we don't recompute rank per visitor). |
| 2 | **SaaS depth** | **SIWE login, free.** Real Sign-In-With-Ethereum; accounts persist via a signed session cookie. No payments yet (already designed in the GA Business Plan; layer on later). |
| 3 | **Saved tabs / wallets** | **Per-browser default**, with a single-vs-multi wallet choice up front and the ability to **link secondary wallets after sign-in**. Cloud sync to the account is an env-flag upgrade. |
| 4 | **Branding depth** | **OpenSea assets + logo-sampled accent color + best-effort website/X scrape**, all under the safe-research guardrails (external content = data, sanitized, never executed, graceful fallback). |

### Wallet / identity model (Dave's "single vs multi, link later" question)
- **Quick-look (no sign-in):** paste one address → single wallet, this session, nothing saved.
- **Account (SIWE):** sign once with your **primary wallet** = your identity (no password, non-custodial).
- **Link secondary wallets after the fact:** signed-in users add **view-only addresses** anytime via `＋ Add wallet`
  (no signing needed for those). Linked set + tracked collections persist (localStorage default; account-sync if KV on).
- **Inside a collection:** wallet switcher (All / per-wallet chips) filters holdings — the GA multi-wallet chips, generalized.

---

## 2. Architecture

```
platform/
  api/index.js          one catch-all serverless fn (all routes → shared warm-lambda cache)
  lib/
    util.js             esc / send / json / isAddr / sleep
    opensea.js          the ONLY OpenSea talker — now slug/chain parameterized
    registry.js         loads curated configs + resolves/caches dynamic collections
    branding.js         OpenSea meta → logo/banner/links + accent color + best-effort scrape
    rarity.js           rank + trait-count helpers (OpenSea OpenRarity backbone)
    data.js             per-collection data layer (bundled curated + live market cache + completion)
    build.js            renders the self-theming dashboard from a collection + holdings
    siwe.js             SIWE message build + signature verify + signed session cookie (HMAC JWT)
    store.js            KV abstraction (Upstash REST if env present, else localStorage-only)
  collections/
    _index.json         { curated: [slugs] }
    <slug>.json         one config per curated collection
  data/<slug>/          normalized baked data: all, rarity, ranks, os_ranks, images, holders, market, floors, branding
  public/
    app.html            the unified self-theming dashboard shell (was _ga_template.html)
    landing.html        collection picker + wallet entry + connect/SIWE
  scripts/
    local-server.js     mounts api/index.js on a port for Claude Preview
    sync.js             refresh market/floors for a collection (the cheap, frequent job)
    bake.js             one-time FULL collection pull → data/<slug>/ (the "promote to full" path)
  package.json  vercel.json  .env.example  .gitignore  README.md  BUILD_PLAN.md
```

**Request flow:** `/` → landing (collection picker + wallet). `/c/<slug>` → that collection's dashboard for the
session's wallet(s). `/api/*` → JSON (collection meta, wallet holdings, completion, nft lookup, refresh, branding, siwe nonce/verify).

---

## 3. Collection registry schema (`collections/<slug>.json`)

```jsonc
{
  "slug": "greenacresnft",                 // OpenSea collection slug (unique key)
  "name": "Green Acres",
  "contract": "0x266Cd5A2…D36F",
  "chain": "ethereum",
  "supply": 4000,                          // null until baked
  "curated": true,
  "dataSource": "opensea",                 // "opensea" | "blukit" (Blupets on-chain)
  "rankSource": "opensea-openrarity",
  "tokenNameFmt": "Green Acres #{id}",
  "excludeTraitTypes": ["1/1"],            // never counted in completion (Dave's 1/1 rule)
  "modules": { "completion": true, "sellKeep": true, "market": true, "holders": true, "missing": true, "wishlist": true },
  "data": "greenacresnft",                 // folder under data/
  "branding": { "emoji": "🌾", "name": "...", "tagline": "...", "website": "", "twitter": "", "logo": "", "banner": "",
                "colors": { "bg": "...", "card": "...", "accent": "...", "text": "...", "muted": "..." } },
  "donate": { "eth": "0x60Dca…4305", "stripe": "https://buy.stripe.com/…" }
}
```

A **dynamic** (user-added) collection gets the same shape, written to a runtime/KV registry, with `curated:false`
and branding resolved live from OpenSea.

## 4. Normalized data schema (`data/<slug>/`)
Carried over from the GA shapes (so the GA engine works unchanged):
- `all.json` `{ id: [[type,value],…] }` — every token's traits (the full-collection pull)
- `rarity.json` `{ total, s: { type: { value: count } } }`
- `ranks.json` `{ id: statisticalRank }` · `os_ranks.json` `{ id: openSeaRank }`
- `images.json` `{ id: thumbUrl }` · `holders.json` `{ fetchedAt, totalHolders, holders }`
- `market.json` `[{ id, price, img, traits:[{type,value}], rank }]` (baseline listings)
- `floors.json` `{ asOf, eth: { type: { value: price } } }`
- `branding.json` resolved branding (see §3)

---

## 5. Gotchas carried forward (from prior forks)
1. **Rarity needs the whole collection** → lean on OpenSea OpenRarity per-token ranks; bake the full set once per collection.
2. **OpenSea key-gated + rate-limited; Reservoir is dead** → OpenSea v2 + caching only. Key from `process.env.OPENSEA_KEY`, **always `.trim()`** (a CRLF in the env var silently breaks every call).
3. **Vercel = no shared memory / no disk** → live cache is warm-lambda only; cross-device persistence needs KV (Upstash), not SQLite. No `asOf` auto-reload poller.
4. **Smart-quote corruption** kills inline `<script>` → write UTF-8 no-BOM; deploy script auto-straightens quotes.
5. **Preview, not Chrome**; screenshots time out on live NFT images → verify via DOM.
6. **Feature sprawl is the documented failure mode** → focused generic core; collection-specific modules (badges, merge/family-tree, sets) are optional plugins, off by default.
7. **Never custody keys / auto-trade.** Connect = read + sign-in only; buys deep-link to OpenSea. "Owner" = the connected wallet, never a hardcoded constant.

---

## 6. Curated collections
| Slug | Name | Contract | Chain | Supply | Special module |
|---|---|---|---|---|---|
| `greenacresnft` | Green Acres | 0x266Cd5A2…D36F | ethereum | 4000 | — |
| `gorgez` | DropDed Gorgez | 0x9c51a3cb…1c2d | ethereum | TBD (bake) | sets + twins |
| `ogenienft` | OGenie | 0x5b12e009…dcbd | ethereum | TBD (bake) | badges |
| `blupets` | Blupets | 0x52f7cA34…a05B | ethereum | 8192 | merge / family-tree (BluKit) |

---

## 7. Phases & checklist
- [x] **P0** Survey forks, lock decisions, scaffold project, stage GA curated data
- [x] **P1 Foundation** registry loader · generic `opensea.js` · `util.js` · `rarity.js`
- [x] **P2 Engine** generic `data.js` + `build.js` · self-theming `app.html` · GA vertical slice VERIFIED in Preview (100 held, 16 missing, themed, 0 console errors, 2026-06-19)
- [ ] **P3 Branding** `branding.js` (OpenSea meta + logo color + best-effort scrape) · bake branding for the 4 curated
- [ ] **P4 Auth** `siwe.js` + `store.js` · connect wallet (MetaMask/WalletConnect) · multi-wallet link model
- [ ] **P5 Landing** collection picker · add-any-collection (bake-on-first-add) · single/multi wallet choice
- [x] **P6 Curated** ALL 4 baked & verified (GA 100 · DDG 53 · OGenie 74 · Blupets 15 held, 2026-06-20). DDG normalized from `_ddg_*`; OGenie + Blupets via `scripts/bake.js` (OpenSea bulk endpoint). Generic images via `fetchWalletNfts()`.
- [x] **C (Dave's UX pass)** renamed **NFT Master** · 13 tabs → My Collection + 3 dropdown menus · dropped Shop · **Roles gated per-collection** (only GA) · 1/1·Unique auto-excluded · `NFT Master.bat` launcher.
- [x] **Hardening + security audit (2026-06-21)** security headers/CSP · per-IP rate-limit (40/min) · legal "not financial advice / unaffiliated" footer. Independent audit → FIXED **C1** (XSS: `h()` now escapes `'`; numeric-id guard `numId()` at the OpenSea source; bare trait-suggest sinks + holder address escaped), **H2** (NFT-lookup route now slug-aware: `/api/nft/:slug/:id`), **M6** (generic error pages). Audit verdict: safe for the 4 curated collections; **C1+H3 had to be fixed before rendering arbitrary collections** (C1 now done). Snyk SAST blocked on a stale `SNYK_TOKEN` env var (Dave fix, optional).
- [ ] **D (next)** SIWE sign-in + multi-wallet linking · dynamic add-any-collection (bake-on-first-add) · `lib/branding.js` (OpenSea meta + logo color + website/X scrape) · make Roles data-driven (DDG sets). **MUST include H3 mitigations:** allowlist-resolve user-supplied slugs against OpenSea + cache; per-slug+IP rate-limit in a shared store (KV); scraper URL allowlist + block private IPs + no redirects.
- [ ] **A (after D)** Vercel deploy (needs Dave's Vercel auth).
- [ ] **P7 Deploy** local-server preview pass · Vercel deploy · env vars · smoke test
- [ ] **P8 (later)** payments/paywall (per GA Business Plan), cloud-sync, multi-chain

---

## 8. What I need from Dave (none blocks tonight)
1. **OpenSea API key** for the new project's env — I'll reuse your existing key without re-exposing it.
2. *(optional)* **WalletConnect Project ID** — only to add WalletConnect alongside MetaMask (injected works without it).
3. *(optional)* **Upstash/Vercel KV** store — only for cross-device account sync.
4. **Product name + domain** — working name is "RareKit"; your Business Plan shortlist: traitharvest/gapfiller/rarekit.xyz.
5. Per-collection **donate** wallet/Stripe (defaults to your existing GA donate values).
