// Dashboard builder — turns a collection + a wallet's holdings into the rendered HTML.
// Generalized from the Green Acres _ga build: the template (public/app.html) is themed per
// collection via an injected :root override + a BRAND object, and the few GA-specific display
// strings are swapped for non-GA collections.
'use strict';
const fs = require('fs');
const path = require('path');
const data = require('./data');
const { tierOf } = require('./rarity');
const badgesLib = require('./badges');
const { esc, safeJson } = require('./util');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');

function cnt(st, t, v) { return (st.RARITY.s[t] && st.RARITY.s[t][v]) || 0; }
function fmt(n) { return n ? Number(n).toLocaleString('en-US') : '—'; }
// Safe JSON for embedding inside a <script> tag: escaping < > & neutralizes any </script>
// breakout. Matters for user-added collections whose trait values are attacker-controlled.
function nameFor(cfg, id) { return (cfg.tokenNameFmt || (cfg.name + ' #{id}')).replace('{id}', id); }

// Coverage-aware sell/keep verdict (ported from GA). `uncovered` = traits no OTHER held token carries.
function sellOf(pr, rank, uncovered, uniqueTraits, TOTAL) {
  var names = uniqueTraits.slice(0, 3).map(function (t) { return t.value; }).join(', ') +
    (uniqueTraits.length > 3 ? ' +' + (uniqueTraits.length - 3) + ' more' : '');
  if (pr <= 0.10) {
    var uniqNote = uncovered > 0 ? ' · also the only copy of ' + uncovered + ' trait' + (uncovered > 1 ? 's' : '') + ' you own (' + names + ') — don’t part it out' : '';
    return { cls: 'MUST_KEEP', reason: 'Top ' + Math.max(1, Math.round(pr * 100)) + '% rarity (OpenSea rank #' + rank + ') — your most valuable, hold' + uniqNote };
  }
  if (uncovered > 0) return { cls: 'KEEP_TRAIT', reason: 'Holds the only copy of ' + uncovered + ' trait' + (uncovered > 1 ? 's' : '') + ' you own (' + names + ') — selling re-opens ' + (uncovered > 1 ? 'those gaps' : 'that gap') };
  if (pr >= 0.55) return { cls: 'SAFE_SELL', reason: 'Common (rank #' + rank + ' of ' + TOTAL + ') and every trait is duplicated on another NFT you own — safe to flip near floor' };
  return { cls: 'HOLD', reason: 'Mid rarity (rank #' + rank + ') — fully covered by your other NFTs; no rush either way' };
}

