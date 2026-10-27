import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const result = await build({entryPoints:['scripts/wc-entry.js'],outfile:'public/vendor/wc-ethereum-provider.bundle.js',bundle:true,format:'iife',platform:'browser',target:['es2020'],legalComments:'eof',metafile:true,define:{global:'globalThis'}});
const bytes=await readFile('public/vendor/wc-ethereum-provider.bundle.js');
const manifest={builtAt:new Date().toISOString(),source:'scripts/wc-provider-adapter.mjs',upstream:'@walletconnect/universal-provider@2.26.0',output:'public/vendor/wc-ethereum-provider.bundle.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),inputs:Object.keys(result.metafile.inputs).sort()};
await writeFile('public/vendor/wallet-build-manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Bust caches held by previous immutable, unversioned deployments.
for(const file of ['public/app.html','public/landing.html']) {
  const source=await readFile(file,'utf8');
  await writeFile(file,source.replace(/\/vendor\/wc-ethereum-provider\.bundle\.js(?:\?v=[a-f0-9]+)?/g,'/vendor/wc-ethereum-provider.bundle.js?v='+manifest.sha256));
}
console.log(JSON.stringify({bytes:manifest.bytes,sha256:manifest.sha256,inputs:manifest.inputs.length}));