// One-time full-collection bake → data/<slug>/. Usage: node scripts/bake.js <slug>
// Pulls every token's traits from OpenSea, computes rarity + ranks, and writes the normalized
// files the platform reads. Falls back to per-token fetches for any token the bulk endpoint
// returned without traits (capped, so a trait-less bulk endpoint doesn't trigger thousands of calls).
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
const { computeRarity, computeStatRanks } = require('../lib/rarity');

function stamp() { var n = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes()); }

async function main() {
  var slug = process.argv[2];
  if (!slug) { console.error('usage: node scripts/bake.js <slug>'); process.exit(1); }
  var cfg = registry.load(slug);
  if (!cfg) { console.error('no config for ' + slug + ' — add collections/' + slug + '.json first'); process.exit(1); }
  var dir = path.join(__dirname, '..', 'data', cfg.data || slug);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Baking ' + slug + ' (' + cfg.contract + ' on ' + (cfg.chain || 'ethereum') + ')…');

  var nfts = await os.fetchCollectionNfts(slug, { onPage: function (n) { process.stdout.write('\r  pulled ' + n + ' tokens'); } });
  console.log('\n  total pulled: ' + nfts.length);

  var missing = nfts.filter(function (n) { return !n.traits || !n.traits.length; });
  console.log('  missing traits from bulk endpoint: ' + missing.length);
  var cap = Math.max(80, Math.floor(nfts.length * 0.2));
  if (missing.length && missing.length <= cap) {
    for (var i = 0; i < missing.length; i++) {
      try {
        var d = await os.fetchNft(cfg.chain, cfg.contract, missing[i].id);
        if (d && d.traits) { missing[i].traits = d.traits.map(function (t) { return [t.trait_type, String(t.value)]; }); if (d.rarity && d.rarity.rank) missing[i].rank = d.rarity.rank; if (!missing[i].image) missing[i].image = d.image_url || ''; }
      } catch (e) { }
      if (i % 20 === 0) process.stdout.write('\r  per-token fill ' + i + '/' + missing.length);
      await os.sleep(220);
    }
    console.log('');
  } else if (missing.length) {
    console.log('  ⚠ too many missing (>' + cap + ') — bulk endpoint likely omits traits for this collection; needs Alchemy. Proceeding with ' + (nfts.length - missing.length) + ' that have traits.');
  }

  var all = {}, images = {}, osRanks = {};
  nfts.forEach(function (n) { if (n.traits && n.traits.length) all[n.id] = n.traits; if (n.image) images[n.id] = n.image; if (n.rank) osRanks[n.id] = n.rank; });
  var rarity = computeRarity(all);
  var statRanks = computeStatRanks(all, rarity);

  console.log('  fetching listings…');
  var listings = await os.fetchListings(slug, 30);
  // Same dedup as the live refresh path (lib/data.js doRefresh) — a token can have multiple
  // simultaneous listings; keep only the cheapest per token.
  var cheapestL = {};
  listings.forEach(function (l) { if (!all[l.id]) return; if (!cheapestL[l.id] || l.price < cheapestL[l.id].price) cheapestL[l.id] = l; });
  var market = Object.keys(cheapestL).map(function (id) {
    var l = cheapestL[id];
    return { id: id, price: l.price, img: images[id] || '', traits: all[id].map(function (p) { return { type: p[0], value: p[1] }; }), rank: osRanks[id] || statRanks[id] || null };
  });
  market.sort(function (a, b) { return a.price - b.price; });
  var floors = {};
  market.forEach(function (m) { (m.traits || []).forEach(function (t) { if (!floors[t.type]) floors[t.type] = {}; if (!(t.value in floors[t.type]) || m.price < floors[t.type][t.value]) floors[t.type][t.value] = m.price; }); });

  var W = function (name, obj) { fs.writeFileSync(path.join(dir, name), JSON.stringify(obj)); };
  W('all.json', all); W('rarity.json', rarity); W('ranks.json', statRanks); W('os_ranks.json', osRanks);
  W('images.json', images); W('market.json', market); W('floors.json', { asOf: stamp(), eth: floors });
  if (!fs.existsSync(path.join(dir, 'holders.json'))) W('holders.json', { totalHolders: 0, holders: [] });

  console.log('  ✓ wrote data/' + (cfg.data || slug) + '/');
  console.log('    tokens=' + Object.keys(all).length + '  rarityTotal=' + rarity.total + '  listings=' + market.length + '  osRanks=' + Object.keys(osRanks).length + '  images=' + Object.keys(images).length);
  console.log('  → now set  "ready": true  and  "supply": ' + rarity.total + '  in collections/' + slug + '.json');
}
main().catch(function (e) { console.error('BAKE ERROR', e && e.stack || e); process.exit(1); });
