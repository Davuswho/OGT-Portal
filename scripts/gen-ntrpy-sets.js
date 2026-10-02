// Generates data/ntrpygenesis/roles.json — NTRPY trophies, Mark classes and derived sets.
// PROVENANCE: the only set the project itself defines is THE CYCLE ("eight marks · eight answers to
// one question", ntrpy.fun) and the count threshold "gather the 8" (Field Report 08). Everything
// under `predicted` and `extras` is DERIVED (Cowork session 2026-08-21, Dave's call) — NOT official.
// Validates every trait value against the current bake (reports phantoms) and pre-computes
// collection-wide count/pct per extra. Usage: node scripts/gen-ntrpy-sets.js   (re-run after re-bake)
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const ALL = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'ntrpygenesis', 'all.json'), 'utf8'));
const OUT = path.join(DIR, 'data', 'ntrpygenesis', 'roles.json');

const MARKS = [
  ['PSYCHE', 'I', '🦋', 'Metamorphosis', 'change by total dissolution — the body liquefies; only the image of what it is becoming survives'],
  ['OUROBOROS', 'II', '🐍', 'Ecdysis', 'change by shedding — the snake goes blind right before it sees clearly'],
  ['PROTEUS', 'III', '🌊', 'Mutability', 'change by holding no fixed form — never one thing long enough to be caught'],
  ['ARACHNE', 'IV', '🕷️', 'Self-construction', 'change by building the structure out of your own body — the web costs what it is made of'],
  ['GLAUX', 'V', '🦉', 'Casting', 'change by casting out what will not dissolve — it swallows the thing whole and brings the bones back up'],
  ['KETOS', 'VI', '🐋', 'Return', 'change by going back — it walked on land first, then returned to the water and let the legs go'],
  ['SKORPIOS', 'VII', '🦂', 'Refusal', 'the one that will not change — it stings and drowns them both, because it is its nature'],
  ['THEORIA', 'VIII', '👁️', 'Witness', 'change by being seen — the watcher is inside the thing, not outside it'],
];
const PALETTES = ['SODIUM', 'OXIDE', 'IRIDESCENT', 'CRT', 'COLD ROOM', 'BONE', 'VOID', 'PRISMATIC'];
const GLYPHS = ['SIGNAL', 'TERMINAL', 'NUMERIC', 'BINARY', 'SPARSE', 'CLASSIC'];
const RES = ['COARSE', 'STANDARD', 'FINE', 'ULTRA'];
const BANDS = ['2', '3', '4', '5', '6', '7'];
function cap(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }
function roles(type, values, fmt) { return values.map(function (v) { return { name: fmt ? fmt(v) : cap(v), alts: [[type, v]] }; }); }

