// Entry point for bundling @walletconnect/ethereum-provider into one self-contained browser
// file (see scripts/bundle-walletconnect.js). Not shipped as-is — esbuild inlines this + every
// dependency (viem, lit, qrcode, etc.) into public/vendor/wc-ethereum-provider.bundle.js.
import { EthereumProvider } from '@walletconnect/ethereum-provider';
window.WCEthereumProvider = EthereumProvider;
