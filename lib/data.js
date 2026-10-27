// Per-collection data layer. Each collection's normalized JSON lives in data/<slug>/ and is
// loaded + cached on first use. The live market/floors cache is keyed PER collection so a warm
// lambda can hold several collections at once (Vercel has no shared store — gotcha #3).
'use strict';
const fs = require('fs');
const path = require('path');
const { fetchListings } = require('./opensea');
const alchemy = require('./alchemy');

const DATA_DIR = path.join(__dirname, '..', 'data');
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function dirFor(cfg) { return path.join(DATA_DIR, cfg.data || cfg.slug); }

var _cache = new Map(); // slug -> state

// Load (and memoize) a collection's bundled data. Missing files degrade to empty — a freshly
// added collection with no baked data still renders (holdings-only) until bake.js runs.
function loaded(cfg) {
  if (_cache.has(cfg.slug)) return _cache.get(cfg.slug);
  var dir = dirFor(cfg);
  var st = {
    cfg: cfg,
    ALL: readJSON(path.join(dir, 'all.json'), {}),
    RARITY: readJSON(path.join(dir, 'rarity.json'), { total: cfg.supply || 0, s: {} }),
    STAT_RANK: readJSON(path.join(dir, 'ranks.json'), {}),
    OS_RANK: readJSON(path.join(dir, 'os_ranks.json'), {}),
    IMAGES: readJSON(path.join(dir, 'images.json'), {}),
    HOLDERS: readJSON(path.join(dir, 'holders.json'), { totalHolders: 0, holders: [] }),
    BASE_MARKET: readJSON(path.join(dir, 'market.json'), []),
    BASE_FLOORS: readJSON(path.join(dir, 'floors.json'), { asOf: 'n/a', eth: {} }),
    ROLES: readJSON(path.join(dir, 'roles.json'), null),
    live: null, refreshing: null
  };
  _cache.set(cfg.slug, st);
  return st;
}

function imgFor(st, id) { return st.IMAGES[id] || st.IMAGES[String(parseInt(id, 10))] || ''; }

// ---- live market cache (per collection, warm-lambda only) ----------------
const TTL_MS = 10 * 60 * 1000;
function stamp() { var n = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes()); }
function floorsFromMarket(market) {
  var map = Object.create(null);
  for (var i = 0; i < market.length; i++) {
    var m = market[i], tr = m.traits || [];
    for (var j = 0; j < tr.length; j++) { var t = tr[j]; if (!map[t.type]) map[t.type] = Object.create(null); if (!(t.value in map[t.type]) || m.price < map[t.type][t.value]) map[t.type][t.value] = m.price; }
  }
  return map;
}
function fresh(st) { return st.live && (Date.now() - st.live.ts) < TTL_MS; }
function currentMarket(st) { return fresh(st) ? st.live.market : st.BASE_MARKET; }
function currentFloors(st) { return fresh(st) ? st.live.floors : (st.BASE_FLOORS.eth || {}); }
function currentAsOf(st) { return st.live ? st.live.asOf : (st.BASE_FLOORS.asOf || 'n/a'); }

async function doRefresh(st) {
  try {
    var raw = await fetchListings(st.cfg.slug);
    // OpenSea's bulk listings feed can keep returning an order for a while after it's been
    // fulfilled or cancelled on-chain. Cross-check each seller against who ACTUALLY currently
    // owns the token (one cheap collection-wide sweep via Alchemy) and drop the ghosts. Fails
    // open (no filtering) if the owner map can't be fetched, so this never blocks a refresh.
    var owners = null;
    if (alchemy.hasKey() && alchemy.supportsChain(st.cfg.chain)) {
      try { owners = await alchemy.fetchCollectionOwners(st.cfg.contract, st.cfg.chain); } catch (e) { owners = null; }
    }
    // A token can have multiple simultaneous listings (relisted at a new price before the old
    // order expires/is cancelled, cross-posted marketplaces, etc.) — OpenSea's bulk feed returns
    // all of them. Keep only the cheapest per token; a pricier duplicate of the same item is
    // never the right buy, and showing it just inflates "N listed" counts with noise.
    var cheapest = {};
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (!st.ALL[l.id]) continue;
      if (owners && l.seller && owners[l.id] && owners[l.id] !== l.seller) continue;   // ghost: seller no longer owns it
      if (!cheapest[l.id] || l.price < cheapest[l.id].price) cheapest[l.id] = l;
    }
    var market = Object.keys(cheapest).map(function (id) {
      var l = cheapest[id], tr = st.ALL[id];
      return { price: l.price, img: imgFor(st, id), traits: tr.map(function (p) { return { type: p[0], value: p[1] }; }), id: id, rank: st.OS_RANK[id] || st.STAT_RANK[id] || null };
    });
    market.sort(function (a, b) { return a.price - b.price; });
    st.live = { market: market, floors: floorsFromMarket(market), asOf: stamp(), ts: Date.now() };
  } catch (e) { /* keep baseline on failure */ }
  return st.live;
}
async function refreshMarket(st) {
  if (!process.env.OPENSEA_KEY) return st.live;
  if (fresh(st)) return st.live;   // safe to call on every page load — no-ops within the TTL window
  if (st.refreshing) return st.refreshing;
  st.refreshing = doRefresh(st);
  try { return await st.refreshing; } finally { st.refreshing = null; }
}

