 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const app=fs.readFileSync(require('node:path').join(__dirname,'../public/app.html'),'utf8');
const landing=fs.readFileSync(require('node:path').join(__dirname,'../public/landing.html'),'utf8');
const address='0x'+'1'.repeat(40);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<50;i++){if(check())return;await new Promise(r=>setImmediate(r));}throw new Error('Expected operation did not start');}
function signInHarness({deferVerify=false,pendingStoredToken=null}={}){
 const signature=deferred(),verify=deferred(),provider=new EventEmitter(),calls=[],requests=[],events={},store=new Map();
 if(pendingStoredToken)store.set('ogt_pending_signin',pendingStoredToken);
 let account=address,chain='0x1';provider.request=async({method})=>{requests.push(method);if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];if(method==='eth_chainId')return chain;if(method==='personal_sign')return signature.promise;throw new Error('Unexpected method');};
 const context={Promise,console,BRAND:{slug:'gorgez'},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},window:{ethereum:provider,addEventListener:(n,cb)=>events[n]=cb},document:{getElementById:()=>({classList:{remove(){}}})},location:{href:''},alert(){},fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/nonce'))return {ok:true,json:async()=>({message:'synthetic challenge',cancelToken:'cancel-only-test-token'})};if(url.endsWith('/verify')){if(deferVerify)await verify.promise;return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>({ok:true})};}};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('var _siweEpoch='),app.indexOf('async function openWalletMgr(){')),context);
 return {context,provider,calls,requests,signature,verify,events,setAccount:v=>account=v,setChain:v=>chain=v};
}
for(const action of ['close','accountsChanged','chainChanged','disconnect','pagehide'])test('pending signature is ignored after '+action,async()=>{
 const h=signInHarness(),pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));
 if(action==='close')h.context.closeWalletMgr();else if(action==='pagehide')h.events.pagehide();else h.provider.emit(action,[]);
 h.signature.resolve('synthetic signature');await pending;
 assert.equal(h.calls.filter(x=>x.url.endsWith('/verify')).length,0);assert.equal(h.context.location.href,'');assert.ok(h.calls.some(x=>x.url.endsWith('/cancel')));assert.equal(h.provider.listenerCount('accountsChanged'),0);
});
for(const change of ['account','chain','provider'])test('silent '+change+' change after signing is rejected before verify',async()=>{
 const h=signInHarness(),pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));
 if(change==='account')h.setAccount('0x'+'2'.repeat(40));else if(change==='chain')h.setChain('0x2');else h.context.window.ethereum={request(){throw new Error('Must not use replacement');}};
 h.signature.resolve('synthetic signature');await pending;assert.equal(h.calls.filter(x=>x.url.endsWith('/verify')).length,0);assert.equal(h.context.location.href,'');
});
test('late verify response after closing is canceled and cannot redirect',async()=>{
 const h=signInHarness({deferVerify:true}),pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));h.signature.resolve('synthetic signature');await until(()=>h.calls.some(x=>x.url.endsWith('/verify')));h.context.closeWalletMgr();h.verify.resolve();await pending;assert.equal(h.context.location.href,'');assert.ok(h.calls.some(x=>x.url.endsWith('/cancel')));
});
test('explicit selected provider is used even when global ethereum differs',async()=>{
 const h=signInHarness();h.context._siweSelectedProvider=h.provider;h.context.window.ethereum={request(){throw new Error('Wrong wallet');}};
 const pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));h.signature.resolve('synthetic signature');await pending;assert.equal(h.context.location.href,'/c/gorgez');
});
test('sign-out during pending signature cancels before logout and cannot later verify',async()=>{
 const h=signInHarness(),pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));await h.context.siweLogout();h.signature.resolve('synthetic signature');await pending;assert.equal(h.calls.filter(x=>x.url.endsWith('/verify')).length,0);assert.ok(h.calls.findIndex(x=>x.url.endsWith('/cancel'))<h.calls.findIndex(x=>x.url.endsWith('/logout')));
});
for(const surface of ['header','landing'])for(const stage of ['permissions','accounts'])test(surface+' injected '+stage+' response is ignored after close',async()=>{
 const permission=deferred(),accounts=deferred(),methods=[];const provider={request:({method})=>{methods.push(method);return method==='wallet_requestPermissions'?permission.promise:accounts.promise;}};
 const context={Promise,console,_wcEpoch:0,_wcP:null,_eip:[],_siweSelectedProvider:null,cancelPrivateSignIn(){return Promise.resolve(true);},document:{getElementById:()=>({style:{},classList:{remove(){}}})},hdrGo(){context.navigations++;},navigations:0,injectedAttempt:0,cancelWalletConnect(){},connected:null,selectedProvider:null,eipProviders:[],isAddr:v=>/^0x[0-9a-fA-F]{40}$/.test(v||''),showConnected(){context.navigations++;},sessionStorage:{setItem(){}}};
 vm.createContext(context);
 if(surface==='header')vm.runInContext(app.slice(app.indexOf('function closeHdrPicker(){'),app.indexOf('function hdrGo(addr)')),context);
 else vm.runInContext(landing.slice(landing.indexOf('function closeWalletPicker(){'),landing.indexOf('function disconnectWallet(){')),context);
 const pending=surface==='header'?context.hdrDoConnect(provider):context.doConnect(provider);
 if(stage==='accounts'){permission.resolve();await until(()=>methods.includes('eth_requestAccounts'));}
 if(surface==='header')context.closeHdrPicker();else context.closeWalletPicker();
 permission.resolve();accounts.resolve([address]);await pending;assert.equal(context.navigations,0);if(stage==='permissions')assert.equal(methods.includes('eth_requestAccounts'),false);
});

test('immediate close before initial cancellation await prevents wallet prompt',async()=>{const h=signInHarness(),pending=h.context.siweSignIn();h.context.closeWalletMgr();await pending;assert.equal(h.requests.length,0);assert.equal(h.context.location.href,'');});

test('successful cleanup of an expired pending token clears it and permits a new sign-in',async()=>{
 const h=signInHarness({pendingStoredToken:'authentic-expired-cancel-token'});await h.context._siweCancelWait;assert.equal(h.context.sessionStorage.getItem('ogt_pending_signin'),null);
 const pending=h.context.siweSignIn();await until(()=>h.requests.includes('personal_sign'));h.context.closeWalletMgr();h.signature.resolve('synthetic signature');await pending;assert.equal(h.context.location.href,'');
});
