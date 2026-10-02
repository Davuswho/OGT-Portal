// Generates the DDG thematic/color/archetype "extras" into data/gorgez/roles.json, alongside
// the official Trophy sets (which are hand-maintained and left untouched).
// Definitions ported from the DDG Trait Tracker session handoff (2026-07-22), which mirror
// A:\Crypto Projects\DropDed Gorgez NFT Project\_ddg_sets_build.js. PROVENANCE: derived (Dave's
// own categorization), NOT official DDG — unlike the Trophy sets above them in the file.
// Validates every trait value against the current bake (reports phantoms) and pre-computes
// collection-wide count/pct per set so the client doesn't need the full-collection data.
// Usage: node scripts/gen-gorgez-sets.js   (re-run after re-baking gorgez)
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const ALL = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'gorgez', 'all.json'), 'utf8'));
const ROLES_PATH = path.join(DIR, 'data', 'gorgez', 'roles.json');
const roles = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));

const FF = ['FabForce - Space Ranger', 'FabForce - General Gorgez', 'FabForce - Gorgezmonaut', 'FabForce - LGPD Trooper', 'FabForce - GI Gorgez'];
const CITIZEN_EXCLUDE = FF.concat([
  'Supreme Guard', 'Supreme General', 'Supreme Wizard Cloak', 'Supreme Robes',
  'Royal Daemonic Armor', 'Royal Angelic Armor',
  'Shinobi Sky', 'Shinobi Sun', 'Shinobi Forest', 'Shinobi Waves', 'Shinobi Mountain',
  'Marquess', 'Kage', 'Baron', 'Duke', 'Earl', 'Dutchess',
  'Cape of the Wise Ones', 'Sorcerer', 'Enchanter', 'BioSuit', 'Warrior Robe',
  'Shaman', 'Shadow Council', 'Noble Council',
  'Tropical Green', 'Tropical Blue', 'Tropical MC',
  'Supras MC Vest', 'Vibes Up MC',
  'Gorgecci Hoody Red', 'Gorgecci Black',
  'BearWithUs T', 'BearWithUs Purple',
  'Bullish T', 'Bullish Green', 'Punked Blue', 'Punked T', 'Blue Camo Punk',
  'Vibes T', 'Real1s Green', 'Real1z T', 'Buildor Red', 'Buildor T',
]);

