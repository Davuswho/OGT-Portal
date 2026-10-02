// Collection registry — loads curated configs from collections/*.json and merges env defaults.
// Dynamic (user-added) collections are resolved at request time by lib/branding + lib/data and
// (optionally) persisted to KV via lib/store; this module is the single lookup point for both.
'use strict';
const fs = require('fs');
const path = require('path');
const { isSlug } = require('./util');

const COLL_DIR = path.join(__dirname, '..', 'collections');

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function curatedSlugs() {
  var idx = readJSON(path.join(COLL_DIR, '_index.json'));
  return (idx && idx.curated) || [];
}

// Fill donate defaults from env if a config didn't specify them.
function withDefaults(cfg) {
  if (!cfg) return cfg;
  cfg.donate = cfg.donate || {};
  if (!cfg.donate.eth && process.env.DONATE_ETH) cfg.donate.eth = process.env.DONATE_ETH;
  if (!cfg.donate.stripe && process.env.DONATE_STRIPE) cfg.donate.stripe = process.env.DONATE_STRIPE;
  return cfg;
}

// Load a curated config by slug (or null). isSlug() blocks path traversal — slugs are user-supplied.
function load(slug) {
  if (!isSlug(slug)) return null;
  return withDefaults(readJSON(path.join(COLL_DIR, slug + '.json')));
}

function all() { return curatedSlugs().map(load).filter(Boolean); }

function isCurated(slug) { return curatedSlugs().indexOf(slug) !== -1; }

// Resolve a user-supplied slug against OpenSea (this IS the allowlist — only collections that
// actually exist on OpenSea resolve). Returns a dynamic, auto-branded "lite" config (cached 1h)
// or null. Powers add-any-collection. The full premium analysis still requires a curated bake.
var _dyn = {};
function resolveDynamic(slug) {
  if (!isSlug(slug)) return Promise.resolve(null);
  if (_dyn[slug] && (Date.now() - _dyn[slug].ts) < 3600000) return Promise.resolve(_dyn[slug].cfg);
  var os = require('./opensea');
  return os.collectionMeta(slug).then(function (meta) {
    if (!meta || (!meta.name && !(meta.contracts && meta.contracts.length))) return null;
    var c = (meta.contracts && meta.contracts[0]) || {};
    var cfg = withDefaults({
      slug: slug, name: meta.name || slug, contract: (c.address || '').toLowerCase(), chain: c.chain || 'ethereum',
      supply: meta.total_supply || null, curated: false, ready: true, lite: true, dataSource: 'opensea',
      rankSource: 'opensea-openrarity', tokenNameFmt: (meta.name || slug) + ' #{id}', excludeTraitTypes: [],
      modules: { completion: false, sellKeep: false, market: false, holders: false, missing: false, wishlist: false },
      branding: require('./branding').fromMeta(slug, meta)
    });
    _dyn[slug] = { cfg: cfg, ts: Date.now() };
    return cfg;
  }).catch(function () { return null; });
}

module.exports = { COLL_DIR: COLL_DIR, curatedSlugs: curatedSlugs, load: load, all: all, isCurated: isCurated, withDefaults: withDefaults, resolveDynamic: resolveDynamic };
