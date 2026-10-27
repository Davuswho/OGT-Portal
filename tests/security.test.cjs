'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {Wallet}=require('ethers');
const {safeJson,esc}=require('../lib/util');
function load(file,stubs={}) {const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),module={exports:{}};const real=require('node:module').createRequire(path.join(__dirname,'..',file));vm.runInNewContext('(function(require,module,exports,__dirname){'+source+'\n})',{process:{env:{}},console,Buffer,URL,Map,Set,Date,Promise,AbortSignal,Object})(id=>Object.hasOwn(stubs,id)?stubs[id]:real(id),module,module.exports,path.dirname(path.join(__dirname,'..',file)));return module.exports;}
function fakeState(name) {return {cfg:{slug:'synthetic',name,contract:'0x'+'1'.repeat(40),chain:'ethereum',branding:{name,emoji:'<svg>'},modules:{}},ALL:{},RARITY:{total:0,s:{}},OS_RANK:{},STAT_RANK:{},IMAGES:{},HOLDERS:{},BASE_MARKET:[],BASE_FLOORS:{eth:{},asOf:'2026-10-27'},live:null};}
test('safeJson round-trips hostile text without ending the script element',()=>{const value='</script><img src=x onerror=x()>\u2028&"';const encoded=safeJson(value);assert.equal(JSON.parse(encoded),value);assert.doesNotMatch(encoded,/[<>&\u2028\u2029]/);});
test('collection and wallet names stay text; placeholder-like data is never expanded again',()=>{
 const build=require('../lib/build');
 for(const name of ['</script><img src=x onerror="bad()">',"'\"\\\n&apostrophe;",'__WALLET_LABEL__ __DATA__ __BRAND__']) {
  const html=build.buildDashboardHTML(fakeState(name),[],{walletLabel:'</title><svg onload=bad()>\\'});
  assert.ok(html.includes('<h1>&lt;svg&gt; '+esc(name)+' Dashboard</h1>'));
  assert.ok(!html.includes('<img src=x onerror='));assert.ok(!html.includes('<svg onload='));
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 }
});
test('style values cannot inject CSS or close a style tag',()=>{const build=require('../lib/build');assert.doesNotMatch(build.brandStyle({accent:'red;}</style><script>x</script>'}),/script|red;/);});
test('inline JS attributes preserve entities, quotes, slashes, line breaks and astral text as data',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../public/app.html'),'utf8');const line=text.match(/function esc2\(s\)\{[^\n]+/)[0];const ctx={h:esc};vm.createContext(ctx);vm.runInContext(line,ctx);
 for(const input of ["&#39;);globalThis.bad=1;//",'&apos;);bad=1;//',"'\"\\\r\n\u2028<svg>&amp;","\\'x",'🧞']) {
  const encoded=ctx.esc2(input),decoded=encoded.replace(/&(amp|quot|lt|gt|#39);/g,(_,x)=>({amp:'&',quot:'"',lt:'<',gt:'>', '#39':"'"}[x]));
  const sink={received:null};vm.createContext(sink);vm.runInContext("received='"+decoded+"'",sink);assert.equal(sink.received,input);assert.equal(sink.bad,undefined);
 }
});
test('collection cache does not return inherited prototype values',()=>{const data=require('../lib/data');const st=data.loaded({slug:'constructor',data:'nonexistent',supply:0});assert.equal(st.cfg.slug,'constructor');assert.equal(typeof st,'object');});
function req(url,{method='GET',headers={},body}={}) {const r=new EventEmitter();Object.assign(r,{url,method,headers,socket:{remoteAddress:'127.0.0.1'}});queueMicrotask(()=>{if(body!==undefined)r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end');});return r;}
function res(){return {status:0,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},writeHead(n,h){this.status=n;Object.assign(this.headers,h);},end(b){this.body=b;}};}
function handlerWithCounter(){let calls=0;const cfg={slug:'test',chain:'ethereum',contract:'0x'+'1'.repeat(40)};const handler=load('api/index.js',{'../lib/registry':{load:()=>cfg,all:()=>[]},'../lib/data':{loaded:()=>({ALL:{}}),buildCompletion:()=>({}),currentMarket:()=>[],currentAsOf:()=>''},'../lib/holdings':{walletNfts:async()=>{calls++;return[];},walletIds:async()=>[]},'../lib/siwe':{readSession:async()=>null,configured:()=>false},'../lib/access':{isDonor:()=>false}});return {handler,calls:()=>calls};}
test('duplicate wallet addresses make one upstream lookup',async()=>{const h=handlerWithCounter(),r=res(),address='0x'+'a'.repeat(40);await h.handler(req('/api/holdings?slug=test&wallets='+Array(6).fill(address).join(',')),r);assert.equal(h.calls(),1);assert.equal(r.status,200);});
test('over-limit wallet lists are rejected before upstream calls',async()=>{const h=handlerWithCounter(),r=res(),addresses=Array.from({length:7},(_,i)=>'0x'+String(i+1).padStart(40,'0'));await h.handler(req('/api/holdings?slug=test&wallets='+addresses.join(',')),r);assert.equal(h.calls(),0);assert.equal(r.status,400);});
test('oversized wallet query is rejected before upstream calls',async()=>{const h=handlerWithCounter(),r=res();await h.handler(req('/api/holdings?slug=test&wallets='+('0x'+'a'.repeat(40)+',').repeat(75)),r);assert.equal(h.calls(),0);assert.equal(r.status,400);});
test('malformed encoded paths return 400 rather than crashing',async()=>{const h=handlerWithCounter(),r=res();await h.handler(req('/c/%zz'),r);assert.equal(r.status,400);});
test('identical in-flight holdings are coalesced',async()=>{let n=0,release;const p=new Promise(r=>release=r);const h=load('lib/holdings.js',{'./alchemy':{hasKey:()=>false},'./opensea':{fetchWalletNfts:async()=>{n++;return p;}}});const a=h.walletNfts({slug:'test'},'0x'+'a'.repeat(40)),b=h.walletNfts({slug:'test'},'0x'+'a'.repeat(40));assert.equal(a,b);assert.equal(n,1);release([]);await a;await h.walletNfts({slug:'test'},'0x'+'a'.repeat(40));assert.equal(n,1);});
test('workflow inputs are passed as environment data, never inserted into shell',()=>{const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/refresh-data.yml'),'utf8');assert.doesNotMatch(workflow,/slug='\$\{\{/);assert.match(workflow,/case "\$BAKE_SLUG" in gorgez\|ogtcertification/);assert.match(workflow,/npm ci --ignore-scripts/);});

const originalEnv={...process.env},originalFetch=global.fetch;
process.env.SESSION_SECRET='f3ab7c9926da4680b89cc406bce7c62145a96de0fc9212772836926f40aa75de';
process.env.APP_ORIGIN='https://portal.test';process.env.KV_REST_API_URL='https://storage.invalid';process.env.KV_REST_API_TOKEN='synthetic-only';
const storage=new Map();
global.fetch=async(url,options)=>{const [cmd,key,value,...extra]=JSON.parse(options.body);let result=null;
 if(cmd==='SET'){if(extra.includes('NX')&&storage.has(key))result=null;else if(extra.includes('XX')&&!storage.has(key))result=null;else{storage.set(key,value);result='OK';}}
 if(cmd==='GET')result=storage.get(key)||null;
 if(cmd==='GETDEL'){result=storage.get(key)||null;storage.delete(key);}
 if(cmd==='DEL'){result=storage.delete(key)?1:0;}
 return new Response(JSON.stringify({result}));};
const auth=require('../lib/siwe');
test.after(()=>{global.fetch=originalFetch;for(const key of ['SESSION_SECRET','APP_ORIGIN','KV_REST_API_URL','KV_REST_API_TOKEN']){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});
test('missing or blank session secret fails closed',()=>{const saved=process.env.SESSION_SECRET;for(const value of ['', '   ','dev-insecure-secret-change-me','short']){process.env.SESSION_SECRET=value;assert.equal(auth.configured(),false);assert.throws(()=>auth.makeToken({kind:'session'}));assert.equal(auth.readToken('abc.def'),null);}process.env.SESSION_SECRET=saved;});
test('origin, host, method and content type are required for mutations',()=>{const good={method:'POST',headers:{origin:'https://portal.test',host:'portal.test','content-type':'application/json'}};assert.equal(auth.requestAllowed(good,'POST',true),true);for(const bad of [{...good,method:'GET'},{...good,headers:{...good.headers,origin:'https://evil.test'}},{...good,headers:{...good.headers,host:'evil.test'}},{...good,headers:{...good.headers,'content-type':'text/plain'}}])assert.equal(auth.requestAllowed(bad,'POST',true),false);});
test('originless and incomplete SIWE text is rejected',()=>{assert.equal(auth.parseMessage('Hello\n0x'+'1'.repeat(40)+'\nNonce: abc'),null);});
test('real synthetic signature verifies exactly once across concurrent requests',async()=>{const w=Wallet.createRandom(),c=await auth.createChallenge(w.address),sig=await w.signMessage(c.message);const results=await Promise.all([auth.verifyChallenge(c.cookie,c.message,sig),auth.verifyChallenge(c.cookie,c.message,sig)]);assert.equal(results.filter(Boolean).length,1);assert.equal(results.find(Boolean),w.address.toLowerCase());assert.equal(await auth.verifyChallenge(c.cookie,c.message,sig),null);});
test('changed chain, origin, statement, nonce or signature cannot consume a challenge',async()=>{const w=Wallet.createRandom(),c=await auth.createChallenge(w.address);for(const m of [c.message.replace('Chain ID: 1','Chain ID: 2'),c.message.replace('https://portal.test','https://evil.test'),c.message.replace('Sign in to OGT Portal.','Sign away everything.'),c.message.replace(c.nonce,'a'.repeat(48))])assert.equal(await auth.verifyChallenge(c.cookie,m,await w.signMessage(m)),null);assert.equal(await auth.verifyChallenge(c.cookie,c.message,'0x00'),null);assert.equal(await auth.verifyChallenge(c.cookie,c.message,await w.signMessage(c.message)),w.address.toLowerCase());});
test('challenge is bound to its browser cookie',async()=>{const w=Wallet.createRandom(),a=await auth.createChallenge(w.address),b=await auth.createChallenge(w.address);assert.equal(await auth.verifyChallenge(b.cookie,a.message,await w.signMessage(a.message)),null);});
test('session logout revokes copied cookie and linked updates cannot resurrect it',async()=>{const addr='0x'+'2'.repeat(40),token=await auth.createSession(addr,'a'.repeat(48),new Date(Date.now()+300000).toISOString()),session=await auth.readSession(token);assert.equal(session.addr,addr);assert.equal(await auth.updateLinked(session,['0x'+'3'.repeat(40)]),true);assert.equal((await auth.readSession(token)).linked.length,1);await auth.logout(token);assert.equal(await auth.readSession(token),null);assert.equal(await auth.updateLinked(session,[]),false);});
test('legacy stateless cookie payloads are not accepted as current sessions',async()=>{const token=auth.makeToken({addr:'0x'+'1'.repeat(40)});assert.equal(await auth.readSession(token),null);});
test('durable store failure fails closed',async()=>{const saved=global.fetch;global.fetch=async()=>{throw new Error('offline');};await assert.rejects(auth.createChallenge('0x'+'1'.repeat(40)));global.fetch=saved;});
test('removed vulnerable optional branch is absent from final lock',()=>{const lock=require('../package-lock.json');for(const name of ['axios','follow-redirects','zod','@reown/appkit','@coinbase/cdp-sdk'])assert.equal(Object.keys(lock.packages).some(p=>p.endsWith('/'+name)),false,name);});
test('HTTP sign-in routes reject GET and cross-origin mutations before creating challenges',async()=>{
 const handler=require('../api/index');
 for(const r of [req('/api/siwe/nonce'),req('/api/siwe/nonce',{method:'POST',headers:{origin:'https://evil.test',host:'portal.test','content-type':'application/json'},body:{address:'0x'+'1'.repeat(40)}})]){const response=res();await handler(r,response);assert.equal(response.status,403);}
});
test('HTTP challenge is server-generated with secure, HttpOnly, short-lived cookie',async()=>{
 const handler=require('../api/index'),response=res();await handler(req('/api/siwe/nonce',{method:'POST',headers:{origin:'https://portal.test',host:'portal.test','content-type':'application/json'},body:{address:'0x'+'1'.repeat(40)}}),response);
 assert.equal(response.status,200);assert.match(response.headers['Set-Cookie'],/HttpOnly/);assert.match(response.headers['Set-Cookie'],/; Secure/);assert.match(response.headers['Set-Cookie'],/Max-Age=300/);assert.equal(response.headers['Cache-Control'],'no-store');assert.ok(JSON.parse(response.body).message.startsWith('portal.test wants'));
});
test('curated dashboards still compile after safe branding changes',()=>{
 const registry=require('../lib/registry'),data=require('../lib/data'),build=require('../lib/build');
 for(const cfg of registry.all()){
  const html=build.buildDashboardHTML(data.loaded(cfg),[],{walletLabel:'Browse'});
  assert.ok(html.includes(esc(cfg.branding?.name || cfg.name)));
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 }
});

test('spoofed forwarded IPs do not evade weighted wallet request limits',async()=>{const h=handlerWithCounter();let blocked=0;for(let i=0;i<25;i++){const response=res();await h.handler(req('/api/holdings?slug=test&wallets=0x'+'a'.repeat(40),{headers:{'x-forwarded-for':'203.0.113.'+i}}),response);if(response.status===429)blocked++;}assert.ok(blocked>0);assert.ok(h.calls()<=20);});
test('provider error responses expose status only and wallet pagination never retries indefinitely',async()=>{let requests=0;const fakeHttps={get(options,callback){requests++;const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=429;callback(response);response.emit('data',Buffer.from('private provider response'));response.emit('end');});return request;}};const api=load('lib/opensea.js',{https:fakeHttps});await assert.rejects(api.collectionMeta('test'),error=>error.message==='Provider HTTP 429');await assert.rejects(api.fetchWalletNfts('0x'+'a'.repeat(40),'test','ethereum'),/provider unavailable/);assert.equal(requests,2);});
test('oversized provider responses fail before JSON parsing',async()=>{const fakeHttps={get(options,callback){const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;response.destroy=error=>response.emit('error',error);callback(response);response.emit('data',Buffer.alloc(4*1024*1024+1));});return request;}};const api=load('lib/opensea.js',{https:fakeHttps});await assert.rejects(api.collectionMeta('test'),/response failed/);});
test('landing page inline scripts compile after safe metadata rendering changes',async()=>{const handler=require('../api/index'),response=res();await handler(req('/'),response);assert.equal(response.status,200);for(const m of response.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});

test('wallet bundle URLs use the current hash and vendor responses require revalidation',async()=>{
 const {createHash}=require('node:crypto');const hash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public/vendor/wc-ethereum-provider.bundle.js'))).digest('hex');
 for(const file of ['public/app.html','public/landing.html']){const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8');const urls=[...text.matchAll(/\/vendor\/wc-ethereum-provider\.bundle\.js(?:\?v=[a-f0-9]+)?/g)].map(x=>x[0]);assert.ok(urls.length);assert.ok(urls.every(x=>x.endsWith('?v='+hash)));}
 const handler=require('../api/index');for(const suffix of ['', '?v='+hash]){const response=res();await handler(req('/vendor/wc-ethereum-provider.bundle.js'+suffix),response);assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'public, max-age=0, must-revalidate');}
});
test('auth storage response is capped while streaming and cancels an oversized body',async()=>{
 const saved=global.fetch;let pulls=0,cancelled=false;
 global.fetch=async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(10000));},cancel(){cancelled=true;}},{highWaterMark:0}));
 try{await assert.rejects(auth.createChallenge('0x'+'1'.repeat(40)),/Invalid sign-in storage response/);assert.equal(pulls,2);assert.equal(cancelled,true);}finally{global.fetch=saved;}
});