const EXTRAS = [
  // Archetypes — collection-wide groupings, informational
  { key: 'horde', kind: 'archetype', emoji: '🧟', name: 'The Horde', desc: 'Naked skeletons — no clothes, stick together to stay warm', rule: { type: 'archetype', name: 'horde' } },
  { key: 'horde-pure', kind: 'archetype', emoji: '💀', name: 'Pure Skeleton', desc: 'Bare bones — Background + Bones only, nothing else', rule: { type: 'archetype', name: 'horde-pure' } },
  { key: 'citizens', kind: 'archetype', emoji: '🏙️', name: 'Citizens', desc: 'Everyday Gorgez — casual street and civilian clothes', rule: { type: 'archetype', name: 'citizens', exclude: CITIZEN_EXCLUDE } },
  // Named thematic
  { key: 'unique-1of1', kind: 'named', emoji: '⚡', name: '1-of-1 Unique', desc: 'One of a kind — a single unique Gorgez in the entire collection', rule: { type: 'anyOf', slot: 'Unique', values: null } },
  { key: 'umbra-lords', kind: 'named', emoji: '🌑', name: 'Lords of Umbra', desc: 'The 25 Chapter-2 Lords — Umbra-aligned 1/1s living in the main 8888 contract', rule: { type: 'anyOf', slot: 'Alignment', values: ['Umbra'] } },
  { key: 'fabforce', kind: 'named', emoji: '⚔️', name: 'FabForce', desc: 'FabForce military/space unit uniform', rule: { type: 'anyOf', slot: 'Clothes', values: FF } },
  { key: 'fabforce-kit', kind: 'named', emoji: '🪖', name: 'FabForce Full Kit', desc: 'FabForce uniform AND a matching rank/command hat', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: FF }, { slot: 'Hat and Hair', values: ['The General', 'The Commissioner', 'Captain', 'Sergeant', 'Imperial', 'Gorgezmonaut Helmet'] }] } },
  { key: 'biosuit', kind: 'named', emoji: '🚀', name: 'BioSuit', desc: 'Full-body space/bio suit — rare standalone variant', rule: { type: 'anyOf', slot: 'Clothes', values: ['BioSuit'] } },
  { key: 'shinobi', kind: 'named', emoji: '🥷', name: 'Shinobi', desc: 'Full shinobi outfit — matching clothes and headwrap', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['Shinobi Sky', 'Shinobi Sun', 'Shinobi Forest', 'Shinobi Waves', 'Shinobi Mountain'] }, { slot: 'Hat and Hair', values: ['Shinobi Blue', 'Shinobi White'] }] } },
  { key: 'gorgezmonaut', kind: 'named', emoji: '👨‍🚀', name: 'Gorgezmonaut', desc: 'Space explorer — Gorgezmonaut suit or helmet', rule: { type: 'anyOfMulti', groups: [{ slot: 'Clothes', values: ['FabForce - Gorgezmonaut'] }, { slot: 'Hat and Hair', values: ['Gorgezmonaut Helmet'] }] } },
  { key: 'marquess', kind: 'named', emoji: '🎩', name: 'Marquess', desc: "Nobility — Marquess coat with captain's hat", rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['Marquess'] }, { slot: 'Hat and Hair', values: ['Capt. Marquess'] }] } },
  { key: 'general', kind: 'named', emoji: '🎖️', name: 'General', desc: 'Supreme General uniform with The General command hat', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['Supreme General', 'FabForce - General Gorgez'] }, { slot: 'Hat and Hair', values: ['The General', 'The Commissioner'] }] } },
  { key: 'gentleman', kind: 'named', emoji: '🎩', name: 'Gentleman', desc: 'Top hat and polo — the country club set', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['DDG Polo White', 'Polo Black', 'Preppy Blue', 'Preppy Red'] }, { slot: 'Hat and Hair', values: ['Bowler', 'Imperial', 'BowCap', 'SteamPunk', 'Dark Prince', 'The Commissioner'] }] } },
  { key: 'council', kind: 'named', emoji: '🏛️', name: 'Council', desc: 'Shadow or Noble Council — governance and power', rule: { type: 'anyOf', slot: 'Clothes', values: ['Shadow Council', 'Noble Council'] } },
  { key: 'angelic', kind: 'named', emoji: '😇', name: 'Angelic Order', desc: 'Royal Angelic Armor with angelic headgear', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['Royal Angelic Armor'] }, { slot: 'Hat and Hair', values: ['Angelic Bob', 'Gold Order Halo', 'Gorgez Halo', 'Crown of Divinity'] }] } },
  { key: 'daemon', kind: 'named', emoji: '😈', name: 'Chaos Daemon', desc: 'Daemonic armor + demon/chaos horns — pure chaos alignment', rule: { type: 'combo', groups: [{ slot: 'Clothes', values: ['Royal Daemonic Armor'] }, { slot: 'Hat and Hair', values: ['Daemon Horns', 'Chaos Horns'] }] } },
  { key: 'tropical', kind: 'named', emoji: '🌴', name: 'Tropical', desc: 'Tropical vibes — island and resort wear', rule: { type: 'anyOf', slot: 'Clothes', values: ['Tropical Green', 'Tropical Blue', 'Tropical MC'] } },
  { key: 'biker-mc', kind: 'named', emoji: '🏍️', name: 'Biker MC', desc: 'Motorcycle club vest — Supras MC, Tropical MC, or Vibes Up MC', rule: { type: 'anyOf', slot: 'Clothes', values: ['Supras MC Vest', 'Tropical MC', 'Vibes Up MC'] } },
  { key: 'gorgecci', kind: 'named', emoji: '💎', name: 'Gorgecci', desc: 'Luxury streetwear — Gorgecci hoodie in red or black', rule: { type: 'anyOf', slot: 'Clothes', values: ['Gorgecci Hoody Red', 'Gorgecci Black'] } },
  { key: 'bearwithus', kind: 'named', emoji: '🐻', name: 'BearWithUs', desc: 'Bear-branded clothing — the bear gang', rule: { type: 'anyOfMulti', groups: [{ slot: 'Clothes', values: ['BearWithUs T', 'BearWithUs Purple'] }, { slot: 'Hat and Hair', values: ['Bear-ish Cap'] }] } },
  { key: 'bullish', kind: 'named', emoji: '🐂', name: 'Bullish', desc: 'Bullish on everything — crypto degens', rule: { type: 'anyOf', slot: 'Clothes', values: ['Bullish T', 'Bullish Green'] } },
  { key: 'punked', kind: 'named', emoji: '🎸', name: 'Punked', desc: 'Punk rock attitude — Punked or Camo Punk clothes', rule: { type: 'anyOf', slot: 'Clothes', values: ['Punked Blue', 'Punked T', 'Blue Camo Punk'] } },
  { key: 'vibes', kind: 'named', emoji: '🎵', name: 'Vibes', desc: 'Good vibes only — Vibes T or Vibes Up MC', rule: { type: 'anyOf', slot: 'Clothes', values: ['Vibes T', 'Vibes Up MC'] } },
  { key: 'real1s', kind: 'named', emoji: '💯', name: 'Real1s', desc: 'Authentic streetwear — Real1s or Real1z drip', rule: { type: 'anyOf', slot: 'Clothes', values: ['Real1s Green', 'Real1z T'] } },
  { key: 'buildor', kind: 'named', emoji: '🔨', name: 'Buildor', desc: 'Builders and makers — Buildor branded gear', rule: { type: 'anyOf', slot: 'Clothes', values: ['Buildor Red', 'Buildor T'] } },
  // Color sets — ≥2 values from the list, across ALL trait types
  { key: 'white', kind: 'color', emoji: '🤍', name: 'White Set', rule: { type: 'color', min: 2, values: ['OffWhite', 'White T', 'Twin-Bun White', 'DDG Chain White T', 'DDG Polo White', 'Snow'] } },
  { key: 'gold', kind: 'color', emoji: '🟡', name: 'Gold Set', rule: { type: 'color', min: 2, values: ['Gold', 'Gold Hoody', 'Gold Vipers', 'Gold Order Halo', 'Gorgez Don Fur Gold'] } },
  { key: 'green', kind: 'color', emoji: '💚', name: 'Green Set', rule: { type: 'color', min: 2, values: ['Mint', 'Slicker Green', 'Tropical Green', 'Flannel Green', 'GV Hoody Green', 'Real1s Green', 'Bullish Green', 'SL Hoody Green', 'Sweater T Green', 'Avocado', 'Lime'] } },
  { key: 'pink', kind: 'color', emoji: '🩷', name: 'Pink Set', rule: { type: 'color', min: 2, values: ['Blush', 'Bubblegum', 'Bomber Pink', 'Crew Pink', 'Jacket Hoody Pink', 'Perm Pink', 'BW Cap Pink', 'Gorgez Don Fur Pink'] } },
  { key: 'red', kind: 'color', emoji: '❤️', name: 'Red Set', rule: { type: 'color', min: 2, values: ['Preppy Red', 'Varsity Red', 'Gorgecci Hoody Red', 'Buildor Red', 'Sweater T Red', 'Curls Red', 'Fringe Red', 'Crew Bowtie Red', 'DDG Puffer Red'] } },
  { key: 'black', kind: 'color', emoji: '🖤', name: 'Black Set', rule: { type: 'color', min: 2, values: ['Tshirt Black', 'Polo Black', 'Gorgecci Black', 'DDG Chain Black T', 'Sweater Vest Black', 'Spikey Black', 'Cap Black', 'Tank Black'] } },
  { key: 'purple', kind: 'color', emoji: '💜', name: 'Purple Set', rule: { type: 'color', min: 2, values: ['Mauve', 'Flannel Purple', 'Blow Up Body Purple', 'BearWithUs Purple', 'Sweater Vest Purple', 'Fringe Purple', 'Bun Purple', 'DedPhones Purple', 'Purple Straight', 'Mana Purple'] } },
  { key: 'blue', kind: 'color', emoji: '💙', name: 'Blue Set', rule: { type: 'color', min: 2, values: ['Soft Blue', 'Preppy Blue', 'Tropical Blue', 'Punked Blue', 'SL Hoody Blue', 'BW Blue Cap', 'Sweater Bow Blue', 'Scarf & Slicker Blue', 'Gypsy Blue', 'Mana Blue', 'Pigtail Blue', 'Shinobi Blue', 'Blueberry'] } },
];