// ---- per-wallet 100% completion plan (greedy set-cover) ------------------
// Generalized from GA: contract/chain/excluded trait types come from the collection config.
function buildCompletion(st, holdings, market, asOf) {
  var cfg = st.cfg, RARITY = st.RARITY;
  var TOTAL = RARITY.total || cfg.supply || Object.keys(st.ALL).length || 0;
  var EXCLUDE = (cfg.excludeTraitTypes || []).reduce(function (o, t) { o[t] = 1; return o; }, {});
  // Auto-exclude any "1/1 · Unique · One of One" trait category for ANY collection, even if the
  // config didn't list it (Dave's rule: 1/1 exclusives never count toward completion).
  Object.keys(RARITY.s || {}).forEach(function (t) { if (/^\s*(1\s*\/\s*1s?|1 of 1|one[\s-]?of[\s-]?one|unique)\s*$/i.test(t)) EXCLUDE[t] = 1; });

  var universe = {};
  Object.keys(RARITY.s || {}).forEach(function (type) {
    if (EXCLUDE[type]) return;
    Object.keys(RARITY.s[type]).forEach(function (value) {
      if (RARITY.s[type][value] > 1) universe[type + '||' + value] = true;
    });
  });
  var universeSize = Object.keys(universe).length;

  var owned = {};
  holdings.forEach(function (h) { (h.traits || []).forEach(function (t) { owned[t.tt + '||' + t.tv] = true; }); });
  var ownedCount = Object.keys(owned).filter(function (k) { return universe[k]; }).length;

  var missing = {};
  Object.keys(universe).forEach(function (k) { if (!owned[k]) missing[k] = true; });
  var missingCount = Object.keys(missing).length;

  var heldIds = {};
  holdings.forEach(function (h) { heldIds[String(h.id)] = true; });
  var CONTRACT = cfg.contract, CHAIN = cfg.chain || 'ethereum';

  var candidates = [];
  market.forEach(function (m) {
    if (heldIds[String(m.id)]) return;
    var fills = (m.traits || []).filter(function (t) { return missing[t.type + '||' + t.value]; }).map(function (t) { return { type: t.type, value: t.value }; });
    if (fills.length > 0) candidates.push({ id: m.id, price: m.price, rank: m.rank, img: m.img, url: 'https://opensea.io/assets/' + CHAIN + '/' + CONTRACT + '/' + m.id, fills: fills });
  });

  var obtainableSet = {};
  candidates.forEach(function (c) { c.fills.forEach(function (f) { obtainableSet[f.type + '||' + f.value] = true; }); });
  var obtainableCount = Object.keys(obtainableSet).length;

  var unobtainable = Object.keys(missing).filter(function (k) { return !obtainableSet[k]; }).map(function (k) {
    var sep = k.indexOf('||'), type = k.slice(0, sep), value = k.slice(sep + 2);
    var supply = (RARITY.s[type] && RARITY.s[type][value]) || 0;
    var estEth = +(0.02 + (1 - (TOTAL ? supply / TOTAL : 0)) * 0.15).toFixed(4);
    return { type: type, value: value, supply: supply, estEth: estEth };
  });

  function buildPlan(sortFn) {
    var remaining = {};
    Object.keys(missing).forEach(function (k) { if (obtainableSet[k]) remaining[k] = true; });
    var pool = candidates.map(function (c) { return { id: c.id, price: c.price, rank: c.rank, img: c.img, url: c.url, allFills: c.fills }; });
    var selected = [];
    while (Object.keys(remaining).length > 0 && pool.length > 0) {
      pool.forEach(function (c) { c.curFills = c.allFills.filter(function (f) { return remaining[f.type + '||' + f.value]; }); });
      pool = pool.filter(function (c) { return c.curFills.length > 0; });
      if (!pool.length) break;
      pool.sort(sortFn);
      var pick = pool[0];
      selected.push({ id: pick.id, price: pick.price, rank: pick.rank, img: pick.img, url: pick.url, fills: pick.curFills });
      pick.curFills.forEach(function (f) { delete remaining[f.type + '||' + f.value]; });
      pool = pool.filter(function (c) { return c.id !== pick.id; });
    }
    var totalEth = selected.reduce(function (s, x) { return s + x.price; }, 0);
    var totalFilled = selected.reduce(function (s, x) { return s + x.fills.length; }, 0);
    return { nfts: selected.length, totalEth: +totalEth.toFixed(4), avgPerNft: selected.length ? +(totalEth / selected.length).toFixed(4) : 0, avgPerTrait: totalFilled ? +(totalEth / totalFilled).toFixed(4) : 0, items: selected };
  }

  var lowest = function (a, b) { return (a.price / a.curFills.length) - (b.price / b.curFills.length) || a.price - b.price; };
  var fewest = function (a, b) { return b.curFills.length - a.curFills.length || a.price - b.price; };
  var balanced = function (a, b) { var sa = a.curFills.length / Math.pow(a.price + 0.001, 0.6); var sb = b.curFills.length / Math.pow(b.price + 0.001, 0.6); return sb - sa; };

  return {
    mode: 'wallet', asOf: { listings: asOf }, ethUsd: null,
    onesExcluded: (cfg.excludeTraitTypes || []).length > 0, totalSupply: TOTAL,
    held: holdings.length, universeSize: universeSize, owned: ownedCount, missing: missingCount,
    obtainable: obtainableCount, unobtainable: unobtainable,
    plans: { lowest: buildPlan(lowest), balanced: buildPlan(balanced), fewest: buildPlan(fewest) }
  };
}

module.exports = {
  DATA_DIR: DATA_DIR, loaded: loaded, imgFor: imgFor,
  currentMarket: currentMarket, currentFloors: currentFloors, currentAsOf: currentAsOf,
  refreshMarket: refreshMarket, buildCompletion: buildCompletion
};
