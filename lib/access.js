// Donor / supporter access list. A wallet is a "donor" if it's in data/whitelist.json, in the
// DONOR_WALLETS env var (comma-separated), or is the OWNER_WALLET. Used to gate premium features
// (e.g. the Offer Queue). NOTE: until SIWE sign-in lands this gates on the *viewed* wallet, so it's
// a supporter-unlock, not a hard paywall — sign-in makes it un-bypassable.
'use strict';
const fs = require('fs');
const path = require('path');

var _set = null;
function load() {
  if (_set) return _set;
  _set = {};
  try {
    var wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'whitelist.json'), 'utf8'));
    (wl.donors || []).forEach(function (a) { var k = String(a).toLowerCase().trim(); if (k) _set[k] = 1; });
  } catch (e) { /* no file = empty list */ }
  (process.env.DONOR_WALLETS || '').split(',').forEach(function (a) { a = a.toLowerCase().trim(); if (a) _set[a] = 1; });
  var ow = (process.env.OWNER_WALLET || '').toLowerCase().trim().split(':')[0];
  if (ow) _set[ow] = 1;
  return _set;
}
function isDonor(addr) { return !!load()[String(addr || '').toLowerCase().trim()]; }
function reload() { _set = null; return load(); } // call if the list changed without a fresh process

module.exports = { isDonor: isDonor, reload: reload };