// Single matching implementation — the client mirrors this in app.html matchExtra().
function matchExtra(set, tm, traitCount) {
  var r = set.rule;
  if (r.type === 'anyOf') {
    var v = tm[r.slot];
    if (!v) return null;
    if (r.values && r.values.indexOf(v) < 0) return null;
    return [{ type: r.slot, value: v }];
  }
  if (r.type === 'anyOfMulti') {
    var pieces = [];
    r.groups.forEach(function (g) { var gv = tm[g.slot]; if (gv && g.values.indexOf(gv) >= 0) pieces.push({ type: g.slot, value: gv }); });
    return pieces.length ? pieces : null;
  }
  if (r.type === 'combo') {
    var ps = [];
    for (var i = 0; i < r.groups.length; i++) {
      var g2 = r.groups[i], v2 = tm[g2.slot];
      if (!v2 || g2.values.indexOf(v2) < 0) return null;
      ps.push({ type: g2.slot, value: v2 });
    }
    return ps;
  }
  if (r.type === 'color') {
    var hits = [];
    for (var ty in tm) { if (r.values.indexOf(tm[ty]) >= 0) hits.push({ type: ty, value: tm[ty] }); }
    return hits.length >= (r.min || 2) ? hits : null;
  }
  if (r.type === 'archetype') {
    if (r.name === 'horde') {
      if (tm.Clothes) return null;
      return tm.Bones ? [{ type: 'Bones', value: tm.Bones }] : [{ type: 'Archetype', value: 'The Horde' }];
    }
    if (r.name === 'horde-pure') {
      if (tm.Clothes || traitCount !== 2 || !tm.Bones || !tm.Background) return null;
      return [{ type: 'Bones', value: tm.Bones }, { type: 'Background', value: tm.Background }];
    }
    if (r.name === 'citizens') {
      if (!tm.Clothes || r.exclude.indexOf(tm.Clothes) >= 0) return null;
      return [{ type: 'Clothes', value: tm.Clothes }];
    }
  }
  return null;
}

