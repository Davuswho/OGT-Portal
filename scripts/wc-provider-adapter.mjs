import UniversalProvider from '@walletconnect/universal-provider';

// Application-owned Ethereum bridge over the official UniversalProvider.
// Custom QR only: no AppKit, embedded accounts, Coinbase CDP or their dependency tree.
export class EthereumProvider {
  static async init(options) {
    if (!options || options.showQrModal !== false) throw new Error('Only the application QR chooser is supported.');
    const signer = await UniversalProvider.init({
      projectId: options.projectId, metadata: options.metadata, logger: options.logger || 'silent',
      customStoragePrefix: options.customStoragePrefix || 'ogt-public-address-v2', telemetryEnabled: false,
      ...(options.relayUrl ? {relayUrl: options.relayUrl} : {})
    });
    return new EthereumProvider(signer, options);
  }
  constructor(signer, options) {
    this.signer=signer;this.options=options;this.listeners=new Map();this.handlers=[];
    this.chainId=Number(options.chains?.[0] || 1);this.attempt=0;this.closed=false;this.pairingTopic=null;this.bind();
  }
  bind() {
    if(this.handlers.length)return;
    for(const event of ['display_uri','connect','disconnect','session_update','session_delete','accountsChanged','chainChanged']) {
      const callback=value=>{
        if(event==='display_uri') {
          const match=typeof value==='string'&&value.match(/^wc:([a-f0-9]{64})@2\?/i);
          if(!match || value.length>4096)return;
          this.pairingTopic=match[1];
          if(this.closed){void this.cleanPairing();return;}
        }
        if(event==='chainChanged')this.chainId=Number(String(value).split(':').pop());
        if(event==='accountsChanged')value=(value || []).map(a=>String(a).split(':').pop());
        this.emit(event,value);
      };
      this.signer.on(event,callback);this.handlers.push([event,callback]);
    }
  }
  unbind(){for(const [event,callback]of this.handlers)this.signer.removeListener(event,callback);this.handlers=[];}
  async cleanPairing(){const topic=this.pairingTopic;this.pairingTopic=null;if(topic)try{await this.signer.client.core.pairing.disconnect({topic});}catch(_){};}
  get session(){return this.signer.session;}
  get accounts(){return [...new Set(Object.values(this.session?.namespaces || {}).flatMap(ns=>ns.accounts || []).filter(a=>a.startsWith('eip155:'+this.chainId+':')).map(a=>a.split(':').pop()))];}
  on(event,callback){if(!this.listeners.has(event))this.listeners.set(event,new Set());this.listeners.get(event).add(callback);return this;}
  removeListener(event,callback){this.listeners.get(event)?.delete(callback);return this;}
  off(event,callback){return this.removeListener(event,callback);}
  emit(event,value){for(const callback of this.listeners.get(event) || []){try{callback(value);}catch(_){}}}
  async connect(){
    const attempt=++this.attempt;this.closed=false;this.bind();
    const o=this.options;
    const namespaces={eip155:{chains:(o.chains || [1]).map(c=>'eip155:'+c),methods:o.methods || ['eth_accounts'],events:o.events || ['accountsChanged','chainChanged']}};
    const optionalNamespaces={};
    if((o.optionalChains || []).length || (o.optionalMethods || []).length || (o.optionalEvents || []).length){optionalNamespaces.eip155={chains:(o.optionalChains || []).map(c=>'eip155:'+c),methods:o.optionalMethods || [],events:o.optionalEvents || []};}
    try {
      const session=await this.signer.connect({namespaces,optionalNamespaces});
      if(this.closed || attempt!==this.attempt){try{if(this.session)await this.signer.disconnect();}catch(_){}await this.cleanPairing();throw Object.assign(new Error('Wallet connection cancelled.'),{code:4001});}
      return session;
    }catch(error){if(attempt===this.attempt){this.unbind();await this.cleanPairing();}throw error;}
  }
  async disconnect(){this.closed=true;this.attempt++;try{if(this.session)await this.signer.disconnect();}finally{await this.cleanPairing();this.unbind();}}
  async request(payload){
    if(payload.method==='eth_accounts')return this.closed?[]:this.accounts;
    if(payload.method==='eth_chainId')return '0x'+this.chainId.toString(16);
    if(this.closed || !this.session)throw Object.assign(new Error('Wallet is disconnected.'),{code:4900});
    return this.signer.request(payload,'eip155:'+this.chainId);
  }
}