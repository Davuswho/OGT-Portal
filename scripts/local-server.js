// Local dev server for Claude Preview — loads .env and mounts api/index.js on a port.
'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (values trimmed → strips a stray Windows CR that would otherwise
// poison the OpenSea API key header — gotcha #2).
(function loadEnv() {
  try {
    var p = path.join(__dirname, '..', '.env');
    if (fs.existsSync(p)) {
      fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (l) {
        var m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      });
    }
  } catch (e) { /* no .env is fine */ }
})();

const http = require('http');
const handler = require('../api/index.js');
const PORT = process.env.PORT || 8780;

http.createServer(function (req, res) {
  Promise.resolve(handler(req, res)).catch(function (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String((e && e.stack) || e));
  });
}).listen(PORT, function () {
  console.log('NFT Trait Platform dev → http://localhost:' + PORT);
  console.log('OPENSEA_KEY ' + (process.env.OPENSEA_KEY ? 'loaded (' + process.env.OPENSEA_KEY.trim().length + ' chars)' : 'MISSING — wallet holdings will be empty'));
});