// Neutral dark theme for collections without baked colors (until branding.js resolves one).
function neutralTheme(accent) { return { bg: '#0b0e14', bg2: '#11151f', bg3: '#161b27', card: '#181e2b', border: '#283246', text: '#e6e9f0', muted: '#8a93a6', accent: accent || '#6ea8fe' }; }
function brandStyle(colors) {
  var c = (colors && colors.accent) ? colors : neutralTheme(colors && colors.accent);
  var keys = ['bg', 'bg2', 'bg3', 'card', 'border', 'text', 'muted', 'accent'];
  return ':root{' + keys.filter(function (k) { return /^#[0-9a-f]{3,8}$/i.test(c[k] || ''); }).map(function (k) { return '--' + k + ':' + c[k]; }).join(';') + '}';
}

// holdings: [{id, name?, img, traits:[{tt,tv}], wallet?, walletIdx?}]
// opts: { walletLabel, completion, wallets }
function buildDashboardHTML(st, holdings, opts) {
  opts = opts || {};
  var cfg = st.cfg, b = cfg.branding || {};
  var walletLabel = opts.walletLabel || 'wallet';
  var completion = opts.completion || null;
  var TOTAL = st.RARITY.total || cfg.supply || Object.keys(st.ALL).length || 0;

  var myTraitCount = {};
  holdings.forEach(function (h) { (h.traits || []).forEach(function (t) { var k = t.tt + '||' + t.tv; myTraitCount[k] = (myTraitCount[k] || 0) + 1; }); });

  var tokens = holdings.map(function (hd) {
    var rank = hd.rank || st.OS_RANK[hd.id] || st.STAT_RANK[hd.id] || TOTAL;
    var pr = TOTAL ? rank / TOTAL : 1;
    var traits = (hd.traits || []).map(function (t) { var c = cnt(st, t.tt, t.tv); return { type: t.tt, value: t.tv, count: c, pct: c && TOTAL ? c / TOTAL * 100 : 0 }; });
    var top = null;
    for (var i = 0; i < traits.length; i++) { var t = traits[i]; if (t.count > 0 && (!top || t.count < top.count)) top = { value: t.value, pct: t.pct, count: t.count }; }
    var uniqueTraits = (hd.traits || []).filter(function (t) { return myTraitCount[t.tt + '||' + t.tv] === 1; }).map(function (t) { return { type: t.tt, value: t.tv }; });
    var uncovered = uniqueTraits.length;
    return { id: String(hd.id), name: hd.name || nameFor(cfg, hd.id), img: hd.img || '', rank: rank, traits: traits, top: top, tier: tierOf(pr), coverage: { uncovered: uncovered, uniqueTraits: uniqueTraits }, sell: sellOf(pr, rank, uncovered, uniqueTraits, TOTAL), wallet: hd.wallet || null, walletIdx: hd.walletIdx || 0 };
  });
  tokens.sort(function (a, b) { return a.rank - b.rank; });

  // OGenie badge engine (cfg.modules.badges; lib is slug-guarded to ogenienft regardless) +
  // badge-aware sell verdicts per the model Dave approved in the standalone OGenie session:
  // sole holder of a whole badge → MUST_KEEP; sole criterion of a COMPLETE badge → MUST_KEEP
  // (selling breaks an earned badge); sole criterion of a partial badge → RISKY (new class).
  // Config "keepers" pins override everything (personal never-sell list).
  var BADGES = (cfg.modules && cfg.modules.badges) ? badgesLib.computeForWallet(holdings, st.RARITY, cfg.slug) : null;
  var soleBy = BADGES ? badgesLib.soleAnalysis(BADGES) : {};
  var keeperSet = {};
  (cfg.keepers || []).forEach(function (k) { keeperSet[String(k)] = true; });
  tokens.forEach(function (tk) {
    var s = soleBy[tk.id];
    if (s) {
      if (s.badgeSole.length) tk.sell = { cls: 'MUST_KEEP', reason: 'Sole holder of badge ' + s.badgeSole.join(' + ') + ' — selling loses the badge entirely' };
      else if (s.critSoleComplete.length) tk.sell = { cls: 'MUST_KEEP', reason: 'Only copy of ' + s.critSoleComplete[0].tv + ' for completed badge ' + s.critSoleComplete[0].badge + ' — selling breaks the badge' };
      else if (s.critSolePartial.length && tk.sell.cls !== 'MUST_KEEP') tk.sell = { cls: 'RISKY', reason: 'Only copy of ' + s.critSolePartial[0].tv + ' toward badge ' + s.critSolePartial[0].badge + (s.critSolePartial.length > 1 ? ' (+' + (s.critSolePartial.length - 1) + ' more badge criteria rest on it)' : '') };
    }
    if (keeperSet[tk.id]) tk.sell = { cls: 'MUST_KEEP', reason: 'Pinned keeper — marked never-sell in this collection\'s config' };
  });

  var byVal = {};
  for (var ti = 0; ti < tokens.length; ti++) {
    var tk = tokens[ti];
    for (var tr = 0; tr < tk.traits.length; tr++) {
      var trait = tk.traits[tr], k = trait.type + '||' + trait.value;
      (byVal[k] || (byVal[k] = { type: trait.type, value: trait.value, ids: [] })).ids.push(tk.id);
    }
  }
  var dupes = Object.keys(byVal).map(function (k) { return byVal[k]; })
    .filter(function (d) { return d.ids.length >= 2; })
    .map(function (d) { return { type: d.type, value: d.value, ids: d.ids.sort(function (a, b) { return (+a) - (+b); }) }; })
    .sort(function (a, b) { return cnt(st, a.type, a.value) - cnt(st, b.type, b.value); });

  var DATA = { held: tokens.length, total: TOTAL, rankSource: cfg.rankSource || 'OpenSea · OpenRarity', tokens: tokens, dupes: dupes, wallets: opts.wallets || null };

  var market = data.currentMarket(st);
  var myOwned = new Set(); holdings.forEach(function (h) { (h.traits || []).forEach(function (t) { myOwned.add(t.tt + '||' + t.tv); }); });
  var myIdSet = new Set(holdings.map(function (h) { return String(h.id); }));
  var offerQueue = market
    .filter(function (m) { return !myIdSet.has(String(m.id)); })
    .map(function (m) {
      var newTraits = (m.traits || []).filter(function (t) { return !myOwned.has(t.type + '||' + t.value); }).map(function (t) { return { type: t.type, value: t.value }; });
      var rank = st.OS_RANK[m.id] || st.STAT_RANK[m.id] || TOTAL;
      return { id: String(m.id), img: m.img || '', price: m.price, rank: rank, newTraits: newTraits, newCount: newTraits.length };
    })
    .filter(function (m) { return m.newCount > 0; })
    .sort(function (a, b) { return b.newCount - a.newCount || a.price - b.price; });
  // Offer Queue is donor-gated by default; "offersFree": true in a collection config
  // switches the paygate off for that collection (everyone gets it, signed in or not).
  var access = !!opts.access || !!cfg.offersFree;
  if (!access) offerQueue = [];   // don't ship the data to non-supporters

  var BRAND = {
    slug: cfg.slug, name: b.name || cfg.name, emoji: b.emoji || '', contract: cfg.contract,
    chain: cfg.chain || 'ethereum', supply: TOTAL, twitter: b.twitter || '', website: b.website || '',
    logo: b.logo || '', donate: cfg.donate || {}, roles: !!(st.ROLES && ((st.ROLES.groups && st.ROLES.groups.length) || (st.ROLES.sets && st.ROLES.sets.length))), gated: { offers: !access },
    burnEvent: cfg.burnEvent || null
  };

  var tierSupply = Object.create(null);
  for (var tid of Object.keys(st.ALL)) { var count = (st.ALL[tid] || []).length; tierSupply[count] = (tierSupply[count] || 0) + 1; }
  // Single pass over the trusted template: inserted data is never searched for placeholders again.
  var bindings = {
    DATA: safeJson(DATA), RARITY: safeJson(st.RARITY), FLOORS: safeJson(data.currentFloors(st)),
    FLOORS_ASOF: String(data.currentAsOf(st)).replace(/[^0-9: \-]/g, ''), HOLDERS: safeJson(st.HOLDERS),
    MARKET: safeJson(market), COMPLETION: safeJson(completion), OFFER_QUEUE: safeJson(offerQueue),
    ROLES: safeJson(st.ROLES || {groups: []}), BADGES: safeJson(BADGES), MODULES: safeJson(cfg.modules || {}),
    NO_RARITY: cfg.noRarity ? 'true' : 'false', TIER_SUPPLY: safeJson(tierSupply), VARIANT: '',
    WC_PROJECT_ID: safeJson((process.env.WALLETCONNECT_PROJECT_ID || '').trim()), BRAND: safeJson(BRAND),
    BRAND_STYLE: brandStyle(b.colors), WALLET_LABEL: esc(walletLabel),
    COLLECTION_NAME: esc(b.name || cfg.name || 'NFT'), COLLECTION_EMOJI: esc(b.emoji || ''), COLLECTION_SUPPLY: esc(fmt(TOTAL))
  };
  var out = TEMPLATE.replace(/__([A-Z_]+)__/g, function(token,key) { return Object.hasOwn(bindings,key) ? bindings[key] : token; });

  // Header tip/donation buttons were removed platform-wide (2026-08-08, Dave). BRAND.donate is
  // still shipped — the Offer Queue supporter panel uses it for its unlock CTA.
  return out;
}

module.exports = { buildDashboardHTML: buildDashboardHTML, sellOf: sellOf, brandStyle: brandStyle };
