// MARKET-ONLY refresh. Usage: node scripts/refresh-market.js <slug>
//
// Companion to bake-onchain.js. Division of responsibility:
//   contract  → traits, rarity, ranks, images   (bake-onchain.js)
//   OpenSea   → listings and trait floors        (this script)
//
// scripts/bake.js also rewrites all.json/rarity.json/ranks.json from the OpenSea indexer, which
// silently undoes the contract-direct bake and re-introduces the 15-25% trait undercounts. Use
// this instead whenever you only need fresh prices.
'use strict';
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  try {
    var p = path.join(__dirname, '..', '.env');
    if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (l) {
      var m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch (e) { }
})();
const os = require('../lib/opensea');
const registry = require('../lib/registry');

function stamp() { var n = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes()); }

async function main() {
  var slug = process.argv[2];
  if (!slug) { console.error('usage: node scripts/refresh-market.js <slug>'); process.exit(1); }
  var cfg = registry.load(slug);
  if (!cfg) { console.error('no config for ' + slug); process.exit(1); }
  var dir = path.join(__dirname, '..', 'data', cfg.data || slug);

  var R = function (n) { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return null; } };
  var all = R('all.json');
  if (!all || !Object.keys(all).length) { console.error('no all.json — run bake-onchain.js first'); process.exit(1); }
  var images = R('images.json') || {}, osRanks = R('os_ranks.json') || {}, statRanks = R('ranks.json') || {};
  var prevM = R('market.json') || [];

  console.log('Market refresh: ' + slug + '  (traits stay contract-sourced, ' + Object.keys(all).length + ' tokens)');
  var listings = await os.fetchListings(slug, 30);
  console.log('  raw listings pulled: ' + listings.length);

  // A token can carry several simultaneous listings — keep only the cheapest, same as lib/data.js.
  var cheapest = {};
  var unknown = 0;
  listings.forEach(function (l) {
    if (!all[l.id]) { unknown++; return; }               // unrevealed or not in the bake
    if (!cheapest[l.id] || l.price < cheapest[l.id].price) cheapest[l.id] = l;
  });
  var market = Object.keys(cheapest).map(function (id) {
    var l = cheapest[id];
    return { id: id, price: l.price, img: images[id] || '', traits: all[id].map(function (p) { return { type: p[0], value: p[1] }; }), rank: osRanks[id] || statRanks[id] || null };
  });
  market.sort(function (a, b) { return a.price - b.price; });

  if (!market.length) { console.error('ABORT: zero usable listings — not overwriting market.json.'); process.exit(1); }

  var floors = {};
  market.forEach(function (m) {
    (m.traits || []).forEach(function (t) {
      if (!floors[t.type]) floors[t.type] = {};
      if (!(t.value in floors[t.type]) || m.price < floors[t.type][t.value]) floors[t.type][t.value] = m.price;
    });
  });

  var W = function (name, obj) { fs.writeFileSync(path.join(dir, name), JSON.stringify(obj)); };
  W('market.json', market); W('floors.json', { asOf: stamp(), eth: floors });

  console.log('  ✓ market.json + floors.json rewritten (' + stamp() + ')');
  console.log('    listed=' + market.length + ' (was ' + (prevM.length || 0) + ')  skipped=' + unknown + ' unrevealed/unknown');
  console.log('    floor Ξ' + market[0].price + '   traits with a floor: ' + Object.keys(floors).reduce(function (s, k) { return s + Object.keys(floors[k]).length; }, 0));
  console.log('    all.json / rarity.json / ranks.json / images.json untouched.');
}
main().catch(function (e) { console.error('ERR', e && e.stack || e); process.exit(1); });
