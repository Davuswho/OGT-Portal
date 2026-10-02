// Bake a collection from an EXTERNAL per-token traits file (for collections where OpenSea's bulk
// endpoint omits traits — e.g. SeaDrop collections on new chains like Robinhood).
//   node scripts/bake-from-traits.js <slug> <tokentraits.json> [--ranks] [--exclude Hash,Other]
// tokentraits.json shape: { "<id>": { "<traitType>": "<value>", ... } }  (NFT Lookup's
// ntrpy-marks-build.js writes exactly this). Images come from OpenSea's bulk endpoint (fast).
// --ranks pulls OpenSea's OpenRarity rank per token (slow: ~0.4s/token, resumable — existing
// os_ranks.json entries are kept). Without it, ranks fall back to lib/rarity stat ranks.
// Writes the same files scripts/bake.js writes: all/rarity/ranks/os_ranks/images/market/floors(/holders).
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
function arg(name, dflt) { var i = process.argv.indexOf(name); return i === -1 ? dflt : (process.argv[i + 1] && process.argv[i + 1][0] !== '-' ? process.argv[i + 1] : true); }
function readJSON(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }

async function main() {
  var slug = process.argv[2], src = process.argv[3];
  if (!slug || !src || src[0] === '-') { console.error('usage: node scripts/bake-from-traits.js <slug> <tokentraits.json> [--ranks] [--exclude A,B]'); process.exit(1); }
  var cfg = registry.load(slug);
  if (!cfg) { console.error('no config for ' + slug + ' — add collections/' + slug + '.json first'); process.exit(1); }
  var exclude = {}; String(arg('--exclude', '') || '').split(',').concat(cfg.excludeTraitTypes || []).forEach(function (t) { if (t) exclude[t] = 1; });
  var dir = path.join(__dirname, '..', 'data', cfg.data || slug);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Baking ' + slug + ' (' + cfg.contract + ' on ' + (cfg.chain || 'ethereum') + ') from ' + src + (Object.keys(exclude).length ? '  excluding: ' + Object.keys(exclude).join(', ') : ''));

  var ext = readJSON(src, null);
  if (!ext || typeof ext !== 'object') { console.error('cannot read ' + src); process.exit(1); }
  var all = {};
  Object.keys(ext).forEach(function (id) {
    var t = ext[id], arr = [];
    Object.keys(t || {}).forEach(function (k) { if (!exclude[k]) arr.push([k, String(t[k])]); });
    if (arr.length) all[String(id)] = arr;
  });
  console.log('  tokens with traits from file: ' + Object.keys(all).length);

  // Images (and any bulk-provided ranks) from OpenSea's bulk endpoint — fast, ~17 pages for 3,333.
  var images = readJSON(path.join(dir, 'images.json'), {}), osRanks = readJSON(path.join(dir, 'os_ranks.json'), {});
  try {
    var nfts = await os.fetchCollectionNfts(slug, { onPage: function (n) { process.stdout.write('\r  pulled ' + n + ' tokens (images)'); } });
    console.log('\n  bulk pull: ' + nfts.length);
    nfts.forEach(function (n) {
      if (n.image) images[n.id] = n.image;
      if (n.rank) osRanks[n.id] = n.rank;
      if (!all[n.id] && n.traits && n.traits.length) all[n.id] = n.traits.filter(function (p) { return !exclude[p[0]]; });
    });
  } catch (e) { console.log('  ⚠ bulk image pull failed: ' + e.message + ' (continuing with cached images)'); }

  // Optional: OpenSea OpenRarity rank per token (resumable; keeps what os_ranks.json already has).
  if (arg('--ranks', false)) {
    var need = Object.keys(all).filter(function (id) { return !osRanks[id]; });
    console.log('  --ranks: fetching OpenSea rank for ' + need.length + ' tokens (~' + Math.round(need.length * 0.4 / 60) + ' min)…');
    for (var i = 0; i < need.length; i++) {
      try {
        var d = await os.fetchNft(cfg.chain, cfg.contract, need[i]);
        if (d && d.rarity && d.rarity.rank) osRanks[need[i]] = d.rarity.rank;
        if (d && !images[need[i]] && d.image_url) images[need[i]] = d.image_url;
      } catch (e) { if (/rate/i.test(e.message)) await os.sleep(5000); }
      if (i % 50 === 0) { fs.writeFileSync(path.join(dir, 'os_ranks.json'), JSON.stringify(osRanks)); process.stdout.write('\r  ranks ' + i + '/' + need.length); }
      await os.sleep(230);
    }
    console.log('\n  os ranks now: ' + Object.keys(osRanks).length);
  }

  var rarity = computeRarity(all);
  var statRanks = computeStatRanks(all, rarity);

  console.log('  fetching listings…');
  var listings = await os.fetchListings(slug, 30);
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
  console.log('    tokens=' + Object.keys(all).length + '  rarityTotal=' + rarity.total + '  traitTypes=' + Object.keys(rarity.s).join(', '));
  console.log('    listings=' + market.length + '  osRanks=' + Object.keys(osRanks).length + '  images=' + Object.keys(images).length);
  if (Object.keys(osRanks).length < Object.keys(all).length) console.log('  note: ' + (Object.keys(all).length - Object.keys(osRanks).length) + ' tokens have no OpenSea rank yet → stat ranks used for those. Re-run with --ranks to fill (resumable).');
}
main().catch(function (e) { console.error('BAKE ERROR', e && e.stack || e); process.exit(1); });