// ---- Trophies ---------------------------------------------------------------------------
// OFFICIAL-GROUNDED: the Cycle is the project's own taxonomy; what completing it earns is unannounced.
const SETS = [
  { key: 'the-cycle', emoji: '👁️', name: 'The Cycle', desc: 'Eight marks · eight answers to one question. Hold one of each Mark to complete the Cycle — the only set NTRPY itself defines (ntrpy.fun). What it earns is unannounced.',
    roles: MARKS.map(function (m) { return { name: m[1] + ' · ' + cap(m[0]), emoji: m[2], note: m[3], alts: [['Mark', m[0]]] }; }),
    note: 'Field Report 08 says "gather the 8 ▇▇▇▇" — the redacted word is "eyes" or "marks". On-chain behaviour (24 wallets at exactly 8, with duplicate Marks) says the market reads it as a COUNT; the Cycle is the hedge for the other reading. Skorpios (100 of 3,333) is the bottleneck by design.' },
];
// DERIVED — our own full-set trophies over the remaining trait families. Guesses, not intel.
const PREDICTED = [
  { key: 'full-spectrum', emoji: '🌈', name: 'Full Spectrum', desc: 'DERIVED — one of every Palette. Prismatic (16 exist) makes this the hardest set in the collection.', roles: roles('Palette', PALETTES), hardest: true },
  { key: 'glyph-master', emoji: '🔣', name: 'Glyph Master', desc: 'DERIVED — one of every Glyph Set (the six character alphabets the script draws with).', roles: roles('Glyph Set', GLYPHS) },
  { key: 'four-resolutions', emoji: '🔍', name: 'Four Resolutions', desc: 'DERIVED — Coarse, Standard, Fine and Ultra: every grain the script renders at.', roles: roles('Resolution', RES) },
  { key: 'spectral-ladder', emoji: '📶', name: 'Spectral Ladder', desc: 'DERIVED — every Spectral Band count from 2 to 7.', roles: roles('Spectral Bands', BANDS, function (v) { return v + ' bands'; }) },
  { key: 'dissolution', emoji: '🫠', name: 'Dissolution', desc: 'DERIVED — the four ways a specimen refuses the void: Decay, Inverted ground, Skorpios, Prismatic. These are the only four traits the market prices above floor.', hardest: true,
    roles: [{ name: 'Decayed', alts: [['Decay', 'Yes']] }, { name: 'Inverted', alts: [['Ground', 'Inverted']] }, { name: 'Skorpios', alts: [['Mark', 'SKORPIOS']] }, { name: 'Prismatic', alts: [['Prismatic', 'Yes']] }] },
];
// ---- Extras: Mark classes (kind archetype) + derived thematic sets (kind named) ----------
const EXTRAS = MARKS.map(function (m) {
  return { key: 'mark-' + m[0].toLowerCase(), kind: 'archetype', emoji: m[2], name: m[1] + ' · ' + cap(m[0]) + ' — ' + m[3], desc: m[4], rule: { type: 'anyOf', slot: 'Mark', values: [m[0]] } };
}).concat([
  { key: 'decayed', kind: 'named', emoji: '🫠', name: 'Decayed', desc: 'Mid-dissolution specimens (Decay = Yes). One of the four priced traits — ~1.6× floor on 21 Aug.', rule: { type: 'anyOf', slot: 'Decay', values: ['Yes'] } },
  { key: 'inverted', kind: 'named', emoji: '🔳', name: 'Inverted Ground', desc: 'The void turned inside out (Ground = Inverted). Priced trait — ~2× floor.', rule: { type: 'anyOf', slot: 'Ground', values: ['Inverted'] } },
  { key: 'prismatic', kind: 'named', emoji: '🌈', name: 'Prismatic', desc: 'Chrome that finally shows a colour of its own. 16 exist — ~30× floor, and zero listed after the 21 Aug sweep.', rule: { type: 'anyOf', slot: 'Prismatic', values: ['Yes'] } },
  { key: 'ultra', kind: 'named', emoji: '🔬', name: 'Ultra Resolution', desc: 'The finest grain the script renders at.', rule: { type: 'anyOf', slot: 'Resolution', values: ['ULTRA'] } },
  { key: 'crystalline', kind: 'named', emoji: '💠', name: 'Crystalline', desc: 'Sharp and symmetric — Fine or Ultra resolution with Bilateral symmetry. The most ordered specimens.', rule: { type: 'combo', groups: [{ slot: 'Resolution', values: ['FINE', 'ULTRA'] }, { slot: 'Symmetry', values: ['Bilateral'] }] } },
  { key: 'pure-chaos', kind: 'named', emoji: '🌪️', name: 'Pure Chaos', desc: 'Coarse, broken and decaying on one token — maximum entropy.', rule: { type: 'combo', groups: [{ slot: 'Resolution', values: ['COARSE'] }, { slot: 'Symmetry', values: ['Broken'] }, { slot: 'Decay', values: ['Yes'] }] } },
  { key: 'the-grail', kind: 'named', emoji: '🏆', name: 'The Grail', desc: 'Refusal rendered in colour — Skorpios AND Prismatic on one token.', rule: { type: 'combo', groups: [{ slot: 'Mark', values: ['SKORPIOS'] }, { slot: 'Prismatic', values: ['Yes'] }] } },
  { key: 'double-rare', kind: 'named', emoji: '✨', name: 'Double Rare', desc: 'Two or more of the priced traits (Skorpios, Decay, Inverted, Prismatic) on a single token.', rule: { type: 'color', min: 2, values: ['SKORPIOS', 'Inverted', 'Yes'] } },
]);

