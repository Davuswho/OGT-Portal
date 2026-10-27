// OpenSea API v2 — the ONLY place that talks to OpenSea. Now collection-agnostic:
// every function takes the slug/chain/contract instead of hard-coding one collection.
// API key from process.env.OPENSEA_KEY (Vercel env / local .env) — never hard-coded.
'use strict';
const https = require('https');
const HOST = 'api.opensea.io';

// .trim() guards a stray CR/newline in the env var — Node rejects a header value with \r
// ("Invalid character in header content"), which silently breaks EVERY call. A Windows
// CRLF env var did exactly this in the GA prod deploy.
function apiKey() { return (process.env.OPENSEA_KEY || '').trim(); }

// Token identifiers are uint256 → always decimal digits. Reject anything else at the source so a
// hostile collection can't slip a non-numeric id into an unquoted JS sink in the dashboard (XSS hardening).
function numId(x) { x = String(x); return /^[0-9]{1,78}$/.test(x) ? x : null; }

function getJSON(path) {
  return new Promise(function(resolve,reject){
    const request=https.get({ host: HOST, path: path, headers: { 'X-API-KEY': apiKey(), accept: 'application/json' } },function(response){
      let chunks=[],size=0;
      response.on('data',function(chunk){size+=chunk.length;if(size>4*1024*1024){response.destroy(new Error('Provider response too large.'));return;}chunks.push(Buffer.from(chunk));});
      response.on('error',()=>reject(new Error('Provider response failed.')));
      response.on('end',function(){
        if(response.statusCode!==200)return reject(new Error('Provider HTTP '+response.statusCode));
        try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(_){reject(new Error('Invalid provider JSON.'));}
      });
    });
    request.setTimeout(12000,()=>request.destroy(new Error('Provider timeout.')));
    request.on('error',()=>reject(new Error('Provider request failed.')));
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---- collection-level ----------------------------------------------------
function collectionMeta(slug) { return getJSON('/api/v2/collections/' + encodeURIComponent(slug)); }
function collectionStats(slug) { return getJSON('/api/v2/collections/' + encodeURIComponent(slug) + '/stats'); }

// All NFTs of `slug` held by `addr` (paginated) → [{id, image}]. Image comes straight from
// OpenSea so any collection shows thumbnails even without a baked images.json.
async function fetchWalletNfts(addr, slug, chain) {
  chain = chain || 'ethereum';
  var out = [], cursor = '', pages = 0;
  do {
    var p = '/api/v2/chain/' + chain + '/account/' + addr + '/nfts?collection=' + encodeURIComponent(slug) + '&limit=200' + (cursor ? '&next=' + encodeURIComponent(cursor) : '');
    try {
      var d = await getJSON(p);
      (d.nfts || []).forEach(function (n) { var id = numId(n.identifier); if (id) out.push({ id: id, image: n.image_url || n.display_image_url || '' }); });
      cursor = d.next || ''; pages++;
      if (cursor) await sleep(300);
    } catch (e) { throw new Error('Wallet holdings provider unavailable.'); }
  } while (cursor && pages < 20);
  if(cursor)throw new Error('Wallet holdings pagination limit reached.');
  return out;
}

// Convenience: just the IDs (used by the gap-analysis lookup path).
async function fetchWalletIds(addr, slug, chain) {
  return (await fetchWalletNfts(addr, slug, chain)).map(function (n) { return n.id; });
}

// Cheapest live listings across the whole collection → [{id, price, seller}]. `seller` (the
// Seaport order's offerer, lowercased) lets callers cross-check the listing against current
// on-chain ownership — OpenSea's bulk endpoint can lag behind a sale/cancellation and keep
// returning an order for a while after it's no longer valid.
async function fetchListings(slug, maxPages) {
  maxPages = maxPages || 15;
  var out = [], cursor = '', pages = 0;
  do {
    var p = '/api/v2/listings/collection/' + encodeURIComponent(slug) + '/all?limit=100' + (cursor ? '&next=' + encodeURIComponent(cursor) : '');
    try {
      var d = await getJSON(p);
      (d.listings || []).forEach(function (l) {
        var params = l.protocol_data && l.protocol_data.parameters;
        var off = params && params.offer && params.offer[0];
        var id = off && String(off.identifierOrCriteria);
        var cur = l.price && l.price.current;
        var px = cur ? Number(cur.value) / Math.pow(10, cur.decimals || 18) : null;
        var seller = params && params.offerer ? String(params.offerer).toLowerCase() : null;
        if (id && numId(id) && px != null && isFinite(px)) out.push({ id: id, price: px, seller: seller });
      });
      cursor = d.next || ''; pages++;
      if (cursor) await sleep(250);
    } catch (e) { throw new Error('Wallet holdings provider unavailable.'); }
  } while (cursor && pages < maxPages);
  return out;
}

// Single NFT (traits + OpenRarity rank + image).
async function fetchNft(chain, contract, id) {
  var d = await getJSON('/api/v2/chain/' + (chain || 'ethereum') + '/contract/' + contract + '/nfts/' + id);
  return (d && d.nft) ? d.nft : null;
}

// Full-collection pull for the one-time bake. Returns [{id, traits:[[type,value]], rank, image}].
async function fetchCollectionNfts(slug, opts) {
  opts = opts || {};
  var maxPages = opts.maxPages || 400, onPage = opts.onPage;
  var out = [], cursor = '', pages = 0;
  do {
    var p = '/api/v2/collection/' + encodeURIComponent(slug) + '/nfts?limit=200' + (cursor ? '&next=' + encodeURIComponent(cursor) : '');
    try {
      var d = await getJSON(p);
      var batch = (d.nfts || []).filter(function (n) { return numId(n.identifier); }).map(function (n) {
        return {
          id: numId(n.identifier),
          traits: (n.traits || []).map(function (t) { return [t.trait_type, String(t.value)]; }),
          rank: (n.rarity && n.rarity.rank) ? n.rarity.rank : null,
          image: n.image_url || n.display_image_url || ''
        };
      });
      out = out.concat(batch);
      if (onPage) onPage(out.length, batch);
      cursor = d.next || ''; pages++;
      if (cursor) await sleep(250);
    } catch (e) { throw new Error('Wallet holdings provider unavailable.'); }
  } while (cursor && pages < maxPages);
  return out;
}

module.exports = {
  apiKey: apiKey, getJSON: getJSON, sleep: sleep,
  collectionMeta: collectionMeta, collectionStats: collectionStats,
  fetchWalletNfts: fetchWalletNfts, fetchWalletIds: fetchWalletIds, fetchListings: fetchListings,
  fetchNft: fetchNft, fetchCollectionNfts: fetchCollectionNfts
};
