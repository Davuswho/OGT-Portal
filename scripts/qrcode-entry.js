// Entry point for bundling the `qrcode` package into a self-contained browser file (see
// scripts/wc-entry.js for why — same esbuild approach). Renders the WalletConnect pairing URI
// as a scannable QR code.
import QRCode from 'qrcode';
window.QRCodeLib = QRCode;
