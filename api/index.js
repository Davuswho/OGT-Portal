// Single catch-all serverless function = the whole platform. vercel.json rewrites every path
// here so all routes share ONE warm-lambda memory (the per-collection live market cache).
// Exported as a plain (req,res) handler so scripts/local-server.js mounts it verbatim.
'use strict';
const fs = require('fs');
const path = require('path');
const registry = require('../lib/registry');
const data = require('../lib/data');
const { buildDashboardHTML } = require('../lib/build');
const { fetchNft } = require('../lib/opensea');
const { walletNfts, walletIds } = require('../lib/holdings');
const { isDonor } = require('../lib/access');
const siwe = require('../lib/siwe');
const { esc, isAddr, isSlug, send, json } = require('../lib/util');

const OWNER = (process.env.OWNER_WALLET || '').toLowerCase().trim();

// Lightweight per-IP rate limit. These routes call OpenSea with OUR key on behalf of any visitor,
// so an unbounded caller could exhaust the quota / run up cost. In-memory = per warm instance
// (best-effort on serverless; meaningful against casual abuse). 40 req/min/IP.
var _RL = {};
function clientIp(req) { return ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'unknown'; }
function rateLimited(req) {
  var ip = clientIp(req), now = Date.now(), WINDOW = 60000, MAX = 100;
  var e = _RL[ip];
  if (!e || now - e.t > WINDOW) { _RL[ip] = { n: 1, t: now }; return false; }
  e.n++; return e.n > MAX;
}

function errorPage(res, code, title, msg) {
  send(res, code, 'text/html; charset=utf-8', '<meta charset="utf-8"><body style="background:#0b0e14;color:#ff6b6b;font-family:monospace;padding:40px"><h2>' + esc(title) + '</h2><pre style="white-space:pre-wrap">' + esc(msg) + '</pre><p style="color:#8a93a6"><a href="/" style="color:#6ea8fe">← back</a></p></body>');
}

