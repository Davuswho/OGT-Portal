import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Reviewed local correction to @walletconnect/utils 2.26.0. This selects the
// Telegram deep-link encoding; it is not a general wallet destination allowlist.
export function isTelegramHttpsLink(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && url.hostname==='t.me' && url.port==='' && !url.username && !url.password;
  } catch (_) { return false; }
}
export const WALLET_UTILS_INPUT_SHA256='8b4eec93c82950de354831907ed898ec678a79d1917387361f6a27ef0c10011b';
const sha256=text=>createHash('sha256').update(text).digest('hex');
export function patchWalletUtilsSource(source) {
  if(sha256(source)!==WALLET_UTILS_INPUT_SHA256)throw new Error('WalletConnect utils source changed: review the URL patch before rebuilding.');
  const needle='e.startsWith("https://t.me")';
  if(source.split(needle).length!==2)throw new Error('Expected exactly one Telegram URL-prefix check.');
  const helper=isTelegramHttpsLink.toString().replace('function isTelegramHttpsLink','function __ogtIsTelegramHttpsLink');
  const contents=helper+'\n'+source.replace(needle,'__ogtIsTelegramHttpsLink(e)');
  return {contents,inputSha256:sha256(source),patchedSourceSha256:sha256(contents)};
}
export function walletVendorSecurityPlugin(records) {
  return {name:'reviewed-wallet-url-patch',setup(build){
    build.onLoad({filter:/[\\/]@walletconnect[\\/]utils[\\/]dist[\\/]index\.js$/},async(args)=>{
      const patch=patchWalletUtilsSource(await readFile(args.path,'utf8'));
      records.push({id:'wallet-utils-telegram-origin-2026-10-27',package:'@walletconnect/utils@2.26.0',input:'dist/index.js',inputSha256:patch.inputSha256,patchedSourceSha256:patch.patchedSourceSha256});
      return {contents:patch.contents,loader:'js'};
    });
  }};
}
