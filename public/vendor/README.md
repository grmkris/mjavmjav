Bundled, unchanged browser scripts; no CDN or runtime fetches:

- `qrcode.js`: qrcode-generator 2.0.4, Kazuhiko Arase, MIT.
  Source: https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz (`dist/qrcode.js`).
  The source header supplies the copyright and MIT license link; full terms are in `qrcode-LICENSE`.
- `jsQR.js`: jsqr 1.4.0, Cosmo Wolfe, Apache-2.0.
  Source: https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz (`dist/jsQR.js`).
  Original license in `jsQR-LICENSE`.

The QR generator draws the two local pairing codes. jsQR decodes camera frames
on browsers without BarcodeDetector, including Safari. Neither library receives
camera frames or pairing data over a network.
