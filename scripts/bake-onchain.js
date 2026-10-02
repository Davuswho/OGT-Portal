// CONTRACT-DIRECT bake. Usage: node scripts/bake-onchain.js <slug> [--limit N]
//
// Source of truth is the CONTRACT, not a marketplace indexer:
//   1. eth_call totalSupply() and tokenURI(id) on the collection contract
//   2. fetch each token's metadata from the URI the contract itself returns
//   3. rebuild all.json / rarity.json / ranks.json / images.json from that
//
// Why: OpenSea/Alchemy indexes lag and disagree (we repeatedly saw trait supply counts differ by
// 15-25% between sources). Whatever the contract points at is definitionally correct, and it also
// picks up freshly-revealed tokens the indexers haven't caught up with.
//
// Leaves market.json / floors.json / holders.json alone — those are market data, not contract data,
// and still come from scripts/bake.js + the live refresh path. os_ranks.json is preserved too
// (OpenSea's OpenRarity ranks are not on-chain).
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
(function loadEnv() {
  try {
    var p = path.join(__dirname, '..', '.env');
    if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (l) {
      var m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch (e) { }
})();
const registry = require('../lib/registry');
const { computeRarity, computeStatRanks } = require('../lib/rarity');

const KEY = (process.env.ALCHEMY_KEY || '').trim();
const RPC_HOST = { ethereum: 'eth-mainnet', base: 'base-mainnet', polygon: 'polygon-mainnet', arbitrum: 'arb-mainnet', optimism: 'opt-mainnet' };

function rpc(host, method, params) {
  return new Promise(function (res, rej) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params });
    var r = https.request({ host: host + '.g.alchemy.com', path: '/v2/' + KEY, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      function (x) { var d = ''; x.on('data', function (c) { d += c; }); x.on('end', function () { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    r.on('error', rej); r.write(body); r.end();
  });
}
function getJSON(url, redirects) {
  return new Promise(function (res, rej) {
    var lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { accept: 'application/json' } }, function (r) {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && (redirects || 0) < 4) {
        r.resume(); return res(getJSON(r.headers.location, (redirects || 0) + 1));
      }
      var d = ''; r.on('data', function (c) { d += c; });
      r.on('end', function () { if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode)); try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
// abi-decode a single dynamic string return
function decodeString(hex) {
  var h = hex.slice(2);
  var off = parseInt(h.slice(0, 64), 16) * 2;
  var len = parseInt(h.slice(off, off + 64), 16) * 2;
  return Buffer.from(h.slice(off + 64, off + 64 + len), 'hex').toString('utf8');
}
// ipfs.io rate-limits hard (429) on a 1000-token bake and the whole run comes back empty.
// Keep a gateway list and let the fetcher rotate: the path that fails is the gateway, not
// the CID, so retrying the same URL is pointless but another gateway usually works.
var IPFS_GW = ['https://gateway.pinata.cloud/ipfs/', 'https://ipfs.io/ipfs/',
               'https://nftstorage.link/ipfs/', 'https://4everland.io/ipfs/',
               'https://dweb.link/ipfs/'];
function ipfs(u, gw) { return u.replace(/^ipfs:\/\/(ipfs\/)?/, IPFS_GW[(gw || 0) % IPFS_GW.length]); }
function isIpfs(u) { return /^ipfs:\/\//.test(u); }
// Fetch an ipfs:// (or plain http) URI, walking the gateway list on failure.
async function getMeta(uri) {
  if (!isIpfs(uri)) return getJSON(uri);
  var lastErr = null;
  for (var g = 0; g < IPFS_GW.length; g++) {
    try { return await getJSON(ipfs(uri, g)); }
    catch (e) { lastErr = e; await sleep(60 * (g + 1)); }
  }
  throw lastErr || new Error('all ipfs gateways failed');
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  var slug = process.argv[2];
  if (!slug) { console.error('usage: node scripts/bake-onchain.js <slug>'); process.exit(1); }
  var limArg = process.argv.indexOf('--limit');
  var LIMIT = limArg > 0 ? parseInt(process.argv[limArg + 1], 10) : 0;
  var cfg = registry.load(slug);
  if (!cfg) { console.error('no config for ' + slug); process.exit(1); }
  var host = RPC_HOST[(cfg.chain || 'ethereum').toLowerCase()];
  if (!host) { console.error('chain not supported for on-chain bake: ' + cfg.chain); process.exit(1); }
  if (!KEY) { console.error('ALCHEMY_KEY missing'); process.exit(1); }

  var dir = path.join(__dirname, '..', 'data', cfg.data || slug);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Contract-direct bake: ' + slug + ' (' + cfg.contract + ' on ' + (cfg.chain || 'ethereum') + ')');

  // 1. totalSupply() — after burns this is the ALIVE count, not the max id. Token ids still run
  //    1..cfg.supply with holes where burns happened, so scan the full id range and classify
  //    burned ids individually (their tokenURI call reverts).
  var ts = await rpc(host, 'eth_call', [{ to: cfg.contract, data: '0x18160ddd' }, 'latest']);
  var supply = ts.result ? parseInt(ts.result, 16) : (cfg.supply || 0);
  var maxId = Math.max(supply, cfg.supply || 0);
  console.log('  totalSupply(): ' + supply + (maxId > supply ? '   → scanning ids 1..' + maxId + ' (' + (maxId - supply) + ' burned somewhere in range)' : ''));
  var N = LIMIT ? Math.min(LIMIT, maxId) : maxId;

  // 2. probe tokenURI on a couple of ids to learn the pattern (saves 8888 eth_calls when it's
  //    a simple base+id scheme, which most collections use)
  async function tokenURI(id) {
    var data = '0xc87b56dd' + BigInt(id).toString(16).padStart(64, '0');
    var r = await rpc(host, 'eth_call', [{ to: cfg.contract, data: data }, 'latest']);
    if (r.error || !r.result || r.result === '0x') throw new Error('tokenURI failed for ' + id);
    return decodeString(r.result);
  }
  var u1 = await tokenURI(1), u2 = await tokenURI(Math.max(2, Math.floor(N / 2)));
  var mid = Math.max(2, Math.floor(N / 2));
  var pattern = null;
  if (u1.endsWith('/1') && u2.endsWith('/' + mid)) pattern = u1.slice(0, -1);           // base + id
  else if (u1.endsWith('/1.json') && u2.endsWith('/' + mid + '.json')) pattern = { pre: u1.slice(0, u1.length - '1.json'.length), post: '.json' };
  console.log('  tokenURI(1)  : ' + u1);
  console.log('  pattern      : ' + (pattern ? (typeof pattern === 'string' ? pattern + '{id}' : pattern.pre + '{id}' + pattern.post) : 'per-token (will call contract for each)'));

  function uriFor(id) {
    if (typeof pattern === 'string') return pattern + id;
    if (pattern) return pattern.pre + id + pattern.post;
    return null;
  }

  // 3. fetch metadata with bounded concurrency
  var all = {}, images = {}, done = 0, failed = [], unrevealed = 0;
  var CONC = 10;
  var ids = []; for (var i = 1; i <= N; i++) ids.push(i);

  async function worker() {
    while (ids.length) {
      var id = ids.shift();
      var url = uriFor(id);
      try {
        if (!url) url = await tokenURI(id);
        var meta = await getMeta(url);
        var attrs = Array.isArray(meta.attributes) ? meta.attributes : [];
        var traits = attrs.filter(function (a) { return a && a.trait_type != null && a.value != null && String(a.value) !== ''; })
          .map(function (a) { return [String(a.trait_type), String(a.value)]; });
        if (traits.length) all[id] = traits; else unrevealed++;
        if (meta.image) images[id] = ipfs(String(meta.image));
      } catch (e) {
        failed.push(id);
      }
      done++;
      if (done % 200 === 0) process.stdout.write('\r  fetched ' + done + '/' + N + ' (' + failed.length + ' failed, ' + unrevealed + ' unrevealed)');
      await sleep(15);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('\r  fetched ' + done + '/' + N + ' (' + failed.length + ' failed, ' + unrevealed + ' unrevealed)      ');

  // one retry pass, separating BURNED ids (tokenURI reverts on-chain) from real failures
  var burned = [];
  if (failed.length) {
    console.log('  retrying ' + failed.length + ' failures (checking for burns)…');
    var again = failed.slice(); failed = [];
    for (var k = 0; k < again.length; k++) {
      var id2 = again[k];
      try {
        var uri2;
        try { uri2 = await tokenURI(id2); }
        catch (te) { burned.push(id2); continue; }   // tokenURI reverted → token no longer exists
        var m2 = await getMeta(uri2);
        var t2 = (Array.isArray(m2.attributes) ? m2.attributes : []).filter(function (a) { return a && a.trait_type != null && a.value != null && String(a.value) !== ''; })
          .map(function (a) { return [String(a.trait_type), String(a.value)]; });
        if (t2.length) all[id2] = t2; else unrevealed++;
        if (m2.image) images[id2] = ipfs(String(m2.image));
      } catch (e) { failed.push(id2); }
      await sleep(60);
    }
    console.log('  after retry: ' + burned.length + ' burned, ' + failed.length + ' still failing' + (failed.length ? ' → ' + failed.slice(0, 20).join(', ') : ''));
  }

  var traited = Object.keys(all).length;
  if (!traited) { console.error('ABORT: no traits fetched — refusing to overwrite good data.'); process.exit(1); }

  // safety: never clobber a healthy bake with a much smaller one — unless the shrink is
  // fully accounted for by on-chain burns (each burned id verified via reverting tokenURI)
  var allPath = path.join(dir, 'all.json');
  if (fs.existsSync(allPath)) {
    var prev = Object.keys(JSON.parse(fs.readFileSync(allPath, 'utf8'))).length;
    if (traited < prev * 0.9 && (prev - traited) > burned.length + 50) {
      console.error('ABORT: new bake has ' + traited + ' traited tokens vs ' + prev + ' existing (>10% drop, only ' + burned.length + ' verified burns). Not overwriting.');
      process.exit(1);
    }
  }
  if (burned.length) console.log('  🔥 ' + burned.length + ' burned tokens excluded from rarity (alive supply: ' + supply + ')');

  var rarity = computeRarity(all);
  var statRanks = computeStatRanks(all, rarity);
  var W = function (name, obj) { fs.writeFileSync(path.join(dir, name), JSON.stringify(obj)); };
  W('all.json', all); W('rarity.json', rarity); W('ranks.json', statRanks);
  if (Object.keys(images).length) W('images.json', images);

  console.log('\n  ✓ wrote data/' + (cfg.data || slug) + '/  (source: contract tokenURI)');
  console.log('    traited=' + traited + '  unrevealed=' + unrevealed + '  rarityTotal=' + rarity.total + '  images=' + Object.keys(images).length);
  console.log('    market.json / floors.json / holders.json / os_ranks.json left untouched.');
  if (String(cfg.data || slug) === 'gorgez') console.log('    NOTE: re-run scripts/gen-gorgez-sets.js to refresh derived-set counts.');
}
main().catch(function (e) { console.error('ERR', e && e.message); process.exit(1); });
