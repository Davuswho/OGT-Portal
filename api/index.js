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
const { esc, safeJson, isAddr, isSlug, send, json } = require('../lib/util');

const OWNER = (process.env.OWNER_WALLET || '').toLowerCase().trim();

// Lightweight per-IP rate limit. These routes call OpenSea with OUR key on behalf of any visitor,
// so an unbounded caller could exhaust the quota / run up cost. In-memory = per warm instance
// (best-effort on serverless; meaningful against casual abuse). 40 req/min/IP.
const { isIP } = require('node:net');
var _RL = new Map();
function clientIp(req) {
  var value=process.env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']:(req.socket&&req.socket.remoteAddress);
  return typeof value==='string' && isIP(value.trim()) ? value.trim() : 'unattributed';
}
function rateLimited(req,cost) {
  var ip=clientIp(req),now=Date.now(),WINDOW=60000,MAX=40;cost=cost||1;
  for(var [key,value] of _RL)if(now-value.t>WINDOW)_RL.delete(key);
  var e=_RL.get(ip);
  if(!e){if(_RL.size>=5000)return true;e={n:0,t:now};_RL.set(ip,e);}
  e.n+=cost;return e.n>MAX;
}

function errorPage(res, code, title, msg) {
  send(res, code, 'text/html; charset=utf-8', '<meta charset="utf-8"><body style="background:#0b0e14;color:#ff6b6b;font-family:monospace;padding:40px"><h2>' + esc(title) + '</h2><pre style="white-space:pre-wrap">' + esc(msg) + '</pre><p style="color:#8a93a6"><a href="/" style="color:#6ea8fe">← back</a></p></body>');
}

// ---- landing page (collection picker) ------------------------------------
var LANDING_TPL = null;
var VENDOR_FILES = { '/vendor/wc-ethereum-provider.bundle.js': 'wc-ethereum-provider.bundle.js', '/vendor/qrcode.bundle.js': 'qrcode.bundle.js' };
var VENDOR_CACHE = Object.create(null);
function landingHTML() {
  if (LANDING_TPL == null) { try { LANDING_TPL = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing.html'), 'utf8'); } catch (e) { LANDING_TPL = '<h1>landing missing</h1>'; } }
  var cols = registry.all().map(function (c) {
    var b = c.branding || {};
    return { slug: c.slug, name: b.name || c.name, emoji: b.emoji || '', tagline: b.tagline || '', colors: b.colors || null, supply: c.supply, logo: b.logo || '', ready: c.ready !== false };
  });
  var bindings = {COLLECTIONS:safeJson(cols),OWNER:safeJson(OWNER || ''),WC_PROJECT_ID:safeJson((process.env.WALLETCONNECT_PROJECT_ID || '').trim())};
  return LANDING_TPL.replace(/__([A-Z_]+)__/g, function(token,key) { return Object.hasOwn(bindings,key)?bindings[key]:token; });
}

// Parse comma-separated addr[:alias] pairs (GA multi-wallet URL format).
function parseWallets(str) {
  str = String(str || '');
  if (str.length > 2048) throw Object.assign(new Error('Wallet query is too long.'), { status: 400 });
  var unique = new Map();
  for (var part of str.split(',')) {
    var seg = part.trim().split(':'), addr = seg[0].toLowerCase();
    if (!isAddr(addr)) continue;
    var alias = seg[1] || '';
    try { alias = decodeURIComponent(alias); } catch (_) { throw Object.assign(new Error('Malformed wallet alias.'), { status: 400 }); }
    alias = alias.trim().slice(0, 20) || addr.slice(0, 6) + '…' + addr.slice(-4);
    if (!unique.has(addr)) unique.set(addr, { addr: addr, alias: alias });
    if (unique.size > 6) throw Object.assign(new Error('At most 6 unique wallets are supported.'), { status: 400 });
  }
  return Array.from(unique.values());
}
async function fetchWalletRows(cfg, wallets) {
  var out = new Array(wallets.length), cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, wallets.length) }, async function () {
    while (cursor < wallets.length) {
      var wi = cursor++, w = wallets[wi], nfts = await walletNfts(cfg, w.addr);
      out[wi] = { wallet: w, walletIdx: wi, nfts: nfts, count: nfts.length };
    }
  }));
  return out;
}

