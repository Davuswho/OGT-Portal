// Auto-branding for dynamically-added collections, derived from OpenSea collection metadata.
// Accent color is derived deterministically from the slug so each added collection looks distinct
// (logo-pixel sampling is a later enhancement). All external strings are escaped at render time.
'use strict';

function accentFor(slug) {
  var h = 0;
  for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 68, 62);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  var to = function (v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); };
  return '#' + to(r) + to(g) + to(b);
}

// Build a branding object from an OpenSea collection metadata response.
function fromMeta(slug, meta) {
  meta = meta || {};
  var supply = meta.total_supply;
  return {
    emoji: '🎨',
    name: meta.name || slug,
    tagline: 'Trait Tracker · ' + (supply ? Number(supply).toLocaleString() + ' items · ' : '') + 'live via OpenSea',
    website: meta.project_url || meta.external_url || '',
    twitter: meta.twitter_username || '',
    logo: meta.image_url || '',
    banner: meta.banner_image_url || '',
    colors: { bg: '#0b0e14', bg2: '#11151f', bg3: '#161b27', card: '#181e2b', border: '#283246', text: '#e6e9f0', muted: '#8a93a6', accent: accentFor(slug) }
  };
}

module.exports = { fromMeta: fromMeta, accentFor: accentFor };
