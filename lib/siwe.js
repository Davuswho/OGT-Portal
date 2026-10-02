// Sign-In With Ethereum (EIP-4361) — proves a visitor controls a wallet via a gasless signature.
// Stateless: a short-lived signed nonce cookie guards the handshake; a signed session cookie (HMAC
// with SESSION_SECRET) carries the authenticated address afterwards. No DB, no custody, no funds access.
'use strict';
const crypto = require('crypto');
var ethers = null;
try { ethers = require('ethers'); } catch (e) { /* installed at deploy; verify() degrades to null locally if missing */ }

function secret() { return (process.env.SESSION_SECRET || 'dev-insecure-secret-change-me').trim(); }
const DAY = 86400;

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Buffer.from(s, 'base64').toString('utf8'); }
function hmac(data) { return b64u(crypto.createHmac('sha256', secret()).update(data).digest()); }

// Compact signed token:  base64url(payload).hmac   — payload always carries an `exp`.
function makeToken(payload, ttlSec) {
  payload = Object.assign({}, payload, { exp: Math.floor(Date.now() / 1000) + (ttlSec || 7 * DAY) });
  var body = b64u(JSON.stringify(payload));
  return body + '.' + hmac(body);
}
function readToken(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.'), body = parts[0], sig = parts[1];
  if (!body || !sig) return null;
  // constant-time compare
  var a = Buffer.from(hmac(body)), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { var p = JSON.parse(unb64u(body)); if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null; return p; } catch (e) { return null; }
}

function randomNonce() { return crypto.randomBytes(12).toString('hex'); }

// Parse the fields we validate out of a received EIP-4361 message (we don't rebuild it server-side).
function parseMessage(msg) {
  msg = String(msg || '');
  var addr = (msg.match(/\n(0x[0-9a-fA-F]{40})\n/) || [])[1] || (msg.match(/^0x[0-9a-fA-F]{40}$/m) || [])[0] || null;
  var nonce = (msg.match(/Nonce:\s*([A-Za-z0-9]+)/) || [])[1] || null;
  var domain = (msg.match(/^(\S+) wants you to sign in/) || [])[1] || null;
  return { address: addr ? addr.toLowerCase() : null, nonce: nonce, domain: domain };
}

// Recover the signer address from an EIP-191 personal_sign signature, or null.
function recover(message, signature) {
  if (!ethers) return null;
  try { return ethers.verifyMessage(message, signature).toLowerCase(); } catch (e) { return null; }
}

module.exports = { makeToken: makeToken, readToken: readToken, randomNonce: randomNonce, parseMessage: parseMessage, recover: recover, hasEthers: function () { return !!ethers; } };