test('canceled challenges cannot verify or create sessions; a late session cookie is inert',async()=>{
 const w=Wallet.createRandom(),a=await auth.createChallenge(w.address);
 assert.equal(await auth.cancelChallenge(a.cancelToken),true);
 assert.equal(await auth.verifyChallenge(a.cookie,a.message,await w.signMessage(a.message)),null);
 await assert.rejects(auth.createSession(w.address,a.nonce,a.expires),/cancelled/);
 const b=await auth.createChallenge(w.address),token=await auth.createSession(w.address,b.nonce,b.expires);
 assert.ok(await auth.readSession(token));assert.equal(await auth.cancelChallenge(b.cancelToken),true);assert.equal(await auth.readSession(token),null);
 assert.equal(await auth.cancelChallenge(b.cancelToken+'x'),false);
});
test('cancellation racing session persistence prevents issuing a usable session',async()=>{
 const c=await auth.createChallenge('0x'+'4'.repeat(40)),saved=global.fetch;let release,reached;
 const wait=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
 global.fetch=async(url,options)=>{const args=JSON.parse(options.body);if(args[0]==='SET'&&args[1].includes(':session:')){reached();await gate;}return saved(url,options);};
 try{const pending=auth.createSession('0x'+'4'.repeat(40),c.nonce,c.expires);await wait;await auth.cancelChallenge(c.cancelToken);release();await assert.rejects(pending,/cancelled/);}finally{global.fetch=saved;}
});
test('logout cancels an already-verified pending challenge before session issuance',async()=>{
 const w=Wallet.createRandom(),c=await auth.createChallenge(w.address);assert.equal(await auth.verifyChallenge(c.cookie,c.message,await w.signMessage(c.message)),w.address.toLowerCase());
 const handler=require('../api/index'),response=res();await handler(req('/api/siwe/logout',{method:'POST',headers:{origin:'https://portal.test',host:'portal.test',cookie:'siwe_nonce='+encodeURIComponent(c.cookie)}}),response);
 assert.equal(response.status,200);await assert.rejects(auth.createSession(w.address,c.nonce,c.expires),/cancelled/);
});