// ---- landing page (collection picker) ------------------------------------
var LANDING_TPL = null;
var VENDOR_FILES = { '/vendor/wc-ethereum-provider.bundle.js': 'wc-ethereum-provider.bundle.js', '/vendor/qrcode.bundle.js': 'qrcode.bundle.js' };
var VENDOR_CACHE = {};
function landingHTML() {
  if (LANDING_TPL == null) { try { LANDING_TPL = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8'); } catch (e) { LANDING_TPL = '<h1>landing missing</h1>'; } }
  var cols = registry.all().map(function (c) {
    var b = c.branding || {};
    return { slug: c.slug, name: b.name || c.name, emoji: b.emoji || '', tagline: b.tagline || '', colors: b.colors || null, supply: c.supply, logo: b.logo || '', ready: c.ready !== false };
  });
  return LANDING_TPL
    .replace('__COLLECTIONS__', function () { return JSON.stringify(cols); })
    .replace('__OWNER__', function () { return JSON.stringify(OWNER || ''); })
    .replace('__WC_PROJECT_ID__', function () { return JSON.stringify((process.env.WALLETCONNECT_PROJECT_ID || '').trim()); });
}

// Parse comma-separated addr[:alias] pairs (GA multi-wallet URL format).
function parseWallets(str) {
  return String(str || '').split(',').map(function (part) {
    var seg = part.trim().split(':');
    var addr = seg[0].toLowerCase();
    var alias = seg[1] ? decodeURIComponent(seg[1]).replace(/[<>&"]/g, '').trim() : null;
    if (alias && alias.length > 20) alias = alias.slice(0, 20);
    if (!alias) alias = addr.slice(0, 6) + '…' + addr.slice(-4);
    return { addr: addr, alias: alias };
  }).filter(function (e) { return isAddr(e.addr); });
}

async function holdingsFor(cfg, st, wallets) {
  var results = await Promise.all(wallets.map(function (w, wi) {
    return walletNfts(cfg, w.addr).then(function (nfts) { return { wallet: w, walletIdx: wi, nfts: nfts, count: nfts.length }; });
  }));
  var holdings = [];
  results.forEach(function (r) {
    r.nfts.forEach(function (n) {
      var tr = st.ALL[n.id]; if (!tr) return;
      holdings.push({ id: n.id, img: data.imgFor(st, n.id) || n.image || '', traits: tr.map(function (p) { return { tt: p[0], tv: p[1] }; }), wallet: r.wallet.alias, walletIdx: r.walletIdx });
    });
  });
  return { holdings: holdings, results: results };
}

// Minimal in-memory state for a dynamic (un-baked) collection — empty datasets the builder
// tolerates; holdings carry their own traits/rank from the live per-token enrichment.
function liteState(cfg) {
  return { cfg: cfg, ALL: {}, RARITY: { total: cfg.supply || 0, s: {} }, STAT_RANK: {}, OS_RANK: {}, IMAGES: {}, HOLDERS: { totalHolders: 0, holders: [] }, BASE_MARKET: [], BASE_FLOORS: { asOf: 'live', eth: {} }, live: null };
}

// Live holdings for a dynamically-added collection: fetch the wallet's tokens, then enrich each
// (bounded) with traits + OpenRarity rank from the per-token endpoint. Pre-reveal collections
// simply return no traits — the dashboard then shows tokens + art with nothing to rank.
async function liteHoldings(cfg, wallets) {
  var ENRICH_CAP = 60;
  var results = await Promise.all(wallets.map(function (w, wi) {
    return walletNfts(cfg, w.addr).then(function (nfts) { return { wallet: w, walletIdx: wi, nfts: nfts, count: nfts.length }; });
  }));
  var flat = [];
  results.forEach(function (r) { r.nfts.forEach(function (n) {
    // Alchemy already returns traits ([[type,value]]) → use them and skip the per-token OpenSea call.
    var tr = (n.traits || []).map(function (t) { return { tt: t[0], tv: String(t[1]) }; });
    flat.push({ id: n.id, img: n.image || '', traits: tr.length ? tr : null, wallet: r.wallet.alias, walletIdx: r.walletIdx });
  }); });
  // Only tokens still missing traits (OpenSea fallback / pre-reveal) need per-token enrichment.
  var need = flat.filter(function (hd) { return !hd.traits; }).slice(0, ENRICH_CAP);
  await Promise.all(need.map(function (hd) {
    return fetchNft(cfg.chain, cfg.contract, hd.id).then(function (n) {
      if (n) {
        hd.traits = (n.traits || []).map(function (t) { return { tt: t.trait_type, tv: String(t.value) }; });
        hd.rank = (n.rarity && n.rarity.rank) || null;
        if (!hd.img) hd.img = n.image_url || n.display_image_url || '';
      }
    }).catch(function () { });
  }));
  flat.forEach(function (hd) { if (!hd.traits) hd.traits = []; });
  return { holdings: flat, results: results };
}

function qparam(qs, name) { return (qs.match(new RegExp('(?:^|&)' + name + '=([^&]+)')) || [])[1]; }

// ---- SIWE session helpers ----
function readBody(req) { return new Promise(function (resolve) { var b = ''; req.on('data', function (c) { b += c; if (b.length > 20000) { b = ''; req.destroy(); } }); req.on('end', function () { resolve(b); }); req.on('error', function () { resolve(''); }); }); }
function parseCookies(req) { var out = {}; (req.headers.cookie || '').split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function isSecure(req) { return req.headers['x-forwarded-proto'] === 'https' || /vercel\.app$/.test(req.headers.host || ''); }
function setCookie(res, name, val, maxAge, req) {
  var c = name + '=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
  if (isSecure(req)) c += '; Secure';
  var prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
function authedAddr(req) { var t = siwe.readToken(parseCookies(req).siwe); return (t && t.addr) ? t.addr : null; }
function sessionPayload(req) { return siwe.readToken(parseCookies(req).siwe); }
// The signed-in user's wallet set: primary ("You") + linked view-only wallets.
function sessionWallets(req) {
  var t = sessionPayload(req);
  if (!t || !t.addr) return [];
  var out = [{ addr: t.addr, alias: 'You' }];
  (t.linked || []).forEach(function (a) { a = String(a).toLowerCase(); if (isAddr(a) && a !== t.addr) out.push({ addr: a, alias: a.slice(0, 6) + '…' + a.slice(-4) }); });
  return out;
}

module.exports = async function handler(req, res) {
  var url = decodeURIComponent((req.url || '/').split('?')[0]);
  var qs = (req.url || '').split('?')[1] || '';

  if (url === '/' || url === '') return send(res, 200, 'text/html', landingHTML());
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // Vendor scripts, esbuild-bundled into self-contained files (see scripts/*-entry.js). Explicit
  // allowlist, not a wildcard route — no filename param, so no path-traversal surface.
  if (VENDOR_FILES[url]) {
    if (VENDOR_CACHE[url] == null) { try { VENDOR_CACHE[url] = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', VENDOR_FILES[url])); } catch (e) { VENDOR_CACHE[url] = ''; } }
    if (!VENDOR_CACHE[url]) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'application/javascript; charset=utf-8', VENDOR_CACHE[url], { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  if (url !== '/' && rateLimited(req)) return send(res, 429, 'text/plain; charset=utf-8', 'Too many requests — please slow down a moment.');

  if (url === '/api/collections') {
    return json(res, { collections: registry.all().map(function (c) { return { slug: c.slug, name: c.name, emoji: (c.branding || {}).emoji || '', supply: c.supply, curated: !!c.curated }; }) });
  }

  // ---- Sign-In With Ethereum (gasless signature → session cookie) ----
  if (url === '/api/siwe/nonce') {
    var nonce = siwe.randomNonce();
    setCookie(res, 'siwe_nonce', siwe.makeToken({ n: nonce }, 600), 600, req);
    return json(res, { nonce: nonce });
  }
  if (url === '/api/siwe/verify') {
    var raw = await readBody(req); var body2; try { body2 = JSON.parse(raw || '{}'); } catch (e) { body2 = {}; }
    if (!body2.message || !body2.signature) return json(res, { ok: false, error: 'missing fields' });
    var recovered = siwe.recover(body2.message, body2.signature);
    if (!recovered) return json(res, { ok: false, error: 'bad signature' });
    var pm = siwe.parseMessage(body2.message);
    if (!pm.address || pm.address !== recovered) return json(res, { ok: false, error: 'address mismatch' });
    if (pm.domain && pm.domain !== (req.headers.host || '')) return json(res, { ok: false, error: 'bad domain' });
    var nt = siwe.readToken(parseCookies(req).siwe_nonce);
    if (!nt || !pm.nonce || nt.n !== pm.nonce) return json(res, { ok: false, error: 'bad or expired nonce' });
    setCookie(res, 'siwe_nonce', '', 0, req);
    var prevS = sessionPayload(req);
    var keepLinked = (prevS && prevS.addr === recovered && prevS.linked) ? prevS.linked : [];   // keep links if re-signing same wallet
    setCookie(res, 'siwe', siwe.makeToken({ addr: recovered, linked: keepLinked }, 7 * 86400), 7 * 86400, req);
    return json(res, { ok: true, address: recovered, donor: isDonor(recovered) });
  }
  if (url === '/api/siwe/me') { var me = authedAddr(req); return json(res, { address: me, donor: me ? isDonor(me) : false }); }
  if (url === '/api/siwe/logout') { setCookie(res, 'siwe', '', 0, req); return json(res, { ok: true }); }

  // ---- Linked wallets (signed-in users attach view-only addresses) ----
  if (url === '/api/wallets') {
    var sw = sessionPayload(req);
    return json(res, sw && sw.addr ? { primary: sw.addr, linked: sw.linked || [] } : { primary: null, linked: [] });
  }
  if (url === '/api/wallets/link') {
    var s2 = sessionPayload(req); if (!s2 || !s2.addr) return json(res, { ok: false, error: 'not signed in' });
    var rb2 = await readBody(req); var bd2; try { bd2 = JSON.parse(rb2 || '{}'); } catch (e) { bd2 = {}; }
    var addr2 = String(bd2.address || '').toLowerCase();
    if (!isAddr(addr2)) return json(res, { ok: false, error: 'invalid address' });
    var linked2 = (s2.linked || []).slice();
    if (addr2 !== s2.addr && linked2.indexOf(addr2) < 0) {
      if (linked2.length >= 10) return json(res, { ok: false, error: 'max 10 linked wallets' });
      linked2.push(addr2);
    }
    setCookie(res, 'siwe', siwe.makeToken({ addr: s2.addr, linked: linked2 }, 7 * 86400), 7 * 86400, req);
    return json(res, { ok: true, primary: s2.addr, linked: linked2 });
  }
  if (url === '/api/wallets/unlink') {
    var s3 = sessionPayload(req); if (!s3 || !s3.addr) return json(res, { ok: false, error: 'not signed in' });
    var rb3 = await readBody(req); var bd3; try { bd3 = JSON.parse(rb3 || '{}'); } catch (e) { bd3 = {}; }
    var addr3 = String(bd3.address || '').toLowerCase();
    var linked3 = (s3.linked || []).filter(function (a) { return a !== addr3; });
    setCookie(res, 'siwe', siwe.makeToken({ addr: s3.addr, linked: linked3 }, 7 * 86400), 7 * 86400, req);
    return json(res, { ok: true, primary: s3.addr, linked: linked3 });
  }

  // Collection dashboard: /c/:slug  or  /c/:slug/:wallets
  var cmatch = url.match(/^\/c\/([a-z0-9_\-]+)(?:\/(.+))?$/i);
  if (cmatch) {
    var slug = cmatch[1].toLowerCase();
    if (!isSlug(slug)) return errorPage(res, 400, 'Bad collection', 'Invalid slug.');
    var wallets = cmatch[2] ? parseWallets(cmatch[2]) : sessionWallets(req);   // signed-in → primary + linked wallets
    try {
      var cfg = registry.load(slug), lite = false;
      if (!cfg) { cfg = await registry.resolveDynamic(slug); lite = true; }   // add-any-collection: resolve via OpenSea
      if (!cfg) return errorPage(res, 404, 'Collection not found', '“' + slug + '” could not be found on OpenSea.\nUse the slug from the collection’s OpenSea URL — opensea.io/collection/THIS-PART.');
      var st = lite ? liteState(cfg) : data.loaded(cfg);
      // Keep live listings (Market Builder / Offer Queue / Floor col) within the 10-min TTL —
      // no-ops instantly if already fresh or if OPENSEA_KEY is absent.
      if (!lite) { try { await data.refreshMarket(st); } catch (e) { } }
      var holdings = [], walletsMeta = null, walletLabel = 'Browse';
      if (wallets.length) {
        var hf = lite ? await liteHoldings(cfg, wallets) : await holdingsFor(cfg, st, wallets);
        holdings = hf.holdings;
        walletLabel = wallets.map(function (w) { return w.alias; }).join(' + ');
        walletsMeta = wallets.length > 1 ? wallets.map(function (w, i) { return { alias: w.alias, count: hf.results[i].count }; }) : null;
      }
      var completion = (!lite && wallets.length) ? data.buildCompletion(st, holdings, data.currentMarket(st), data.currentAsOf(st)) : null;
      var authed = authedAddr(req);
      var access = authed ? isDonor(authed) : false;   // gate keys on the SIGNED-IN (SIWE) wallet — un-bypassable
      var html = buildDashboardHTML(st, holdings, { walletLabel: walletLabel, completion: completion, wallets: walletsMeta, access: access });
      return send(res, 200, 'text/html', html, { 'Cache-Control': 'no-store' });
    } catch (e) { console.error('collection render error:', e && e.message); return errorPage(res, 500, 'Something went wrong', 'Could not load this collection right now — please try again.'); }
  }

  // JSON holdings (for the future client-fetch / connect path)
  if (url === '/api/holdings') {
    var sp = qparam(qs, 'slug'); var wp = qparam(qs, 'wallets');
    if (!sp || !isSlug(sp)) return json(res, { error: 'bad slug' });
    var cfgH = registry.load(sp); if (!cfgH) return json(res, { error: 'unknown collection' });
    var stH = data.loaded(cfgH);
    var ws = parseWallets(decodeURIComponent(wp || ''));
    if (!ws.length) return json(res, { error: 'no wallet' });
    try {
      var hfH = await holdingsFor(cfgH, stH, ws);
      var comp = data.buildCompletion(stH, hfH.holdings, data.currentMarket(stH), data.currentAsOf(stH));
      return json(res, { slug: sp, held: hfH.holdings.length, holdings: hfH.holdings, completion: comp });
    } catch (e) { console.error('holdings error:', e && e.message); return json(res, { error: 'lookup failed' }); }
  }

  // Refresh market for a collection
  if (url === '/api/refresh') {
    var rs = qparam(qs, 'slug');
    if (rs && isSlug(rs)) { var cfgR = registry.load(rs); if (cfgR) { try { await data.refreshMarket(data.loaded(cfgR)); } catch (e) { } } }
    return json(res, { status: 'ok' });
  }

  // NFT lookup: /api/nft/:slug/:id  (optional ?wallet=0x… for gap analysis)
  var nm = url.match(/^\/api\/nft\/([a-z0-9_\-]+)\/(\w+)$/i);
  if (nm) {
    var ns = nm[1].toLowerCase(), nid = nm[2];
    if (!isSlug(ns)) return json(res, { error: 'bad slug' });
    var cfgN = registry.load(ns); if (!cfgN) return json(res, { error: 'unknown collection' });
    var stN = data.loaded(cfgN);
    var nftTr = stN.ALL[nid];
    if (!nftTr) return json(res, { id: nid, found: false });
    var TOTAL = stN.RARITY.total || cfgN.supply || 0;
    var walletParam = (qs.match(/(?:^|&)wallet=(0x[0-9a-fA-F]{40})/) || [])[1];
    var gapOwned = null;
    if (walletParam) {
      try {
        var wIds = await walletIds(cfgN, walletParam.toLowerCase());
        gapOwned = new Set();
        wIds.forEach(function (wid) { var wtr = stN.ALL[wid]; if (wtr) wtr.forEach(function (p) { gapOwned.add(p[0] + '||' + p[1]); }); });
      } catch (e) { gapOwned = null; }
    }
    var traits = nftTr.map(function (p) {
      var c = (stN.RARITY.s[p[0]] && stN.RARITY.s[p[0]][p[1]]) || 0;
      var isGap = gapOwned ? !gapOwned.has(p[0] + '||' + p[1]) : false;
      return { type: p[0], value: p[1], supply: c, pct: c && TOTAL ? +(c / TOTAL * 100).toFixed(1) : 0, isGap: isGap };
    });
    var gaps = traits.filter(function (t) { return t.isGap; });
    var market = data.currentMarket(stN), price = null;
    for (var mi = 0; mi < market.length; mi++) { if (String(market[mi].id) === nid) { price = market[mi].price; break; } }
    return json(res, { id: nid, found: true, price: price, rank: stN.OS_RANK[nid] || stN.STAT_RANK[nid] || null, img: data.imgFor(stN, nid), gaps: gaps.length, traits: traits, gapTraits: gaps });
  }

  return send(res, 404, 'text/plain', 'not found');
};
