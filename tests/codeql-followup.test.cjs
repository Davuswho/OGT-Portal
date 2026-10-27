 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
const utilsPath=path.join(root,'node_modules/@walletconnect/universal-provider/node_modules/@walletconnect/utils/dist/index.js');
const source=fs.readFileSync(utilsPath,'utf8');
const bundle=fs.readFileSync(path.join(root,'public/vendor/wc-ethereum-provider.bundle.js'),'utf8');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const valid=['https://t.me','https://t.me/','https://t.me/wallet/start?existing=1','HTTPS://T.ME/bot','https://t.me:443/bot'];
const invalid=['https://t.me.evil.example/bot','https://t.me@evil.example/bot','http://t.me/bot','https://user@t.me/bot','https://user:password@t.me/bot','https://t.me:8443/bot','https://t.me./bot','javascript:alert(1)','not a URL'];
test('Telegram classifier requires the exact HTTPS origin and rejects userinfo and nondefault ports',async()=>{
 const patch=await import('../scripts/wallet-vendor-patches.mjs');for(const url of valid)assert.equal(patch.isTelegramHttpsLink(url),true,url);for(const url of invalid)assert.equal(patch.isTelegramHttpsLink(url),false,url);
});
test('pinned source transform changes exactly one check, is deterministic and rejects source drift',async()=>{
 const patch=await import('../scripts/wallet-vendor-patches.mjs');const a=patch.patchWalletUtilsSource(source),b=patch.patchWalletUtilsSource(source);
 assert.equal(JSON.parse(fs.readFileSync(path.join(utilsPath,'../../package.json'),'utf8')).version,'2.26.0');
 assert.equal(sha256(source),patch.WALLET_UTILS_INPUT_SHA256);assert.equal(source.split('e.startsWith("https://t.me")').length-1,1);
 assert.equal(a.contents.split('e.startsWith("https://t.me")').length-1,0);assert.equal(a.contents.split('__ogtIsTelegramHttpsLink(e)').length-1,1);assert.equal(a.contents,b.contents);
 assert.throws(()=>patch.patchWalletUtilsSource(source+'\n'),/source changed/);assert.throws(()=>patch.patchWalletUtilsSource(a.contents),/source changed/);
});
test('actual transformed vendor link formatter applies Telegram encoding only to exact-origin links',async()=>{
 const patch=await import('../scripts/wallet-vendor-patches.mjs'),output=patch.patchWalletUtilsSource(source).contents;
 const prefix=output.slice(0,output.indexOf(source.slice(0,100)));
 const formatter=output.slice(output.indexOf('function rt(e,t,n){'),output.indexOf('function ot(e){'));
 assert.ok(prefix.includes('function __ogtIsTelegramHttpsLink'));assert.ok(formatter.includes('__ogtIsTelegramHttpsLink(e)'));
 const ctx={URL,at:value=>'encoded:'+value};vm.createContext(ctx);vm.runInContext(prefix+formatter+';globalThis.formatLink=rt;',ctx);
 for(const url of valid)assert.ok(ctx.formatLink(url,'123','topic').includes('startapp=encoded:'),url);
 for(const url of invalid)assert.equal(ctx.formatLink(url,'123','topic').includes('startapp=encoded:'),false,url);
});
test('built wallet bundle carries the reviewed transform and matching provenance',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/vendor/wallet-build-manifest.json'),'utf8'));
 assert.equal(manifest.sha256,sha256(bundle));assert.equal(manifest.vendorPatches.length,1);assert.equal(manifest.vendorPatches[0].inputSha256,sha256(source));
 assert.ok(bundle.includes('__ogtIsTelegramHttpsLink'));assert.equal(bundle.includes('.startsWith("https://t.me")'),false);
});
test('both flagged decoder additions form diagnostic strings, not random numbers',()=>{
 const first=bundle.slice(bundle.indexOf('  var K3 = {'),bundle.indexOf('  function Pn(t)'));
 const second=bundle.slice(bundle.indexOf('  var asciis = {'),bundle.indexOf('  function utf8ToBytes(str)'));
 assert.ok(first.includes('const i3 = t[s2] + t[s2 + 1]'));assert.ok(second.includes('const char = hex[hi] + hex[hi + 1]'));
 const contexts=[{code:first,name:'Ee2'},{code:'var hasHexBuiltin=false;'+second,name:'hexToBytes'}].map(({code,name})=>{const ctx={Uint8Array};vm.createContext(ctx);vm.runInContext(code+';globalThis.decode='+name,ctx);return ctx;});
 for(const ctx of contexts){const outputs=new Set();for(let i=0;i<256;i++){const hex=i.toString(16).padStart(2,'0');assert.deepEqual(Array.from(ctx.decode(hex)),[i]);outputs.add(ctx.decode(hex)[0]);}assert.equal(outputs.size,256);assert.throws(()=>ctx.decode('gz'),/non-hex character "gz"/);}
});
test('Verify URL membership is exact array equality, not substring matching',()=>{
 const declarations=['Bi','ae3','H4','ce2'].map(name=>{const match=bundle.match(new RegExp('  var '+name+' = [^\\n]+'));assert.ok(match,name);return match[0];}).join('\n');
 const expression=bundle.match(/this\.getVerifyUrl = (\([^\n]*\) => \{[\s\S]*?\n\s+\}), this\.fetchPublicKey/);assert.ok(expression);
 const ctx={logger:{info(){}}};vm.createContext(ctx);vm.runInContext(declarations+'\nglobalThis.getVerifyUrl='+expression[1],ctx);
 assert.ok(Array.isArray(ctx.ce2));assert.deepEqual(Array.from(ctx.ce2),['https://verify.walletconnect.com','https://verify.walletconnect.org']);
 for(const url of ctx.ce2)assert.equal(ctx.getVerifyUrl(url),url);
 for(const url of ['https://verify.walletconnect.org.evil.example','https://verify.walletconnect.org@evil.example','https://evil.example/?u=https://verify.walletconnect.org','http://verify.walletconnect.org'])assert.equal(ctx.getVerifyUrl(url),'https://verify.walletconnect.org');
});
test('JSON response sink is explicit, nosniff and round-trips HTML-like data as JSON only',()=>{
 const {json}=require('../lib/util'),response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
 const value={id:'word_123',message:'</script><svg onload=x()>&'};json(response,value);
 assert.equal(response.headers['Content-Type'],'application/json; charset=utf-8');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.deepEqual(JSON.parse(response.body),value);assert.doesNotMatch(response.body,/[<>&]/);
});