async function holdingsFor(cfg, st, wallets) {
  var results = await fetchWalletRows(cfg, wallets);
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
  var results = await fetchWalletRows(cfg, wallets);
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
function readBody(req) { return new Promise(function (resolve, reject) { var chunks=[], size=0, failed=false; req.on('data', function(c){ size+=Buffer.byteLength(c); if(size>12000){failed=true;chunks=[];} else if(!failed)chunks.push(Buffer.from(c)); }); req.on('end', function(){if(failed)return reject(new Error('Request is too large.'));resolve(Buffer.concat(chunks).toString('utf8'));}); req.on('error', reject); }); }
function parseCookies(req) { var out=Object.create(null); String(req.headers.cookie||'').split(';').forEach(function(p){var i=p.indexOf('=');if(i>0){try{out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());}catch(_){}}});return out; }

function isSecure(req) { try { return new URL(siwe.origin()).protocol === 'https:'; } catch (_) { return true; } }
function setCookie(res, name, val, maxAge, req) {
  var c = name + '=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
  if (isSecure(req)) c += '; Secure';
  var prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
async function authedAddr(req) { var t = await sessionPayload(req); return (t && t.addr) ? t.addr : null; }
async function sessionPayload(req) { try { return await siwe.readSession(parseCookies(req).siwe); } catch (_) { return null; } }
// The signed-in user's wallet set: primary ("You") + linked view-only wallets.
async function sessionWallets(req) {
  var t = await sessionPayload(req);
  if (!t || !t.addr) return [];
  var out = [{ addr: t.addr, alias: 'You' }];
  (t.linked || []).forEach(function (a) { a = String(a).toLowerCase(); if (isAddr(a) && a !== t.addr) out.push({ addr: a, alias: a.slice(0, 6) + '…' + a.slice(-4) }); });
  return out;
}

module.exports = async function handler(req, res) {
  var url; try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (_) { return send(res, 400, 'text/plain', 'Malformed URL'); }
  var qs = (req.url || '').split('?')[1] || '';

  if (url === '/' || url === '') return send(res, 200, 'text/html', landingHTML());
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // Vendor scripts, esbuild-bundled into self-contained files (see scripts/*-entry.js). Explicit
  // allowlist, not a wildcard route — no filename param, so no path-traversal surface.
  if (VENDOR_FILES[url]) {
    if (VENDOR_CACHE[url] == null) { try { VENDOR_CACHE[url] = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', VENDOR_FILES[url])); } catch (e) { VENDOR_CACHE[url] = ''; } }
    if (!VENDOR_CACHE[url]) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'application/javascript; charset=utf-8', VENDOR_CACHE[url], { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  }
  if (url !== '/' && rateLimited(req)) return send(res, 429, 'text/plain; charset=utf-8', 'Too many requests — please slow down a moment.');

  if (url === '/api/collections') {
    return json(res, { collections: registry.all().map(function (c) { return { slug: c.slug, name: c.name, emoji: (c.branding || {}).emoji || '', supply: c.supply, curated: !!c.curated }; }) });
  }

  // Authentication is disabled unless a strong secret, exact origin and shared storage are configured.
  if (url.startsWith('/api/siwe/') || url.startsWith('/api/wallets')) {
    res.setHeader('Cache-Control','no-store');
    if (url === '/api/siwe/me' && req.method === 'GET') { var me = await authedAddr(req); return json(res,{address:me,donor:me?isDonor(me):false,signInAvailable:siwe.configured()}); }
    if (url === '/api/wallets' && req.method === 'GET') { var current = await sessionPayload(req); return json(res,current?{primary:current.addr,linked:current.linked}:{primary:null,linked:[]}); }
    if (!siwe.configured()) return send(res,503,'application/json',JSON.stringify({ok:false,error:'Private sign-in is not configured.'}));
    const needsJson = ['/api/siwe/nonce','/api/siwe/verify','/api/siwe/cancel','/api/wallets/link','/api/wallets/unlink'].includes(url);
    if (!siwe.requestAllowed(req,'POST',needsJson)) return send(res,403,'application/json',JSON.stringify({ok:false,error:'This action requires a same-origin POST.'}));
    try {
      if (url === '/api/siwe/logout') { await siwe.cancelChallenge(parseCookies(req).siwe_nonce); await siwe.logout(parseCookies(req).siwe); setCookie(res,'siwe','',0,req);setCookie(res,'siwe_nonce','',0,req);return json(res,{ok:true}); }
      const body = needsJson ? JSON.parse(await readBody(req)) : {};
      if (url === '/api/siwe/cancel') {
        const ok=await siwe.cancelChallenge(body.cancelToken);
        return send(res,ok?200:400,'application/json',JSON.stringify({ok}));
      }
      if (url === '/api/siwe/nonce') {
        const challenge = await siwe.createChallenge(body.address);
        setCookie(res,'siwe_nonce',challenge.cookie,300,req);
        return json(res,{nonce:challenge.nonce,message:challenge.message,cancelToken:challenge.cancelToken});
      }
      if (url === '/api/siwe/verify') {
        const recovered = await siwe.verifyChallenge(parseCookies(req).siwe_nonce,body.message,body.signature);
        if (!recovered) return send(res,401,'application/json',JSON.stringify({ok:false,error:'Invalid or already-used sign-in challenge.'}));
        await siwe.logout(parseCookies(req).siwe);
        setCookie(res,'siwe_nonce','',0,req);
        setCookie(res,'siwe',await siwe.createSession(recovered,siwe.parseMessage(body.message).nonce,siwe.parseMessage(body.message).expires),siwe.SESSION_TTL,req);
        return json(res,{ok:true,address:recovered,donor:isDonor(recovered)});
      }
      if (url === '/api/wallets/link' || url === '/api/wallets/unlink') {
        const session = await sessionPayload(req); if (!session) return send(res,401,'application/json',JSON.stringify({ok:false,error:'Not signed in.'}));
        const address = String(body.address||'').toLowerCase(); if (!isAddr(address)) return send(res,400,'application/json',JSON.stringify({ok:false,error:'Invalid address.'}));
        let linked = session.linked.filter(a=>a!==address);
        if (url === '/api/wallets/link' && address !== session.addr) linked.push(address);
        if (linked.length > 5) return send(res,400,'application/json',JSON.stringify({ok:false,error:'At most 6 wallets including your primary.'}));
        if (!await siwe.updateLinked(session,linked)) return send(res,401,'application/json',JSON.stringify({ok:false,error:'Session expired.'}));
        return json(res,{ok:true,primary:session.addr,linked});
      }
      return send(res,404,'application/json',JSON.stringify({ok:false,error:'Not found.'}));
    } catch (_) { return send(res,400,'application/json',JSON.stringify({ok:false,error:'Sign-in request could not be completed. Please retry.'})); }
  }

  // Collection dashboard: /c/:slug  or  /c/:slug/:wallets
  var cmatch = url.match(/^\/c\/([a-z0-9_\-]+)(?:\/(.+))?$/i);
  if (cmatch) {
    var slug = cmatch[1].toLowerCase();
    if (!isSlug(slug)) return errorPage(res, 400, 'Bad collection', 'Invalid slug.');
    var wallets; try { wallets = cmatch[2] ? parseWallets(cmatch[2]) : await sessionWallets(req); } catch (e) { return errorPage(res, 400, 'Invalid wallets', e.message); }   // signed-in → primary + linked wallets
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
        if(rateLimited(req,wallets.length))return send(res,429,'text/plain','Wallet lookup limit reached. Please retry later.');
        var hf = lite ? await liteHoldings(cfg, wallets) : await holdingsFor(cfg, st, wallets);
        holdings = hf.holdings;
        walletLabel = wallets.map(function (w) { return w.alias; }).join(' + ');
        walletsMeta = wallets.length > 1 ? wallets.map(function (w, i) { return { alias: w.alias, count: hf.results[i].count }; }) : null;
      }
      var completion = (!lite && wallets.length) ? data.buildCompletion(st, holdings, data.currentMarket(st), data.currentAsOf(st)) : null;
      var authed = await authedAddr(req);
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
    var ws; try { ws = parseWallets(decodeURIComponent(wp || '')); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: e.message })); }
    if (!ws.length) return json(res, { error: 'no wallet' });
    if(rateLimited(req,ws.length))return send(res,429,'application/json',JSON.stringify({error:'Wallet lookup limit reached.'}));
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
