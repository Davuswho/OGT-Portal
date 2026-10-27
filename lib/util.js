// Tiny shared helpers (HTTP responses, escaping, validation).
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function safeJson(value) { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, function(c) { return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); }); }

function isAddr(a) { return /^0x[0-9a-fA-F]{40}$/.test(String(a || '')); }

// OpenSea collection slugs are lowercase alnum + dashes/underscores. Guards path traversal
// (slugs are user-supplied and reach the filesystem / API path).
function isSlug(s) { return /^[a-z0-9][a-z0-9_-]{0,80}$/.test(String(s || '')); }

// Baseline security headers applied to every response. CSP allows 'unsafe-inline' for scripts/styles
// because the dashboards are intentionally single-file inline apps; the XSS vector is mitigated at the
// data layer (build.safeJson + output escaping). img-src is wide-open https: because NFT art is served
// from many CDNs. Tighten to nonces if the app is ever split into external JS.
// connect-src additionally allows WalletConnect's own relay/rpc/pulse/keys infrastructure — needed for
// the mobile wallet-connect bridge (public/vendor/wc-ethereum-provider.bundle.js, self-hosted, so
// script-src stays 'self'-only; only the relay/pairing NETWORK calls need a CSP allowance).
var WC_CONNECT_SRC = 'https://rpc.walletconnect.com https://rpc.walletconnect.org https://relay.walletconnect.com https://relay.walletconnect.org wss://relay.walletconnect.com wss://relay.walletconnect.org https://pulse.walletconnect.com https://pulse.walletconnect.org https://keys.walletconnect.com https://keys.walletconnect.org';
var SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' " + WC_CONNECT_SRC + "; frame-src https://verify.walletconnect.com https://verify.walletconnect.org; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, code, type, body, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type }, SECURITY_HEADERS, extra || {}));
  res.end(body);
}

function json(res, obj, extra) {
  // Keep the JSON response type explicit at this sink; safeJson preserves data while
  // also encoding HTML-significant characters if a response is viewed out of context.
  res.writeHead(200,Object.assign({},SECURITY_HEADERS,{'Access-Control-Allow-Origin':'*'},extra||{}, {'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'}));
  res.end(safeJson(obj));
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

module.exports = { esc: esc, safeJson: safeJson, isAddr: isAddr, isSlug: isSlug, send: send, json: json, sleep: sleep };
