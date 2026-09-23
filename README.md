# Jumpseller Delivery Estimate

Product-page widget for Jumpseller 4.x themes that tells the shopper what shipping will cost and when it arrives:
"Este producto llega por $X mañana".

- Combines a store-defined flat rate (by destination and cart weight) with live courier quotes.
- Uses the cart weight plus the current product, so the price matches checkout.
- Remembers the shopper's comuna in `localStorage`.
- Configurable from theme options; off by default.

## Status

Implemented and verified on a test store. Install instructions: [theme-kit/INSTALL.md](theme-kit/INSTALL.md).

## Development

```bash
npm test            # unit tests (node --test)
npm run build       # bundle src/*.js into theme-kit/assets/eta-widget.js
npm run build:comunas -- <path-to>/_data/shipping_municipalities.yml   # regenerate src/eta-comunas.js
```