// Phantom-value validation against the current bake
var allVals = {};
for (var id in ALL) (ALL[id] || []).forEach(function (p) { allVals[p[1]] = 1; });
var phantoms = [];
EXTRAS.forEach(function (s) {
  var vals = [];
  if (s.rule.values) vals = s.rule.values;
  (s.rule.groups || []).forEach(function (g) { vals = vals.concat(g.values); });
  (s.rule.exclude || []).forEach(function (v) { vals.push(v); });
  vals.forEach(function (v) { if (!allVals[v]) phantoms.push(s.key + ': "' + v + '"'); });
});

// Collection-wide counts
var supply = Object.keys(ALL).length;
EXTRAS.forEach(function (s) {
  var count = 0;
  for (var id in ALL) {
    var arr = ALL[id] || [], tm = {};
    arr.forEach(function (p) { tm[p[0]] = p[1]; });
    if (matchExtra(s, tm, arr.length)) count++;
  }
  s.count = count;
  s.pct = +(count / supply * 100).toFixed(2);
});

roles.extras = EXTRAS;
fs.writeFileSync(ROLES_PATH, JSON.stringify(roles));
console.log('Wrote ' + EXTRAS.length + ' extras into data/gorgez/roles.json (supply base ' + supply + ')');
console.log(phantoms.length ? ('⚠ PHANTOM VALUES (not in bake): ' + phantoms.join(' | ')) : '✓ 0 phantom values — every trait value exists in the current bake');
EXTRAS.forEach(function (s) { console.log('  [' + s.key + '] ' + s.count + ' (' + s.pct + '%)'); });