test('session issuance rejects a challenge that expires while storage is pending',async()=>{
 const c=await auth.createChallenge('0x'+'5'.repeat(40)),saved=global.fetch,savedNow=Date.now;let release,reached;const start=savedNow();
 const wait=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
 global.fetch=async(url,options)=>{const args=JSON.parse(options.body);if(args[0]==='SET'&&args[1].includes(':session:')){reached();await gate;}return saved(url,options);};
 try{const pending=auth.createSession('0x'+'5'.repeat(40),c.nonce,new Date(start+1000).toISOString());await wait;Date.now=()=>start+2000;release();await assert.rejects(pending,/expired/);}finally{Date.now=savedNow;global.fetch=saved;}
 await assert.rejects(auth.createSession('0x'+'5'.repeat(40),c.nonce,new Date(start-1).toISOString()),/expired/);
});

test('authentic expired cancel-only tokens complete cleanup after all possible sessions expire',async()=>{
 const c=await auth.createChallenge('0x'+'6'.repeat(40)),savedNow=Date.now,start=savedNow();
 try{Date.now=()=>start+(300+auth.SESSION_TTL+2)*1000;assert.equal(auth.readToken(c.cancelToken),null);assert.equal(await auth.cancelChallenge(c.cookie),false);assert.equal(await auth.cancelChallenge(c.cancelToken),true);assert.equal(await auth.cancelChallenge(c.cancelToken+'x'),false);
 const handler=require('../api/index'),response=res();await handler(req('/api/siwe/cancel',{method:'POST',headers:{origin:'https://portal.test',host:'portal.test','content-type':'application/json'},body:{cancelToken:c.cancelToken}}),response);assert.equal(response.status,200);
 }finally{Date.now=savedNow;}
});
