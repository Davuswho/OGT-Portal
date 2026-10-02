// Alchemy NFT API adapter — the primary source for wallet holdings. Alchemy API keys are
// app-scoped and do NOT expire on a timer the way OpenSea's do, so this is the reliable default.
// Key from process.env.ALCHEMY_KEY (Vercel env / local .env) — never hard-coded.
'use strict';
const https = require('https');

// .trim() guards a stray CR/newline from a Windows-edited env var (same gotcha that broke the
// OpenSea key header).
function apiKey() { return (process.env.ALCHEMY_KEY || '').trim(); }
function hasKey() { return !!apiKey(); }

// chain → Alchemy network subdomain. Chains not listed here (e.g. abstract) return null, and the
// holdings router falls back to OpenSea for them.
var NETWORKS = {
  ethereum: 'eth-mainnet', eth: 'eth-mainnet', mainnet: 'eth-mainnet',
  base: 'base-mainnet',
  polygon: 'polygon-mainnet', matic: 'polygon-mainnet',
  arbitrum: 'arb-mainnet', arb: 'arb-mainnet',
  optimism: 'opt-mainnet', op: 'opt-mainnet',
  zora: 'zora-mainnet'
};
function network(chain) { return NETWORKS[String(chain || 'ethereum').toLowerCase()] || null; }
function supportsChain(chain) { return !!network(chain); }

// Token ids are uint256. Accept decimal (Alchemy v3 default) or hex (0x…) and normalize to decimal;
// reject anything else so a hostile id can't reach an unquoted JS sink in the dashboard.
function numId(x) {
  x = String(x == null ? '' : x);
  if (/^0x[0-9a-fA-F]+$/.test(x)) { try { x = BigInt(x).toString(); } catch (e) { return null; } }
  return /^[0-9]{1,78}$/.test(x) ? x : null;
}

function getJSON(net, path) {
  return new Promise(function (resolve, reject) {
    https.get({ host: net + '.g.alchemy.com', path: path, headers: { accept: 'application/json' } }, function (r) {
      var d = '';
      r.on('data', function (c) { d += c; });
      r.on('end', function () {
        if (r.statusCode === 429) return reject(new Error('rate-limited'));
        if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode + (d ? ': ' + d.slice(0, 160) : '')));
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function imgOf(n) {
  var im = n.image || {};
  return im.cachedUrl || im.originalUrl || im.pngUrl || im.thumbnailUrl ||
    (n.media && n.media[0] && (n.media[0].gateway || n.media[0].raw)) || '';
}
// → [[type, value]] to match the OpenSea bake shape used across the app.
function traitsOf(n) {
  var attrs = (n.raw && n.raw.metadata && n.raw.metadata.attributes) || (n.metadata && n.metadata.attributes) || [];
  if (!Array.isArray(attrs)) return [];
  return attrs.filter(function (a) { return a && a.trait_type != null && a.value != null; })
    .map(function (a) { return [String(a.trait_type), String(a.value)]; });
}

// All NFTs of `contract` held by `addr` (paginated) → [{id, image, traits:[[type,value]]}].
// `traits` is a bonus the curated path ignores (it joins baked rarity) but the dynamic path uses
// to skip a per-token OpenSea round-trip.
async function fetchWalletNfts(addr, contract, chain) {
  var net = network(chain); if (!net) throw new Error('chain not on Alchemy: ' + chain);
  var key = apiKey(); if (!key) throw new Error('no ALCHEMY_KEY');
  if (!contract) throw new Error('no contract');
  var out = [], pageKey = '', pages = 0;
  do {
    var p = '/nft/v3/' + key + '/getNFTsForOwner?owner=' + encodeURIComponent(addr) +
      '&contractAddresses[]=' + encodeURIComponent(contract) +
      '&withMetadata=true&pageSize=100' + (pageKey ? '&pageKey=' + encodeURIComponent(pageKey) : '');
    var d = await getJSON(net, p);
    (d.ownedNfts || []).forEach(function (n) {
      var id = numId(n.tokenId);
      if (id) out.push({ id: id, image: imgOf(n), traits: traitsOf(n) });
    });
    pageKey = d.pageKey || ''; pages++;
    if (pageKey) await sleep(150);
  } while (pageKey && pages < 30);
  return out;
}
async function fetchWalletIds(addr, contract, chain) {
  return (await fetchWalletNfts(addr, contract, chain)).map(function (n) { return n.id; });
}

// Collection floor in ETH via getFloorPrice (aggregates marketplaces) → number|null.
async function collectionFloor(contract, chain) {
  var net = network(chain); if (!net || !apiKey() || !contract) return null;
  try {
    var d = await getJSON(net, '/nft/v3/' + apiKey() + '/getFloorPrice?contractAddress=' + encodeURIComponent(contract));
    var vals = [];
    ['openSea', 'looksRare'].forEach(function (k) { if (d[k] && typeof d[k].floorPrice === 'number') vals.push(d[k].floorPrice); });
    return vals.length ? Math.min.apply(null, vals) : null;
  } catch (e) { return null; }
}

// Current owner of every token in the collection → { tokenId: lowercaseOwnerAddress }. One
// paginated sweep over OWNERS (not one call per token), used to cross-check OpenSea's bulk
// listings feed against reality — that feed can keep returning an order for a while after it's
// been fulfilled or cancelled on-chain, and this catches the "sold elsewhere" case.
async function fetchCollectionOwners(contract, chain) {
  var net = network(chain); if (!net) throw new Error('chain not on Alchemy: ' + chain);
  var key = apiKey(); if (!key) throw new Error('no ALCHEMY_KEY');
  if (!contract) throw new Error('no contract');
  var map = {}, pageKey = '', pages = 0;
  do {
    var p = '/nft/v3/' + key + '/getOwnersForContract?contractAddress=' + encodeURIComponent(contract) +
      '&withTokenBalances=true&pageSize=100' + (pageKey ? '&pageKey=' + encodeURIComponent(pageKey) : '');
    var d = await getJSON(net, p);
    (d.owners || []).forEach(function (o) {
      var owner = String(o.ownerAddress || '').toLowerCase();
      (o.tokenBalances || []).forEach(function (tb) { var id = numId(tb.tokenId); if (id) map[id] = owner; });
    });
    pageKey = d.pageKey || ''; pages++;
    if (pageKey) await sleep(150);
  } while (pageKey && pages < 60);
  return map;
}

module.exports = {
  apiKey: apiKey, hasKey: hasKey, network: network, supportsChain: supportsChain,
  fetchWalletNfts: fetchWalletNfts, fetchWalletIds: fetchWalletIds, collectionFloor: collectionFloor,
  fetchCollectionOwners: fetchCollectionOwners
};
