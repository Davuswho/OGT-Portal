// OGenie badge engine — collect-the-set completion + badge-aware sell analysis.
// RULES ported from A:\Crypto Projects\OGenie NFT Tracker\_ott_badges.js (canonical; extracted
// from the official OGenie badge poster via OGenie-HQ, every trait value validated against the
// full-collection manifest — 0 phantom traits). Two poster corrections are already baked in:
// "OG-Unit T & Gold Chain" (poster: "Black T BP vest & Gold Chain") and "Monocle OG" (poster:
// "Monocle"). 'Masters Universe' deliberately lists ONLY 'Cosmos Visor Beam' — whether other
// Visor Beam variants count is unconfirmed by the team; keep poster-official until they clarify.
// Activated via cfg.modules.badges; the slug guard makes this OGenie-only regardless.
'use strict';

var RULES = {
  // Tier 1
  'Certified':              { t: 1, m: 'ExternalRule' },
  'OG Certified':           { t: 1, m: 'ExternalRule' },
  'Royal-G':                { t: 1, m: 'Regex', rx: 'crown' },
  'Celestial':              { t: 1, m: 'Regex', rx: 'celestial' },
  'RubResponsibly':         { t: 1, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'RUB Responsibly T' }] },
  'DiamondDealer':          { t: 1, m: 'AnyOf', c: [{ tt: '', tv: 'Diamond Hand' }] },
  'Magic Item':             { t: 1, m: 'Special' },
  // Tier 2
  'The Artist':             { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Paint Brush' }, { tt: '', tv: 'Apollo' }] },
  'Coffee Club':            { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Coffee OGm' }, { tt: '', tv: 'Coffee Mug' }] },
  'Animal Instinct':        { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Idube' }, { tt: '', tv: 'Bast' }, { tt: '', tv: 'Seshat' }, { tt: '', tv: 'Agassou' }] },
  'Cops & Robbers':         { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Jail T' }, { tt: '', tv: 'JPD' }, { tt: '', tv: 'Prison T' }] },
  'Tipsy':                  { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Beer Bottle' }, { tt: '', tv: 'On the Rocks' }, { tt: '', tv: 'SC Cocktail' }] },
  'Gladiator':              { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Ancient Helmet' }, { tt: '', tv: 'Sword' }, { tt: '', tv: 'Spartan Cloak' }] },
  'Make NFTs Great Again':  { t: 2, m: 'AnyOf', c: [{ tt: 'hair-hats', tv: 'MNGA' }, { tt: 'clothes', tv: 'Presidential' }, { tt: '', tv: 'Trumpie' }] },
  'I can see your Halo':    { t: 2, m: 'AnyOf', c: [{ tt: 'head-gear', tv: 'Gold Halo' }, { tt: 'head-gear', tv: 'Smoke Halo' }, { tt: 'head-gear', tv: 'Barbed Halo' }] },
  'Wizard':                 { t: 2, m: 'AnyOf', c: [{ tt: 'hair-hats', tv: 'OG Wizard Hat' }, { tt: 'hair-hats', tv: 'Wizard Hat' }, { tt: '', tv: 'Stardust' }] },
  'Born to Ride':           { t: 2, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'Punk Leather Jacket' }, { tt: 'clothes', tv: 'Biker Vest' }, { tt: 'hair-hats', tv: 'Biker Helmet Black' }] },
  'Faded':                  { t: 2, m: 'AnyOf', c: [{ tt: 'hair-hats', tv: 'Fade & Horns' }, { tt: 'hair-hats', tv: 'Fade' }, { tt: 'hair-hats', tv: 'Blond Fade' }, { tt: 'hair-hats', tv: 'OG Green Fade' }, { tt: 'hair-hats', tv: 'Hot Pink Fade' }] },
  'Suited & Booted':        { t: 2, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'Grey Suit Black Tie' }, { tt: 'clothes', tv: 'Black Suit' }, { tt: 'clothes', tv: 'Black Shirt OG Green Suit' }, { tt: 'clothes', tv: 'White Shirt OG Green Suit' }, { tt: 'clothes', tv: 'Tweed Suit' }, { tt: 'clothes', tv: 'Shirt & Vest' }] },
  'Weaponised':             { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Katana Gold' }, { tt: '', tv: 'Katana Silver' }, { tt: '', tv: 'Transparent Axe' }, { tt: '', tv: 'Silver Axe' }, { tt: '', tv: 'Gold Axe' }, { tt: '', tv: 'RayGun' }, { tt: '', tv: 'Sword' }] },
  'Fire Lord':              { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Devine Fire' }, { tt: '', tv: 'Celestial Fire' }, { tt: '', tv: 'Fire Tattoo' }, { tt: '', tv: 'Fire Bun' }, { tt: '', tv: 'Fire Fist' }, { tt: '', tv: 'Fire Element' }, { tt: '', tv: 'Flame Control' }] },
  'Water Lord':             { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Devine Water' }, { tt: '', tv: 'Water Tattoo' }, { tt: '', tv: 'Celestial Water' }, { tt: '', tv: 'Water Hair' }, { tt: '', tv: 'Water Fist' }, { tt: '', tv: 'Water Control' }, { tt: '', tv: 'Water Element' }] },
  'Air Lord':               { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Air Element' }, { tt: '', tv: 'Air Hair' }, { tt: '', tv: 'Air White Tattoo' }, { tt: '', tv: 'Air Black Tattoo' }, { tt: '', tv: 'Celestial Air' }, { tt: '', tv: 'Storm' }, { tt: '', tv: 'Storm Fist' }, { tt: '', tv: 'Storm Control' }] },
  'Earth Lord':             { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Earth Hair' }, { tt: '', tv: 'Devine Earth' }, { tt: '', tv: 'Earth Element' }, { tt: '', tv: 'Celestial Earth' }, { tt: '', tv: 'Flower Power' }] },
  'Lumberjack':             { t: 2, m: 'AnyOf', c: [{ tt: '', tv: 'Transparent Axe' }, { tt: '', tv: 'Silver Axe' }, { tt: '', tv: 'Gold Axe' }, { tt: '', tv: 'Flannel OG Green' }, { tt: '', tv: 'Flannel Dark Red' }, { tt: '', tv: 'Flannel Green' }, { tt: '', tv: 'Flannel Red' }, { tt: '', tv: 'Orange Beanie' }] },
  // Tier 3
  'Techno':                 { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Tech Specs' }, { tt: '', tv: 'Gamer' }, { tt: 'clothes', tv: 'Special: Space Riding Suit' }, { tt: '', tv: 'G-Pods' }] },
  'Bandana Gang':           { t: 3, m: 'AnyOf', c: [{ tt: 'hair-hats', tv: 'Sushi Bandana Black' }, { tt: 'hair-hats', tv: 'Sushi Bandana White' }, { tt: 'hair-hats', tv: 'Red Bandana' }, { tt: 'hair-hats', tv: 'Black Bandana' }, { tt: 'hair-hats', tv: 'Blond Bandana' }, { tt: 'hair-hats', tv: 'Blue Bandana' }, { tt: 'hair-hats', tv: 'Clear Bandana' }, { tt: 'hair-hats', tv: 'Pink Bandana' }] },
  'The Authority':          { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'JPD' }, { tt: 'clothes', tv: 'OG-Unit Vest' }, { tt: 'clothes', tv: 'Army Jacket' }, { tt: 'clothes', tv: 'Camo Jacket' }, { tt: 'clothes', tv: 'Black Camo Jacket' }, { tt: 'clothes', tv: 'OG-Unit T & Gold Chain' }] },
  'Bling Bling':            { t: 3, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'White T Gold Chain' }, { tt: 'clothes', tv: 'Silver OGT Chain & Black Shirt' }, { tt: 'clothes', tv: 'Silver OGT Chain' }, { tt: 'clothes', tv: 'OGT Gold Chain' }, { tt: 'clothes', tv: 'Black T Gold OGT Chain' }, { tt: 'clothes', tv: 'Sweatshirt Gold OGT Chain' }, { tt: 'clothes', tv: 'Gold Chain & Black T' }, { tt: 'clothes', tv: 'Gold Chain' }, { tt: 'clothes', tv: 'OG-Unit T & Gold Chain' }, { tt: '', tv: 'Diamond Stud' }] },
  'Hidden Lamp':            { t: 3, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'Red Shozoku' }, { tt: 'clothes', tv: 'OG Green Shozoku' }, { tt: 'clothes', tv: 'OG Green & Black Shozoku' }, { tt: 'clothes', tv: 'Black Shozoku' }, { tt: 'clothes', tv: 'Black & OG Green Shozoku' }, { tt: 'clothes', tv: 'Black & Red Shozoku' }, { tt: 'clothes', tv: 'Black & White Shozoku' }] },
  'Ninja Warrior':          { t: 3, m: 'AnyOf', c: [{ tt: 'clothes', tv: 'Red Shozoku' }, { tt: 'clothes', tv: 'OG Green Shozoku' }, { tt: 'clothes', tv: 'OG Green & Black Shozoku' }, { tt: 'clothes', tv: 'Black Shozoku' }, { tt: 'clothes', tv: 'Black & OG Green Shozoku' }, { tt: 'clothes', tv: 'Black & Red Shozoku' }, { tt: 'clothes', tv: 'Black & White Shozoku' }, { tt: '', tv: 'Katana Gold' }, { tt: '', tv: 'Katana Silver' }] },
  'Power Elements':         { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Storm Fist' }, { tt: '', tv: 'Air Element' }, { tt: '', tv: 'Flame Control' }, { tt: '', tv: 'Earth Element' }, { tt: '', tv: 'Water Element' }, { tt: '', tv: 'Fire Element' }, { tt: '', tv: 'Storm Control' }, { tt: '', tv: 'Fire Fist' }, { tt: '', tv: 'Water Fist' }] },
  'Distinguished':          { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Monocle OG' }, { tt: 'clothes', tv: 'Grey Suit Black Tie' }, { tt: 'clothes', tv: 'Black Suit' }, { tt: 'clothes', tv: 'Black Shirt OG Green Suit' }, { tt: 'clothes', tv: 'White Shirt OG Green Suit' }, { tt: 'clothes', tv: 'Tweed Suit' }, { tt: 'clothes', tv: 'Shirt & Vest' }] },
  'Masters Universe':       { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Stardust' }, { tt: '', tv: 'Celestial Cosmos' }, { tt: '', tv: 'Cosmos Visor Beam' }, { tt: '', tv: 'Celestial Eternity' }, { tt: '', tv: 'Molecule Control' }] },
  'Manifesting':            { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Transparent Wayfarer' }, { tt: '', tv: 'Transparent Pitvipers' }, { tt: '', tv: 'Transparent Bat' }, { tt: '', tv: 'Transparent Skateboard' }, { tt: '', tv: 'Transparent Axe' }, { tt: '', tv: 'Transparent Wizard Horn' }, { tt: '', tv: 'Transparent Water Bandana' }] },
  'I am the art':           { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'OG Element Tattoo' }, { tt: '', tv: 'Balor OG Tattoo' }, { tt: '', tv: 'Mars Tattoo' }, { tt: '', tv: 'Fire Tattoo' }, { tt: '', tv: 'Water Tattoo' }, { tt: '', tv: 'Pluto Dark Tattoo' }, { tt: '', tv: 'Glaucus Tattoo' }, { tt: '', tv: 'Pluto Blue Tattoo' }, { tt: '', tv: 'Air White Tattoo' }, { tt: '', tv: 'Air Black Tattoo' }] },
  'I love Goooold':         { t: 3, m: 'AnyOf', c: [{ tt: '', tv: 'Gold Axe' }, { tt: '', tv: 'Gold Ring & Bracelet' }, { tt: '', tv: 'Katana Gold' }, { tt: '', tv: 'Gold Bat' }, { tt: 'head-gear', tv: 'Gold Halo' }, { tt: '', tv: 'Top G Gold' }, { tt: '', tv: 'Clubmaster Gold' }, { tt: '', tv: 'Sweatshirt Gold OGT Chain' }, { tt: '', tv: 'White T Gold Chain' }, { tt: '', tv: 'Gold Chain' }, { tt: '', tv: 'OG-Unit T & Gold Chain' }, { tt: '', tv: 'Gold Chain & Black T' }, { tt: '', tv: 'Black T Gold OGT Chain' }, { tt: '', tv: 'OGT Gold Chain' }, { tt: '', tv: 'Golden Ra' }, { tt: '', tv: 'Gold Loop' }, { tt: '', tv: 'Gold Stud' }, { tt: '', tv: 'Double Gold Loop' }, { tt: '', tv: 'Gold Bracelet & Ring' }, { tt: '', tv: 'Baseball Glove & Gold Ball' }, { tt: '', tv: 'Gold Grin' }] },
};

function buildIndexes(holdings) {
  var byTV = {}, byVal = {};
  holdings.forEach(function (h) {
    var id = String(h.id);
    (h.traits || []).forEach(function (t) {
      var k = t.tt + '||' + t.tv;
      (byTV[k] || (byTV[k] = [])).push(id);
      (byVal[t.tv] || (byVal[t.tv] = [])).push(id);
    });
  });
  return { byTV: byTV, byVal: byVal };
}

// Empty tt convention: the value is searched across ALL trait types (OGenie accessory traits
// appear under inconsistent type names in the metadata).
function supplyOf(rarity, tt, tv) {
  if (tt) return (rarity.s[tt] && rarity.s[tt][tv]) || 0;
  var s = 0;
  for (var ty in rarity.s) { if (rarity.s[ty][tv]) s += rarity.s[ty][tv]; }
  return s;
}

function osUrl(slug, tt, tv) {
  return 'https://opensea.io/collection/' + slug + '?traits=' + encodeURIComponent(JSON.stringify([{ traitType: tt || '', values: [tv] }]));
}

// holdings: [{id, traits:[{tt,tv}]}] · rarity: st.RARITY · slug: collection slug.
// AnyOf is collect-the-set: EVERY listed criterion needs a covering token for 'complete'.
function computeForWallet(holdings, rarity, slug) {
  if (slug !== 'ogenienft') return null; // OGenie-only badge system (Dave: non-negotiable)
  var idx = buildIndexes(holdings);
  var byTV = idx.byTV, byVal = idx.byVal;
  function ownToks(tt, tv) { return tt ? (byTV[tt + '||' + tv] || []) : (byVal[tv] || []); }

  var badges = [];
  for (var name in RULES) {
    var r = RULES[name];
    var b = { name: name, tier: r.t, mode: r.m };

    if (r.m === 'AnyOf') {
      b.criteria = r.c.map(function (crit) {
        var toks = ownToks(crit.tt, crit.tv);
        return { tt: crit.tt, tv: crit.tv, owned: toks.length > 0, tokens: toks.slice().sort(function (a, bb) { return +a - +bb; }), supply: supplyOf(rarity, crit.tt, crit.tv), osUrl: osUrl(slug, crit.tt, crit.tv) };
      });
      b.total = b.criteria.length;
      b.have = b.criteria.filter(function (c) { return c.owned; }).length;
      b.status = b.have === b.total ? 'complete' : (b.have > 0 ? 'partial' : 'none');
    } else if (r.m === 'Regex') {
      var rx = new RegExp(r.rx, 'i');
      var rtoks = [];
      holdings.forEach(function (h) { if ((h.traits || []).some(function (t) { return rx.test(t.tv); })) rtoks.push(String(h.id)); });
      b.tokens = rtoks.sort(function (a, bb) { return +a - +bb; });
      b.total = 1; b.have = rtoks.length ? 1 : 0;
      b.status = rtoks.length ? 'complete' : 'none';
      var opts = [];
      for (var ty in rarity.s) {
        for (var tv in rarity.s[ty]) {
          if (rx.test(tv) && !(byVal[tv] && byVal[tv].length)) opts.push({ tt: ty, tv: tv, supply: rarity.s[ty][tv], osUrl: osUrl(slug, ty, tv) });
        }
      }
      b.options = opts.sort(function (a, bb) { return a.supply - bb.supply; });
    } else if (r.m === 'Special') {
      var stoks = [];
      holdings.forEach(function (h) { if ((h.traits || []).some(function (t) { return /^special:/i.test(t.tv); })) stoks.push(String(h.id)); });
      b.tokens = stoks.sort(function (a, bb) { return +a - +bb; });
      b.total = 1; b.have = stoks.length ? 1 : 0;
      b.status = stoks.length ? 'complete' : 'none';
    } else { // ExternalRule — awarded off-chain by the OGenie team; display-only
      b.total = 1; b.have = 0; b.status = 'external';
    }
    badges.push(b);
  }

  var summary = { complete: 0, partial: 0, none: 0, external: 0 };
  badges.forEach(function (b) {
    if (b.status === 'complete') summary.complete++;
    else if (b.status === 'partial') summary.partial++;
    else if (b.status === 'external') summary.external++;
    else summary.none++;
  });
  return { badges: badges, summary: summary };
}

// Badge-aware sell analysis (Dave-approved model, OGenie standalone session 2026-07-20):
//  - badgeSole:  the token is the ONLY holding contributing ANY coverage to a badge —
//                selling loses the badge entirely → MUST_KEEP.
//  - critSoleComplete: sole coverage of one criterion of a COMPLETE badge — selling breaks an
//                earned badge (complete → partial) → MUST_KEEP.
//  - critSolePartial:  sole coverage of a criterion of a partial badge → RISKY.
function soleAnalysis(result) {
  var byToken = {};
  function rec(id) { return byToken[id] || (byToken[id] = { badgeSole: [], critSoleComplete: [], critSolePartial: [] }); }
  if (!result) return byToken;
  result.badges.forEach(function (b) {
    if (b.status === 'external' || b.have === 0) return;
    if (b.mode === 'AnyOf') {
      var contributors = {};
      b.criteria.forEach(function (c) { c.tokens.forEach(function (id) { contributors[id] = 1; }); });
      var cids = Object.keys(contributors);
      if (cids.length === 1) { rec(cids[0]).badgeSole.push(b.name); return; }
      b.criteria.forEach(function (c) {
        if (c.owned && c.tokens.length === 1) {
          var t = rec(c.tokens[0]);
          if (b.status === 'complete') t.critSoleComplete.push({ badge: b.name, tv: c.tv });
          else t.critSolePartial.push({ badge: b.name, tv: c.tv });
        }
      });
    } else if (b.tokens && b.tokens.length === 1) {
      rec(b.tokens[0]).badgeSole.push(b.name);
    }
  });
  return byToken;
}

module.exports = { RULES: RULES, computeForWallet: computeForWallet, soleAnalysis: soleAnalysis };
