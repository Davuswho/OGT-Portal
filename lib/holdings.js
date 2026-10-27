'use strict';
const alchemy = require('./alchemy');
const opensea = require('./opensea');
const cache = new Map();
const MAX_KEYS = 256, TTL_MS = 20000;
async function loadWallet(cfg,addr) {
  const chain=cfg.chain || 'ethereum';
  if(alchemy.hasKey() && cfg.contract && alchemy.supportsChain(chain)) {
    try{return await alchemy.fetchWalletNfts(addr,cfg.contract,chain);}catch(_){}
  }
  return opensea.fetchWalletNfts(addr,cfg.slug,chain);
}
// Per-instance coalescing is a load reduction, not a cross-instance rate-limit claim.
function walletNfts(cfg,addr) {
  if(!/^0x[0-9a-f]{40}$/i.test(addr)) return Promise.reject(new Error('Invalid wallet.'));
  const key=[cfg.chain||'ethereum',cfg.contract||cfg.slug,addr.toLowerCase()].join(':');
  const old=cache.get(key), now=Date.now();
  if(old && (old.pending || old.expires>now)) return old.promise;
  if(cache.size>=MAX_KEYS) {
    for(const [k,v] of cache) if(!v.pending) { cache.delete(k); break; }
    if(cache.size>=MAX_KEYS) return Promise.reject(new Error('Wallet lookup is busy. Please retry.'));
  }
  const entry={pending:true,expires:0,promise:null};
  entry.promise=loadWallet(cfg,addr).then(items=>{entry.pending=false;entry.expires=Date.now()+TTL_MS;return items;},error=>{cache.delete(key);throw error;});
  cache.set(key,entry); return entry.promise;
}
async function walletIds(cfg,addr){return (await walletNfts(cfg,addr)).map(n=>n.id);}
module.exports={walletNfts,walletIds};