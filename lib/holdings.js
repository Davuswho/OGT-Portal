// Unified wallet-holdings source. Alchemy is primary because its API key doesn't expire on a timer
// like OpenSea's; OpenSea is the fallback — used when Alchemy has no key, errors, or doesn't cover
// the chain (e.g. abstract), and it remains the source for the live listings / offer-queue orderbook.
'use strict';
const alchemy = require('./alchemy');
const opensea = require('./opensea');

// Returns [{id, image, traits?}]. traits (Alchemy only) is [[type,value]]; the curated dashboard
// ignores it (uses baked rarity) and the dynamic dashboard uses it to skip per-token enrichment.
async function walletNfts(cfg, addr) {
  var chain = cfg.chain || 'ethereum';
  if (alchemy.hasKey() && cfg.contract && alchemy.supportsChain(chain)) {
    try { return await alchemy.fetchWalletNfts(addr, cfg.contract, chain); }
    catch (e) { /* fall through to OpenSea */ }
  }
  return opensea.fetchWalletNfts(addr, cfg.slug, chain);
}

async function walletIds(cfg, addr) {
  return (await walletNfts(cfg, addr)).map(function (n) { return n.id; });
}

module.exports = { walletNfts: walletNfts, walletIds: walletIds };