// Single matching implementation — mirrors app.html matchExtra() exactly (anyOf/anyOfMulti/combo/color).
function matchExtra(set, tm) {
  var r = set.rule;
  if (r.type === 'anyOf') { var v = tm[r.slot]; if (!v) return null; if (r.values && r.values.indexOf(v) < 0) return null; return [[r.slot, v]]; }
  if (r.type === 'anyOfMulti') { var ps = []; r.groups.forEach(function (g) { var gv = tm[g.slot]; if (gv && g.values.indexOf(gv) >= 0) ps.push([g.slot, gv]); }); return ps.length ? ps : null; }
  if (r.type === 'combo') { var out = []; for (var i = 0; i < r.groups.length; i++) { var g2 = r.groups[i], v2 = tm[g2.slot]; if (!v2 || g2.values.indexOf(v2) < 0) return null; out.push([g2.slot, v2]); } return out; }
  if (r.type === 'color') { var hits = []; for (var ty in tm) { if (r.values.indexOf(tm[ty]) >= 0) hits.push([ty, tm[ty]]); } return hits.length >= (r.min || 2) ? hits : null; }
  return null;
}
// Phantom-value validation against the current bake (type-aware for roles, value-only for extras)
var byType = {}, allVals = {};
for (var id in ALL) (ALL[id] || []).forEach(function (p) { (byType[p[0]] = byType[p[0]] || {})[p[1]] = 1; allVals[p[1]] = 1; });
var phantoms = [];
SETS.concat(PREDICTED).forEach(function (s) { s.roles.forEach(function (r) { r.alts.forEach(function (a) { if (!byType[a[0]] || !byType[a[0]][a[1]]) phantoms.push(s.key + ': ' + a[0] + '=' + a[1]); }); }); });
EXTRAS.forEach(function (s) {
  var vals = (s.rule.values || []).slice(); (s.rule.groups || []).forEach(function (g) { vals = vals.concat(g.values); });
  vals.forEach(function (v) { if (!allVals[v]) phantoms.push(s.key + ': "' + v + '"'); });
});
// Collection-wide counts for extras + supply per trophy role
var supply = Object.keys(ALL).length;
EXTRAS.forEach(function (s) {
  var count = 0;
  for (var id2 in ALL) { var tm = {}; (ALL[id2] || []).forEach(function (p) { tm[p[0]] = p[1]; }); if (matchExtra(s, tm)) count++; }
  s.count = count; s.pct = +(count / supply * 100).toFixed(2);
});
SETS.concat(PREDICTED).forEach(function (s) { s.roles.forEach(function (r) { r.supply = r.alts.reduce(function (n, a) { return n + ((byType[a[0]] || {})[a[1]] ? countOf(a[0], a[1]) : 0); }, 0); }); });
function countOf(t, v) { var n = 0; for (var k in ALL) { if ((ALL[k] || []).some(function (p) { return p[0] === t && p[1] === v; })) n++; } return n; }

var roles = {
  label: 'NTRPY — The Cycle & Trophies',
  tab: '👁️ The Cycle',
  kind: 'sets',
  provenance: 'The Cycle (8 Marks) is the project\'s own taxonomy (ntrpy.fun). "Gather the 8" (Field Report 08) is a COUNT threshold — see cult. Everything in predicted/extras is DERIVED by Dave\'s Cowork session on 2026-08-21 and is not official NTRPY utility.',
  cult: { name: 'The Cult', emoji: '🧿', threshold: 8, unit: 'eyes', source: 'Field Report 08 (team-issued, redacted): "gather the 8" → holder DAO / launchpad membership. Unbuilt, undated.', note: 'Count-based, wallet-wide. 75 wallets held 8+ and 24 held exactly 8 on 21 Aug 2026. UI hook only — the sets engine is trait-based; a count rule needs a small app.html addition.' },
  sets: SETS,
  predicted: PREDICTED,
  extras: EXTRAS,
  upcoming: [],
  archetypes: [],
  generated: new Date().toISOString(),
  supply: supply
};
fs.writeFileSync(OUT, JSON.stringify(roles));
console.log('Wrote data/ntrpygenesis/roles.json — ' + SETS.length + ' trophy set(s), ' + PREDICTED.length + ' derived sets, ' + EXTRAS.length + ' extras (supply base ' + supply + ')');
console.log(phantoms.length ? ('⚠ PHANTOM VALUES (not in bake): ' + phantoms.join(' | ')) : '✓ 0 phantom values — every trait value exists in the current bake');
SETS.concat(PREDICTED).forEach(function (s) { console.log('  [' + s.key + '] ' + s.roles.map(function (r) { return r.name + '=' + r.supply; }).join(', ')); });
EXTRAS.forEach(function (s) { console.log('  [' + s.key + '] ' + s.count + ' (' + s.pct + '%)'); });
