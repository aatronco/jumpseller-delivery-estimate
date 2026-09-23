# Delivery Estimate Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Jumpseller 4.x theme add-on that shows "Llega hoy por $2.000" on the product page and lets shoppers pick their comuna from the top bar.

**Architecture:** Plain browser JS split into small UMD modules (`src/*.js`) that run both in Node (unit tests) and in the browser (concatenated by `scripts/build.mjs` into `theme-kit/assets/eta-widget.js`). Business rules are pure functions that receive the current date and config as arguments. Theme integration is a kit of partials + an options group, inserted into an exported theme with one-line edits.

**Tech Stack:** Vanilla ES2020 JS, Node 22 `node:test`, `jsdom` (dev only, UI tests), Liquid (Jumpseller themes), `jumpseller` CLI (theme export/watch).

**Spec:** `docs/spec.md` — read it before starting any task.

## Global Constraints

- **Never write the merchant's name anywhere in this repo** (code, comments, commits, file names). Say "the merchant". A pre-commit hook enforces it; never bypass it with `--no-verify`.
- Never commit credentials. `theme/` (the exported theme) is gitignored and must stay that way.
- Timezone for all day logic: `America/Santiago`, via `Intl.DateTimeFormat`. Never use the device timezone.
- Quote API: `POST https://api.jumpseller.com/landing/estimate_rates.json`. Region codes come from the generated comunas data (Metropolitana `12`, Araucanía `04`); a wrong code returns `[]` silently.
- Only home-delivery courier services (allowlist `company:code`) count toward the price. Agency/branch pickup never does.
- Weight = cart weight + current variant weight, current variant not counted twice if already in cart.
- Price = min(flat rate if applicable, allowlisted courier quotes). On a tie the flat rate wins (so the day promise shows). Day promise only when the flat rate wins.
- Every `localStorage` access inside `try/catch`, with in-memory fallback.
- No runtime dependencies. `jsdom` is a devDependency only.
- UI copy is Spanish (Chile). Code, comments, and commits are English.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Geolocation returns a name that is not a comuna** (e.g. Nominatim gives `city: "Santiago"` for a Providencia address, or a region name). Expected: pick the most specific address field that matches a known comuna; if none matches, return `null` and keep the selector open. → test in Task 6.
2. **Comuna changes while a slow quote (1–7 s) is still in flight.** Expected: the older response never overwrites the newer comuna's price. → test in Task 7.
3. **Current product is in the cart as a *different* variant.** Expected: the current variant's weight is still added; only the exact same product+variant is skipped. → test in Task 2.
4. **Flat rate and cheapest courier quote are equal.** Expected: the flat rate wins and the day promise is shown. → test in Task 2.
5. **Merchant types options with commas instead of new lines, extra spaces, `2.000` with a thousands dot, or a comuna without accents.** Expected: parsed the same as the canonical form. → tests in Task 2.

---

## File Structure

```
package.json                     scripts: test, build, build:comunas; devDependency jsdom
scripts/build-comunas.mjs        landing YAML → src/eta-comunas.js (generated, committed)
scripts/build.mjs                concatenates src/*.js → theme-kit/assets/eta-widget.js
src/eta-comunas.js               Eta.Comunas: [{id, name, region}] for Chile
src/eta-rules.js                 Eta.Rules: pure business rules (no DOM, no network, no clock)
src/eta-store.js                 Eta.Store: saved comuna (localStorage + event)
src/eta-data.js                  Eta.Data: cart/product weight + courier quotes + quote cache
src/eta-ui.js                    Eta.UI: widget states, selector panel, geolocation → comuna
src/eta-boot.js                  Eta.Boot: reads #eta-config, wires everything, update loop
test/*.test.mjs                  node:test suites, one per module
theme-kit/assets/eta-widget.js   built bundle (committed, uploaded to the theme)
theme-kit/assets/eta-widget.css
theme-kit/partials/eta_config.liquid     config div + shared selector panel (rendered in layout)
theme-kit/partials/eta_selector.liquid   top-bar trigger button
theme-kit/partials/eta_widget.liquid     product-page mount point
theme-kit/config/options-group.json      "Envío estimado" theme options group
theme-kit/INSTALL.md             exact insertion points for a 4.x theme
```

Every `src/*.js` file uses the same UMD wrapper so it works under `require()` in tests and as a plain `<script>` in the browser (attaching to `self.Eta`):

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.NAME = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // ...
  return { /* public API */ };
});
```

Tests load modules with:

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Rules = require('../src/eta-rules.js');
```

---

### Task 1: Tooling and comunas data

**Files:**
- Create: `package.json`, `scripts/build-comunas.mjs`, `src/eta-comunas.js` (generated), `test/comunas.test.mjs`

**Interfaces:**
- Produces: `Eta.Comunas` — `Array<{ id: string, name: string, region: string }>`, sorted by `name` (locale `es`). `id` is the Jumpseller municipality id (e.g. `'8261414'`), `region` is the Jumpseller region code (e.g. `'12'`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "jumpseller-delivery-estimate",
  "version": "0.1.0",
  "private": true,
  "description": "Delivery price + ETA widget for Jumpseller product pages",
  "scripts": {
    "test": "node --test test/",
    "build": "node scripts/build.mjs",
    "build:comunas": "node scripts/build-comunas.mjs ../../landing/_data/shipping_municipalities.yml"
  },
  "devDependencies": {}
}
```

Run: `npm install --save-dev jsdom@24` (installs jsdom and fills `devDependencies`; `node_modules/` is already gitignored).

- [ ] **Step 2: Write the failing test** — `test/comunas.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Comunas = require('../src/eta-comunas.js');

test('contains all Chilean comunas with region codes', () => {
  assert.ok(Comunas.length >= 340, `only ${Comunas.length} comunas`);
  const byName = Object.fromEntries(Comunas.map(c => [c.name, c]));
  assert.deepEqual(byName['Providencia'], { id: '8261414', name: 'Providencia', region: '12' });
  assert.deepEqual(byName['Temuco'], { id: '8261311', name: 'Temuco', region: '04' });
  assert.equal(byName['Santiago'].id, '8261395');
});

test('every entry has string id, name and region', () => {
  for (const c of Comunas) {
    assert.match(c.id, /^\d+$/);
    assert.ok(c.name.length > 1);
    assert.match(c.region, /^\d{2}$/);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-comunas.js'`.

- [ ] **Step 4: Write `scripts/build-comunas.mjs`**

The source is the landing repo's `_data/shipping_municipalities.yml`. Its Chile block looks like:

```yaml
CL: # Chile
  '16': # Arica y Parinacota
    '8261387': Arica
```

```js
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: build-comunas.mjs <shipping_municipalities.yml>'); process.exit(1); }

const lines = readFileSync(src, 'utf8').split('\n');
const comunas = [];
let inChile = false;
let region = null;
for (const line of lines) {
  if (/^CL:/.test(line)) { inChile = true; continue; }
  if (inChile && /^[A-Z]{2}:/.test(line)) break;
  if (!inChile) continue;
  const r = line.match(/^  '(\d+)':/);
  if (r) { region = r[1]; continue; }
  const m = line.match(/^    '(\d+)':\s*(.+?)\s*$/);
  if (m && region) comunas.push({ id: m[1], name: m[2].replace(/^['"]|['"]$/g, ''), region });
}
comunas.sort((a, b) => a.name.localeCompare(b.name, 'es'));

const out = `// Generated by scripts/build-comunas.mjs — do not edit by hand.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Comunas = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return ${JSON.stringify(comunas)};
});
`;
writeFileSync(new URL('../src/eta-comunas.js', import.meta.url), out);
console.log(`wrote ${comunas.length} comunas`);
```

- [ ] **Step 5: Generate and run tests**

Run: `npm run build:comunas && npm test`
Expected: `wrote 3xx comunas`, then both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/build-comunas.mjs src/eta-comunas.js test/comunas.test.mjs
git commit -m "Add tooling and generated Chile comunas data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pricing rules (`Eta.Rules`, part 1)

**Files:**
- Create: `src/eta-rules.js`, `test/rules.test.mjs`

**Interfaces:**
- Consumes: `Eta.Comunas` shape from Task 1 (passed in as an argument, not imported).
- Produces (all pure):
  - `normalizeComuna(name: string): string` — lowercase, no accents, single spaces, trimmed.
  - `parseList(text: string): string[]` — split on newlines, commas or semicolons; trimmed; empty removed.
  - `parseTable(text: string, warn?: fn): Array<{maxKg: number, price: number}>` — sorted ascending; `*` → `Infinity`.
  - `resolveComunas(names: string[], comunas, warn?: fn): Array<{id, name, region}>` — unknown names warned and skipped.
  - `flatRate(comunaId: string, kg: number, cfg: {flatComunaIds: string[], flatTiers}): number|null`
  - `parseClp(text: string): number|null` — `"$4.470"` → `4470`.
  - `parseServices(text: string): string[]` — `'starken:20'` style keys, company lowercased.
  - `filterHomeDelivery(rates: ApiRate[], services: string[]): Array<{company, label, amount}>` — `ApiRate` = `{fulfillment_company, service_label, service_code, amount}`.
  - `pickPrice(flat: number|null, quotes: Array<{amount}>|null): {price: number|null, source: 'flat'|'courier'|null}`
  - `cartWeight(cart, productId, variantId): {kg: number, containsCurrent: boolean}` — `cart` is the `/api/cart.json` body (or `null`).
  - `variantWeight(product, variantId): number` — `product` is the `/api/products/:id.json` body.
  - `roundKg(kg: number): number` — ceil to 0.5, minimum 0.5.
  - `formatClp(n: number): string` — `2000` → `"$2.000"`.

- [ ] **Step 1: Write the failing tests** — `test/rules.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../src/eta-rules.js');

const COMUNAS = [
  { id: '8261414', name: 'Providencia', region: '12' },
  { id: '8261178', name: 'Ñuñoa', region: '12' },
  { id: '8261311', name: 'Temuco', region: '04' },
];

test('normalizeComuna strips accents, case and extra spaces', () => {
  assert.equal(R.normalizeComuna('  Ñuñoa '), 'nunoa');
  assert.equal(R.normalizeComuna('Pedro  Aguirre   Cerda'), 'pedro aguirre cerda');
});

test('parseList accepts newlines, commas and semicolons', () => {
  assert.deepEqual(R.parseList('a\nb, c;d\n\n'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(R.parseList(''), []);
  assert.deepEqual(R.parseList(undefined), []);
});

test('parseTable sorts tiers, supports * and thousands dots', () => {
  assert.deepEqual(R.parseTable('* = 4.000\n30 = 2000'), [
    { maxKg: 30, price: 2000 },
    { maxKg: Infinity, price: 4000 },
  ]);
  assert.deepEqual(R.parseTable('5=1500, 30 = 2000, *=4000').map(t => t.price), [1500, 2000, 4000]);
});

test('parseTable warns and skips invalid lines', () => {
  const warnings = [];
  assert.deepEqual(R.parseTable('hola\n30 = 2000', w => warnings.push(w)), [{ maxKg: 30, price: 2000 }]);
  assert.equal(warnings.length, 1);
});

test('resolveComunas matches without accents and warns on unknown names', () => {
  const warnings = [];
  const out = R.resolveComunas(['nunoa', 'PROVIDENCIA', 'Gotham'], COMUNAS, w => warnings.push(w));
  assert.deepEqual(out.map(c => c.id), ['8261178', '8261414']);
  assert.equal(warnings.length, 1);
});

test('flatRate applies tiers only to listed comunas, 30 kg boundary inclusive', () => {
  const cfg = { flatComunaIds: ['8261414'], flatTiers: R.parseTable('30 = 2000\n* = 4000') };
  assert.equal(R.flatRate('8261414', 1, cfg), 2000);
  assert.equal(R.flatRate('8261414', 30, cfg), 2000);
  assert.equal(R.flatRate('8261414', 30.01, cfg), 4000);
  assert.equal(R.flatRate('8261311', 1, cfg), null);
});

test('flatRate returns null when no tier covers the weight', () => {
  const cfg = { flatComunaIds: ['8261414'], flatTiers: R.parseTable('30 = 2000') };
  assert.equal(R.flatRate('8261414', 31, cfg), null);
});

test('parseClp and formatClp', () => {
  assert.equal(R.parseClp('$4.470'), 4470);
  assert.equal(R.parseClp('$0'), 0);
  assert.equal(R.parseClp('n/a'), null);
  assert.equal(R.formatClp(2000), '$2.000');
  assert.equal(R.formatClp(1234567), '$1.234.567');
});

const RATES = [
  { fulfillment_company: 'starken', service_label: 'Agencia Normal', service_code: '10', amount: '$1.963' },
  { fulfillment_company: 'starken', service_label: 'Domicilio Normal', service_code: '20', amount: '$3.070' },
  { fulfillment_company: 'bluexpress', service_label: 'Express', service_code: 'EX', amount: '$2.979' },
  { fulfillment_company: 'correos_chile', service_label: 'Paquete Express Domicilio', service_code: '24', amount: '$0' },
];

test('filterHomeDelivery keeps allowlisted services with a positive amount', () => {
  const services = R.parseServices('Starken:20, bluexpress:EX\ncorreos_chile:24');
  assert.deepEqual(R.filterHomeDelivery(RATES, services), [
    { company: 'starken', label: 'Domicilio Normal', amount: 3070 },
    { company: 'bluexpress', label: 'Express', amount: 2979 },
  ]);
  assert.deepEqual(R.filterHomeDelivery(null, services), []);
});

test('pickPrice returns the minimum and prefers flat on a tie', () => {
  assert.deepEqual(R.pickPrice(2000, [{ amount: 2979 }]), { price: 2000, source: 'flat' });
  assert.deepEqual(R.pickPrice(2000, [{ amount: 1500 }]), { price: 1500, source: 'courier' });
  assert.deepEqual(R.pickPrice(2000, [{ amount: 2000 }]), { price: 2000, source: 'flat' });
  assert.deepEqual(R.pickPrice(null, [{ amount: 4470 }, { amount: 3117 }]), { price: 3117, source: 'courier' });
  assert.deepEqual(R.pickPrice(null, []), { price: null, source: null });
  assert.deepEqual(R.pickPrice(null, null), { price: null, source: null });
});

test('cartWeight sums weight × qty and detects the current product+variant', () => {
  const cart = { products: [
    { product_id: 1, variant_id: null, weight: 1, qty: 2 },
    { product_id: 2, variant_id: 20, weight: 0.5, qty: 1 },
  ] };
  assert.deepEqual(R.cartWeight(cart, 1, null), { kg: 2.5, containsCurrent: true });
  assert.deepEqual(R.cartWeight(cart, 2, 21), { kg: 2.5, containsCurrent: false });
  assert.deepEqual(R.cartWeight(cart, 2, 20), { kg: 2.5, containsCurrent: true });
  assert.deepEqual(R.cartWeight(null, 1, null), { kg: 0, containsCurrent: false });
});

test('variantWeight prefers the variant weight, falls back to product weight', () => {
  const product = { weight: 1, variants: [{ id: 10, weight: 2.5 }, { id: 11, weight: 0 }] };
  assert.equal(R.variantWeight(product, 10), 2.5);
  assert.equal(R.variantWeight(product, 11), 1);
  assert.equal(R.variantWeight(product, null), 1);
  assert.equal(R.variantWeight(null, 10), 0);
});

test('roundKg ceils to 0.5 with a 0.5 minimum', () => {
  assert.equal(R.roundKg(0), 0.5);
  assert.equal(R.roundKg(2.1), 2.5);
  assert.equal(R.roundKg(2.5), 2.5);
  assert.equal(R.roundKg(2.6), 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-rules.js'`.

- [ ] **Step 3: Implement `src/eta-rules.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Rules = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var noop = function () {};

  function normalizeComuna(name) {
    return String(name || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function parseList(text) {
    return String(text || '').split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseTable(text, warn) {
    warn = warn || noop;
    var tiers = [];
    parseList(text).forEach(function (line) {
      var m = line.match(/^(\*|\d+(?:\.\d+)?)\s*=\s*([\d.]+)$/);
      if (!m) { warn('[eta] invalid flat-rate line: ' + line); return; }
      tiers.push({
        maxKg: m[1] === '*' ? Infinity : parseFloat(m[1]),
        price: parseInt(m[2].replace(/\./g, ''), 10),
      });
    });
    return tiers.sort(function (a, b) { return a.maxKg - b.maxKg; });
  }

  function resolveComunas(names, comunas, warn) {
    warn = warn || noop;
    var index = {};
    comunas.forEach(function (c) { index[normalizeComuna(c.name)] = c; });
    var out = [];
    names.forEach(function (name) {
      var c = index[normalizeComuna(name)];
      if (c) out.push(c); else warn('[eta] unknown comuna: ' + name);
    });
    return out;
  }

  function flatRate(comunaId, kg, cfg) {
    if (cfg.flatComunaIds.indexOf(String(comunaId)) === -1) return null;
    for (var i = 0; i < cfg.flatTiers.length; i++) {
      if (kg <= cfg.flatTiers[i].maxKg) return cfg.flatTiers[i].price;
    }
    return null;
  }

  function parseClp(text) {
    var digits = String(text == null ? '' : text).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function formatClp(n) {
    return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function parseServices(text) {
    return parseList(text).map(function (s) {
      var parts = s.split(':');
      return parts[0].trim().toLowerCase() + ':' + (parts[1] || '').trim();
    });
  }

  function filterHomeDelivery(rates, services) {
    if (!Array.isArray(rates)) return [];
    var out = [];
    rates.forEach(function (r) {
      var key = String(r.fulfillment_company).toLowerCase() + ':' + String(r.service_code);
      var amount = parseClp(r.amount);
      if (services.indexOf(key) !== -1 && amount > 0) {
        out.push({ company: r.fulfillment_company, label: r.service_label, amount: amount });
      }
    });
    return out;
  }

  function pickPrice(flat, quotes) {
    var best = null;
    (quotes || []).forEach(function (q) { if (best === null || q.amount < best) best = q.amount; });
    if (flat != null && (best === null || flat <= best)) return { price: flat, source: 'flat' };
    if (best !== null) return { price: best, source: 'courier' };
    return { price: null, source: null };
  }

  function cartWeight(cart, productId, variantId) {
    var lines = (cart && Array.isArray(cart.products)) ? cart.products : [];
    var kg = 0;
    var containsCurrent = false;
    lines.forEach(function (l) {
      kg += (Number(l.weight) || 0) * (Number(l.qty) || 0);
      if (String(l.product_id) === String(productId) &&
          String(l.variant_id == null ? '' : l.variant_id) === String(variantId == null ? '' : variantId)) {
        containsCurrent = true;
      }
    });
    return { kg: Math.round(kg * 1000) / 1000, containsCurrent: containsCurrent };
  }

  function variantWeight(product, variantId) {
    if (!product) return 0;
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
      if (String(variants[i].id) === String(variantId) && Number(variants[i].weight) > 0) {
        return Number(variants[i].weight);
      }
    }
    return Number(product.weight) || 0;
  }

  function roundKg(kg) {
    return Math.max(0.5, Math.ceil(kg * 2) / 2);
  }

  return {
    normalizeComuna: normalizeComuna, parseList: parseList, parseTable: parseTable,
    resolveComunas: resolveComunas, flatRate: flatRate, parseClp: parseClp, formatClp: formatClp,
    parseServices: parseServices, filterHomeDelivery: filterHomeDelivery, pickPrice: pickPrice,
    cartWeight: cartWeight, variantWeight: variantWeight, roundKg: roundKg,
  };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eta-rules.js test/rules.test.mjs
git commit -m "Add pricing rules: flat rate, courier filter, weights

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Delivery-day rules (`Eta.Rules`, part 2)

**Files:**
- Modify: `src/eta-rules.js` (add functions, extend the returned object)
- Create: `test/promise-day.test.mjs`

**Interfaces:**
- Produces:
  - `parseCutoff(text: string, warn?: fn): number` — `"14:00"` → `840` (minutes). Invalid → `840` + warning.
  - `promiseDay(now: Date, cfg: {cutoffMin: number, dispatchDays: number[], holidays: string[], timeZone?: string}): {kind: 'today'|'tomorrow'|'later', label: string, minutesLeft: number|null} | null` — `dispatchDays` uses `0` = Sunday … `6` = Saturday; `holidays` are `YYYY-MM-DD`; `timeZone` defaults to `'America/Santiago'`. Labels: `'hoy'`, `'mañana'`, `'el lunes'` … `'el domingo'`. `null` if no dispatch day in the next 14 days.
  - `formatCountdown(minutes: number): string` — `135` → `"2 h 15 min"`, `45` → `"45 min"`, `60` → `"1 h"`.

- [ ] **Step 1: Write the failing tests** — `test/promise-day.test.mjs`

Chile uses UTC−3 from the first Sunday of September to the first Sunday of April, and UTC−4 otherwise. Test instants are written in UTC.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../src/eta-rules.js');

const CFG = {
  cutoffMin: 14 * 60,
  dispatchDays: [1, 2, 3, 4, 5, 6],
  holidays: ['2026-09-18', '2026-09-19', '2026-10-12'],
};
const at = iso => new Date(iso);

test('before cutoff on a dispatch day → hoy, with minutes left', () => {
  // Wed 2026-09-23 13:59 in Santiago (UTC-3)
  assert.deepEqual(R.promiseDay(at('2026-09-23T16:59:00Z'), CFG), { kind: 'today', label: 'hoy', minutesLeft: 1 });
});

test('exactly at cutoff → mañana', () => {
  assert.deepEqual(R.promiseDay(at('2026-09-23T17:00:00Z'), CFG), { kind: 'tomorrow', label: 'mañana', minutesLeft: null });
});

test('Friday after cutoff → Saturday is a dispatch day → mañana', () => {
  assert.equal(R.promiseDay(at('2026-09-25T17:01:00Z'), CFG).label, 'mañana');
});

test('Saturday after cutoff → Sunday off → el lunes', () => {
  assert.deepEqual(R.promiseDay(at('2026-09-26T18:00:00Z'), CFG), { kind: 'later', label: 'el lunes', minutesLeft: null });
});

test('holidays are skipped: Thu 17 Sep after cutoff → Fri 18 & Sat 19 holidays → el lunes', () => {
  assert.equal(R.promiseDay(at('2026-09-17T18:00:00Z'), CFG).label, 'el lunes');
});

test('Sunday with a Monday holiday → el martes', () => {
  assert.equal(R.promiseDay(at('2026-10-11T13:00:00Z'), CFG).label, 'el martes');
});

test('uses Santiago time, not UTC: winter (UTC-4) 13:30 local is before cutoff', () => {
  // Wed 2026-07-15 13:30 in Santiago = 17:30Z. In UTC it would already be past 14:00.
  assert.equal(R.promiseDay(at('2026-07-15T17:30:00Z'), CFG).label, 'hoy');
});

test('late-night UTC still belongs to the previous Santiago day', () => {
  // 2026-09-24T02:00Z is Wed 23 Sep 23:00 in Santiago → next dispatch Thu 24 → mañana
  assert.equal(R.promiseDay(at('2026-09-24T02:00:00Z'), CFG).label, 'mañana');
});

test('no dispatch days configured → null', () => {
  assert.equal(R.promiseDay(at('2026-09-23T12:00:00Z'), { ...CFG, dispatchDays: [] }), null);
});

test('parseCutoff', () => {
  assert.equal(R.parseCutoff('14:00'), 840);
  assert.equal(R.parseCutoff('9:30'), 570);
  const warnings = [];
  assert.equal(R.parseCutoff('dos de la tarde', w => warnings.push(w)), 840);
  assert.equal(warnings.length, 1);
});

test('formatCountdown', () => {
  assert.equal(R.formatCountdown(135), '2 h 15 min');
  assert.equal(R.formatCountdown(45), '45 min');
  assert.equal(R.formatCountdown(60), '1 h');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `R.promiseDay is not a function`.

- [ ] **Step 3: Add to `src/eta-rules.js`** (above the `return`, then add the three names to the returned object)

```js
  var WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function parseCutoff(text, warn) {
    var m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) { (warn || noop)('[eta] invalid cutoff: ' + text); return 840; }
    return (+m[1]) * 60 + (+m[2]);
  }

  function localParts(now, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
    return {
      date: parts.year + '-' + parts.month + '-' + parts.day,
      weekday: WEEKDAY_INDEX[parts.weekday],
      minutes: (+parts.hour) * 60 + (+parts.minute),
    };
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
  }

  function promiseDay(now, cfg) {
    var local = localParts(now, cfg.timeZone || 'America/Santiago');
    var isDispatch = function (date, weekday) {
      return cfg.dispatchDays.indexOf(weekday) !== -1 && cfg.holidays.indexOf(date) === -1;
    };
    if (isDispatch(local.date, local.weekday) && local.minutes < cfg.cutoffMin) {
      return { kind: 'today', label: 'hoy', minutesLeft: cfg.cutoffMin - local.minutes };
    }
    for (var n = 1; n <= 14; n++) {
      var day = addDays(local.date, n);
      if (isDispatch(day.date, day.weekday)) {
        return n === 1
          ? { kind: 'tomorrow', label: 'mañana', minutesLeft: null }
          : { kind: 'later', label: 'el ' + WEEKDAYS_ES[day.weekday], minutesLeft: null };
      }
    }
    return null;
  }

  function formatCountdown(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h && m) return h + ' h ' + m + ' min';
    return h ? h + ' h' : m + ' min';
  }
```

Returned object gains: `parseCutoff: parseCutoff, promiseDay: promiseDay, formatCountdown: formatCountdown`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eta-rules.js test/promise-day.test.mjs
git commit -m "Add delivery-day rules with cutoff, dispatch days and holidays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Saved comuna (`Eta.Store`)

**Files:**
- Create: `src/eta-store.js`, `test/store.test.mjs`

**Interfaces:**
- Produces:
  - `createStore({storage?: Storage|null, eventTarget?: EventTarget|null}): {get(): Comuna|null, set(comuna: Comuna): void}` — `Comuna` = `{id, name, region}`. `set` dispatches `CustomEvent('eta:comuna-changed', {detail: comuna})` on `eventTarget`.
  - `KEY = 'eta:comuna'`

- [ ] **Step 1: Write the failing tests** — `test/store.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../src/eta-store.js');

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const PROV = { id: '8261414', name: 'Providencia', region: '12' };

test('returns null when nothing is saved', () => {
  assert.equal(S.createStore({ storage: memoryStorage() }).get(), null);
});

test('persists across store instances', () => {
  const storage = memoryStorage();
  S.createStore({ storage }).set(PROV);
  assert.deepEqual(S.createStore({ storage }).get(), PROV);
});

test('falls back to memory when storage throws', () => {
  const store = S.createStore({ storage: throwing });
  store.set(PROV);
  assert.deepEqual(store.get(), PROV);
});

test('ignores corrupted JSON', () => {
  const storage = memoryStorage();
  storage.setItem(S.KEY, '{not json');
  assert.equal(S.createStore({ storage }).get(), null);
});

test('set dispatches eta:comuna-changed', () => {
  const target = new EventTarget();
  let received = null;
  target.addEventListener('eta:comuna-changed', e => { received = e.detail; });
  S.createStore({ storage: memoryStorage(), eventTarget: target }).set(PROV);
  assert.deepEqual(received, PROV);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-store.js'`.

- [ ] **Step 3: Implement `src/eta-store.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Store = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'eta:comuna';

  function createStore(opts) {
    var storage = opts.storage || null;
    var target = opts.eventTarget || null;
    var memory = null;

    function get() {
      try {
        var raw = storage && storage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* blocked or corrupted: fall through */ }
      return memory;
    }

    function set(comuna) {
      memory = comuna;
      try { if (storage) storage.setItem(KEY, JSON.stringify(comuna)); } catch (e) { /* memory only */ }
      if (target) target.dispatchEvent(new CustomEvent('eta:comuna-changed', { detail: comuna }));
    }

    return { get: get, set: set };
  }

  return { createStore: createStore, KEY: KEY };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eta-store.js test/store.test.mjs
git commit -m "Add saved-comuna store with memory fallback and change event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Weights and courier quotes (`Eta.Data`)

**Files:**
- Create: `src/eta-data.js`, `test/data.test.mjs`

**Interfaces:**
- Consumes: `Eta.Rules` (`cartWeight`, `variantWeight`, `roundKg`, `filterHomeDelivery`) — passed in as `opts.rules`.
- Produces:
  - `createData(opts): { weightFor(productId, variantId): Promise<number>, quote(comuna, kg): Promise<Quote[]|null> }`
  - `opts`: `{ rules, fetch, storage, getCart: () => Promise<cart|null>, now: () => number, origin: {id, region}, box: {length, width, height}, services: string[], timeoutMs = 10000, ttlMs = 6*3600e3, emptyTtlMs = 10*60e3 }`
  - `Quote` = `{company, label, amount}` (home-delivery only). `quote` resolves `null` on network error or timeout (not cached); `[]` when the API returns no usable rate (cached for `emptyTtlMs`).
  - `weightFor` returns cart kg + variant kg (variant skipped if already in cart). A failing cart counts as 0; a failing product fetch counts as 0.
  - `QUOTE_URL = 'https://api.jumpseller.com/landing/estimate_rates.json'`

- [ ] **Step 1: Write the failing tests** — `test/data.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Rules = require('../src/eta-rules.js');
const D = require('../src/eta-data.js');

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const TEMUCO = { id: '8261311', name: 'Temuco', region: '04' };
const API_RATES = [
  { fulfillment_company: 'starken', service_label: 'Agencia Normal', service_code: '10', amount: '$3.117' },
  { fulfillment_company: 'starken', service_label: 'Domicilio Normal', service_code: '20', amount: '$4.875' },
];

function setup(over = {}) {
  const calls = [];
  let clock = 1_000_000;
  const fetch = over.fetch || (async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('/api/products/')) return { ok: true, json: async () => ({ weight: 1, variants: [{ id: 7, weight: 2 }] }) };
    return { ok: true, json: async () => API_RATES };
  });
  const data = D.createData({
    rules: Rules, fetch, storage: memoryStorage(),
    getCart: over.getCart || (async () => ({ products: [{ product_id: 9, variant_id: null, weight: 3, qty: 2 }] })),
    now: () => clock, origin: { id: '8261395', region: '12' },
    box: { length: 30, width: 20, height: 10 }, services: ['starken:20'],
    timeoutMs: over.timeoutMs || 10000,
  });
  return { data, calls, tick: ms => { clock += ms; } };
}

test('weightFor adds the variant weight to the cart weight', async () => {
  const { data } = setup();
  assert.equal(await data.weightFor(1, 7), 8);
  assert.equal(await data.weightFor(1, null), 7);
});

test('weightFor does not add the product twice when already in the cart', async () => {
  const { data } = setup();
  assert.equal(await data.weightFor(9, null), 6); // product 9 (3 kg × 2) is already in the cart
});

test('weightFor treats a failing cart as empty', async () => {
  const { data } = setup({ getCart: async () => { throw new Error('boom'); } });
  assert.equal(await data.weightFor(1, 7), 2);
});

test('quote posts origin, destination and one package with the rounded weight', async () => {
  const { data, calls } = setup();
  const quotes = await data.quote(TEMUCO, 2.1);
  assert.deepEqual(quotes, [{ company: 'starken', label: 'Domicilio Normal', amount: 4875 }]);
  const post = calls.find(c => c.url === D.QUOTE_URL);
  assert.deepEqual(post.body, { rates: {
    origin_address: { country: 'CL', region: '12', municipality: '8261395' },
    shipping_address: { country: 'CL', region: '04', municipality: '8261311' },
    packages_dimensions: [{ length: 30, width: 20, height: 10, weight: 2.5 }],
  } });
});

test('quote is cached per comuna and rounded weight until the TTL expires', async () => {
  const { data, calls, tick } = setup();
  await data.quote(TEMUCO, 2.1);
  await data.quote(TEMUCO, 2.4);
  assert.equal(calls.filter(c => c.url === D.QUOTE_URL).length, 1);
  tick(6 * 3600e3 + 1);
  await data.quote(TEMUCO, 2.4);
  assert.equal(calls.filter(c => c.url === D.QUOTE_URL).length, 2);
});

test('empty results are cached only for the short TTL', async () => {
  const { data, calls, tick } = setup({ fetch: async (url, init) => { calls.push({ url }); return { ok: true, json: async () => [] }; } });
  assert.deepEqual(await data.quote(TEMUCO, 1), []);
  tick(5 * 60e3);
  await data.quote(TEMUCO, 1);
  tick(6 * 60e3);
  await data.quote(TEMUCO, 1);
  assert.equal(calls.length, 2);
});

test('network errors resolve null and are not cached', async () => {
  let n = 0;
  const { data } = setup({ fetch: async () => { n++; throw new TypeError('Failed to fetch'); } });
  assert.equal(await data.quote(TEMUCO, 1), null);
  assert.equal(await data.quote(TEMUCO, 1), null);
  assert.equal(n, 2);
});

test('non-2xx responses resolve null', async () => {
  const { data } = setup({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(await data.quote(TEMUCO, 1), null);
});

test('slow responses time out to null', async () => {
  const { data } = setup({
    timeoutMs: 20,
    fetch: (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  });
  assert.equal(await data.quote(TEMUCO, 1), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-data.js'`.

- [ ] **Step 3: Implement `src/eta-data.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Data = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUOTE_URL = 'https://api.jumpseller.com/landing/estimate_rates.json';

  function createData(opts) {
    var rules = opts.rules;
    var timeoutMs = opts.timeoutMs || 10000;
    var ttlMs = opts.ttlMs || 6 * 3600e3;
    var emptyTtlMs = opts.emptyTtlMs || 10 * 60e3;
    var productCache = {};

    function readCache(key) {
      try { var raw = opts.storage && opts.storage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    }
    function writeCache(key, value) {
      try { if (opts.storage) opts.storage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    function loadProduct(productId) {
      if (!productCache[productId]) {
        productCache[productId] = opts.fetch('/api/products/' + productId + '.json')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      }
      return productCache[productId];
    }

    function weightFor(productId, variantId) {
      var cartP = Promise.resolve().then(opts.getCart).catch(function () { return null; });
      return Promise.all([cartP, loadProduct(productId)]).then(function (res) {
        var cart = rules.cartWeight(res[0], productId, variantId);
        var item = rules.variantWeight(res[1], variantId);
        return Math.round((cart.kg + (cart.containsCurrent ? 0 : item)) * 1000) / 1000;
      });
    }

    function quote(comuna, kg) {
      var weight = rules.roundKg(kg);
      var key = 'eta:q:' + comuna.id + '|' + weight;
      var cached = readCache(key);
      if (cached && Array.isArray(cached.quotes)) {
        var ttl = cached.quotes.length ? ttlMs : emptyTtlMs;
        if (opts.now() - cached.t < ttl) return Promise.resolve(cached.quotes);
      }
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      var body = { rates: {
        origin_address: { country: 'CL', region: opts.origin.region, municipality: opts.origin.id },
        shipping_address: { country: 'CL', region: comuna.region, municipality: comuna.id },
        packages_dimensions: [{ length: opts.box.length, width: opts.box.width, height: opts.box.height, weight: weight }],
      } };
      return opts.fetch(QUOTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json().then(function (rates) {
          var quotes = rules.filterHomeDelivery(rates, opts.services);
          writeCache(key, { t: opts.now(), quotes: quotes });
          return quotes;
        });
      }).catch(function () { return null; })
        .finally(function () { clearTimeout(timer); });
    }

    return { weightFor: weightFor, quote: quote };
  }

  return { createData: createData, QUOTE_URL: QUOTE_URL };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eta-data.js test/data.test.mjs
git commit -m "Add weight lookup and cached courier quotes with timeout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rendering and selector (`Eta.UI`)

**Files:**
- Create: `src/eta-ui.js`, `test/ui.test.mjs`

**Interfaces:**
- Consumes: `Eta.Rules` (`normalizeComuna`, `formatClp`, `formatCountdown`) — passed in.
- Produces:
  - `renderWidget(el: Element, state: WidgetState, rules): void` where `WidgetState` is one of:
    - `{kind: 'no-comuna'}`
    - `{kind: 'loading', comuna}`
    - `{kind: 'priced', comuna, price: number, source: 'flat'|'courier', promise: PromiseDay|null, showCountdown: boolean}`
    - `{kind: 'unavailable', comuna}`
  - `searchComunas(query: string, comunas, rules, limit = 8): Comuna[]` — prefix matches first, then substring matches; accent/case-insensitive.
  - `geoToComuna(address: object, comunas, rules): Comuna|null` — checks Nominatim fields in this order: `municipality`, `city_district`, `town`, `village`, `suburb`, `city`, `county`; returns the first that matches a comuna.
  - `renderLabel(el: Element, comuna: Comuna|null): void` — `"Enviar a Providencia"` / `"¿Dónde lo recibes?"`.
  - `mountPanel(panel: Element, {comunas, rules, onPick(comuna), geolocate(): Promise<Comuna|null>}): {open(): void, close(): void}`
- All buttons that open the panel carry `data-eta-open`. The widget renders its own `data-eta-open` button.
- All dynamic text is escaped (`escapeHtml`).

Markup contract (used by Task 8's CSS and partials):

```html
<!-- widget -->
<div class="eta-widget eta-widget--priced">
  <span class="eta-widget__icon" aria-hidden="true">🚚</span>
  <div class="eta-widget__body">
    <p class="eta-widget__title">Llega <strong>hoy</strong> por <strong>$2.000</strong></p>
    <p class="eta-widget__meta">a Providencia · <button type="button" class="eta-widget__change" data-eta-open>Cambiar</button></p>
    <p class="eta-widget__countdown">Compra en las próximas 2 h 15 min</p>
  </div>
</div>

<!-- panel (static shell from eta_config.liquid; list filled by mountPanel) -->
<div class="eta-panel" data-eta-panel hidden>
  <div class="eta-panel__backdrop" data-eta-close></div>
  <div class="eta-panel__sheet" role="dialog" aria-modal="true" aria-labelledby="eta-panel-title">
    <p class="eta-panel__title" id="eta-panel-title">¿Dónde lo recibes?</p>
    <input class="eta-panel__search" type="search" placeholder="Busca tu comuna" autocomplete="off">
    <button type="button" class="eta-panel__geo" data-eta-geo>📍 Usar mi ubicación</button>
    <p class="eta-panel__msg" data-eta-msg hidden></p>
    <ul class="eta-panel__list" role="listbox"></ul>
  </div>
</div>
```

- [ ] **Step 1: Write the failing tests** — `test/ui.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const Rules = require('../src/eta-rules.js');
const UI = require('../src/eta-ui.js');

const COMUNAS = [
  { id: '8261395', name: 'Santiago', region: '12' },
  { id: '8261414', name: 'Providencia', region: '12' },
  { id: '8261178', name: 'Ñuñoa', region: '12' },
  { id: '8261311', name: 'Temuco', region: '04' },
  { id: '8261369', name: 'Cerrillos', region: '12' },
];
const PROV = COMUNAS[1];
const dom = () => new JSDOM('<div id="w"></div><div class="eta-panel" data-eta-panel hidden><div class="eta-panel__backdrop" data-eta-close></div><div class="eta-panel__sheet"><input class="eta-panel__search"><button data-eta-geo></button><p data-eta-msg hidden></p><ul class="eta-panel__list"></ul></div></div>').window.document;

test('no-comuna state invites choosing a comuna', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'no-comuna' }, Rules);
  assert.match(el.textContent, /Envío a todo Chile/);
  assert.ok(el.querySelector('[data-eta-open]'));
});

test('priced flat state shows day, price, comuna and countdown', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'priced', comuna: PROV, price: 2000, source: 'flat',
    promise: { kind: 'today', label: 'hoy', minutesLeft: 135 }, showCountdown: true }, Rules);
  assert.match(el.textContent, /Llega hoy por \$2\.000/);
  assert.match(el.textContent, /a Providencia/);
  assert.match(el.textContent, /Compra en las próximas 2 h 15 min/);
});

test('countdown hidden when disabled or not today', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'priced', comuna: PROV, price: 2000, source: 'flat',
    promise: { kind: 'tomorrow', label: 'mañana', minutesLeft: null }, showCountdown: true }, Rules);
  assert.match(el.textContent, /Llega mañana por \$2\.000/);
  assert.doesNotMatch(el.textContent, /Compra en/);
});

test('courier state shows price without a day promise', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'priced', comuna: COMUNAS[3], price: 4470, source: 'courier', promise: null, showCountdown: true }, Rules);
  assert.match(el.textContent, /Envío a Temuco desde \$4\.470/);
  assert.doesNotMatch(el.textContent, /Llega/);
});

test('loading keeps a skeleton and unavailable falls back to checkout copy', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'loading', comuna: COMUNAS[3] }, Rules);
  assert.ok(el.querySelector('.eta-widget__skeleton'));
  UI.renderWidget(el, { kind: 'unavailable', comuna: COMUNAS[3] }, Rules);
  assert.match(el.textContent, /Envío a Temuco: se calcula en el checkout/);
});

test('comuna names are escaped', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderWidget(el, { kind: 'unavailable', comuna: { id: '1', name: '<img src=x>', region: '12' } }, Rules);
  assert.equal(el.querySelector('img'), null);
});

test('searchComunas: accent-insensitive, prefix first, limited', () => {
  assert.deepEqual(UI.searchComunas('nun', COMUNAS, Rules).map(c => c.name), ['Ñuñoa']);
  assert.deepEqual(UI.searchComunas('ce', COMUNAS, Rules).map(c => c.name)[0], 'Cerrillos');
  assert.equal(UI.searchComunas('', COMUNAS, Rules).length, 0);
  assert.equal(UI.searchComunas('a', COMUNAS, Rules, 2).length, 2);
});

test('geoToComuna prefers the most specific field that is a comuna', () => {
  assert.equal(UI.geoToComuna({ suburb: 'Providencia', city: 'Santiago', state: 'Región Metropolitana' }, COMUNAS, Rules).name, 'Providencia');
  assert.equal(UI.geoToComuna({ city: 'Temuco' }, COMUNAS, Rules).name, 'Temuco');
  assert.equal(UI.geoToComuna({ state: 'Región de la Araucanía' }, COMUNAS, Rules), null);
  assert.equal(UI.geoToComuna(null, COMUNAS, Rules), null);
});

test('renderLabel', () => {
  const doc = dom(); const el = doc.getElementById('w');
  UI.renderLabel(el, PROV);
  assert.equal(el.textContent, 'Enviar a Providencia');
  UI.renderLabel(el, null);
  assert.equal(el.textContent, '¿Dónde lo recibes?');
});

test('mountPanel: typing lists matches, clicking picks and closes', () => {
  const doc = dom();
  const panel = doc.querySelector('[data-eta-panel]');
  let picked = null;
  const api = UI.mountPanel(panel, { comunas: COMUNAS, rules: Rules, onPick: c => { picked = c; }, geolocate: async () => null });
  api.open();
  assert.equal(panel.hidden, false);
  const input = panel.querySelector('.eta-panel__search');
  input.value = 'provi';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  const items = panel.querySelectorAll('.eta-panel__list button');
  assert.equal(items.length, 1);
  items[0].click();
  assert.deepEqual(picked, PROV);
  assert.equal(panel.hidden, true);
});

test('mountPanel: geolocation miss shows a message and keeps the panel open', async () => {
  const doc = dom();
  const panel = doc.querySelector('[data-eta-panel]');
  const api = UI.mountPanel(panel, { comunas: COMUNAS, rules: Rules, onPick: () => {}, geolocate: async () => null });
  api.open();
  panel.querySelector('[data-eta-geo]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('[data-eta-msg]').hidden, false);
});

test('mountPanel: backdrop closes', () => {
  const doc = dom();
  const panel = doc.querySelector('[data-eta-panel]');
  const api = UI.mountPanel(panel, { comunas: COMUNAS, rules: Rules, onPick: () => {}, geolocate: async () => null });
  api.open();
  panel.querySelector('[data-eta-close]').click();
  assert.equal(panel.hidden, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-ui.js'`.

- [ ] **Step 3: Implement `src/eta-ui.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.UI = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GEO_FIELDS = ['municipality', 'city_district', 'town', 'village', 'suburb', 'city', 'county'];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var changeBtn = function (text) {
    return '<button type="button" class="eta-widget__change" data-eta-open>' + text + '</button>';
  };

  function renderWidget(el, state, rules) {
    var html;
    var name = state.comuna ? escapeHtml(state.comuna.name) : '';
    if (state.kind === 'no-comuna') {
      html = '<p class="eta-widget__title">Envío a todo Chile</p>' +
        '<p class="eta-widget__meta">' + changeBtn('📍 ¿Dónde lo recibes?') + '</p>';
    } else if (state.kind === 'loading') {
      html = '<p class="eta-widget__title">Envío a ' + name + ' <span class="eta-widget__skeleton" aria-hidden="true"></span></p>' +
        '<p class="eta-widget__meta">&nbsp;</p>';
    } else if (state.kind === 'unavailable') {
      html = '<p class="eta-widget__title">Envío a ' + name + ': se calcula en el checkout</p>' +
        '<p class="eta-widget__meta">' + changeBtn('Cambiar comuna') + '</p>';
    } else {
      var price = '<strong>' + rules.formatClp(state.price) + '</strong>';
      var p = state.promise;
      if (state.source === 'flat' && p) {
        html = '<p class="eta-widget__title">Llega <strong>' + p.label + '</strong> por ' + price + '</p>' +
          '<p class="eta-widget__meta">a ' + name + ' · ' + changeBtn('Cambiar') + '</p>';
        if (state.showCountdown && p.kind === 'today' && p.minutesLeft > 0) {
          html += '<p class="eta-widget__countdown">Compra en las próximas ' + rules.formatCountdown(p.minutesLeft) + '</p>';
        }
      } else {
        html = '<p class="eta-widget__title">Envío a ' + name + ' desde ' + price + '</p>' +
          '<p class="eta-widget__meta">' + changeBtn('Cambiar comuna') + '</p>';
      }
    }
    el.className = 'eta-widget eta-widget--' + state.kind;
    el.innerHTML = '<span class="eta-widget__icon" aria-hidden="true">🚚</span><div class="eta-widget__body">' + html + '</div>';
  }

  function searchComunas(query, comunas, rules, limit) {
    limit = limit || 8;
    var q = rules.normalizeComuna(query);
    if (!q) return [];
    var prefix = [];
    var inner = [];
    comunas.forEach(function (c) {
      var n = rules.normalizeComuna(c.name);
      if (n.indexOf(q) === 0) prefix.push(c);
      else if (n.indexOf(q) > 0) inner.push(c);
    });
    return prefix.concat(inner).slice(0, limit);
  }

  function geoToComuna(address, comunas, rules) {
    if (!address) return null;
    var index = {};
    comunas.forEach(function (c) { index[rules.normalizeComuna(c.name)] = c; });
    for (var i = 0; i < GEO_FIELDS.length; i++) {
      var v = address[GEO_FIELDS[i]];
      if (v && index[rules.normalizeComuna(v)]) return index[rules.normalizeComuna(v)];
    }
    return null;
  }

  function renderLabel(el, comuna) {
    el.textContent = comuna ? 'Enviar a ' + comuna.name : '¿Dónde lo recibes?';
  }

  function mountPanel(panel, opts) {
    var input = panel.querySelector('.eta-panel__search');
    var list = panel.querySelector('.eta-panel__list');
    var msg = panel.querySelector('[data-eta-msg]');
    var geoBtn = panel.querySelector('[data-eta-geo]');

    function showMsg(text) { msg.textContent = text; msg.hidden = !text; }
    function close() { panel.hidden = true; }
    function open() {
      panel.hidden = false; input.value = ''; list.innerHTML = ''; showMsg('');
      if (input.focus) input.focus();
    }
    function pick(c) { opts.onPick(c); close(); }

    input.addEventListener('input', function () {
      var matches = searchComunas(input.value, opts.comunas, opts.rules);
      list.innerHTML = '';
      matches.forEach(function (c) {
        var li = panel.ownerDocument.createElement('li');
        var b = panel.ownerDocument.createElement('button');
        b.type = 'button'; b.textContent = c.name;
        b.addEventListener('click', function () { pick(c); });
        li.appendChild(b); list.appendChild(li);
      });
      showMsg(input.value.trim() && !matches.length ? 'No encontramos esa comuna' : '');
    });
    geoBtn.addEventListener('click', function () {
      showMsg('Buscando tu ubicación…');
      opts.geolocate().then(function (c) {
        if (c) pick(c); else showMsg('No pudimos detectar tu comuna. Búscala en la lista.');
      }, function () { showMsg('No pudimos detectar tu comuna. Búscala en la lista.'); });
    });
    panel.querySelectorAll('[data-eta-close]').forEach(function (b) { b.addEventListener('click', close); });
    panel.ownerDocument.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    return { open: open, close: close };
  }

  return {
    renderWidget: renderWidget, searchComunas: searchComunas, geoToComuna: geoToComuna,
    renderLabel: renderLabel, mountPanel: mountPanel, escapeHtml: escapeHtml,
  };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eta-ui.js test/ui.test.mjs
git commit -m "Add widget states, comuna search panel and geolocation matching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wiring (`Eta.Boot`) and bundle

**Files:**
- Create: `src/eta-boot.js`, `scripts/build.mjs`, `test/boot.test.mjs`, `theme-kit/assets/eta-widget.js` (built)

**Interfaces:**
- Consumes: `Eta.Comunas`, `Eta.Rules`, `Eta.Store`, `Eta.Data`, `Eta.UI` (all tasks above).
- Produces:
  - `readConfig(dataset, comunas, rules, warn?): Config` — from the `#eta-config` element's `dataset` (attribute names in Task 8). `Config` = `{origin: Comuna, cutoffMin, dispatchDays: number[], holidays: string[], flatComunaIds: string[], flatTiers, showCountdown: boolean, box: {length, width, height}, services: string[]}`.
  - `start({doc, win, config, comunas, rules, store, data, now: () => Date, getVariantId: () => string|null}): {update(): Promise<void>}` — mounts `[data-eta-widget]`, `[data-eta-label]`, `[data-eta-panel]`; recomputes on `eta:comuna-changed`, on `change` inside `form[name="buy"]`, on mutations of `.theme-cart-counter`, and every 60 s.
  - Browser auto-start at the bottom of the file when `document.getElementById('eta-config')` exists.

- [ ] **Step 1: Write the failing tests** — `test/boot.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const Rules = require('../src/eta-rules.js');
const Store = require('../src/eta-store.js');
const UI = require('../src/eta-ui.js');
const Boot = require('../src/eta-boot.js');

const COMUNAS = [
  { id: '8261395', name: 'Santiago', region: '12' },
  { id: '8261414', name: 'Providencia', region: '12' },
  { id: '8261311', name: 'Temuco', region: '04' },
];

test('readConfig parses every option and resolves comunas', () => {
  const cfg = Boot.readConfig({
    origin: 'Santiago', cutoff: '14:00', days: '1,2,3,4,5,6,', holidays: '2026-12-25, 2027-01-01',
    flatComunas: 'Providencia\nSantiago', flatTable: '30 = 2000\n* = 4000', countdown: '1',
    box: '30x20x10', services: 'starken:20, bluexpress:EX',
  }, COMUNAS, Rules);
  assert.equal(cfg.origin.id, '8261395');
  assert.equal(cfg.cutoffMin, 840);
  assert.deepEqual(cfg.dispatchDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(cfg.holidays, ['2026-12-25', '2027-01-01']);
  assert.deepEqual(cfg.flatComunaIds, ['8261414', '8261395']);
  assert.equal(cfg.flatTiers.length, 2);
  assert.equal(cfg.showCountdown, true);
  assert.deepEqual(cfg.box, { length: 30, width: 20, height: 10 });
  assert.deepEqual(cfg.services, ['starken:20', 'bluexpress:EX']);
});

test('readConfig falls back to a default box and Santiago origin', () => {
  const cfg = Boot.readConfig({ origin: 'Nowhere', box: 'x', days: '', countdown: '' }, COMUNAS, Rules, () => {});
  assert.equal(cfg.origin.id, '8261395');
  assert.deepEqual(cfg.box, { length: 30, width: 20, height: 10 });
  assert.equal(cfg.showCountdown, false);
});

function page() {
  return new JSDOM(`
    <span data-eta-label></span>
    <form name="buy" action="/cart/add/1"><select name="v"><option value="a">A</option></select></form>
    <div data-eta-widget data-product-id="1"></div>
    <span class="theme-cart-counter" data-products-count="0">0</span>
    <div class="eta-panel" data-eta-panel hidden><div data-eta-close></div>
      <input class="eta-panel__search"><button data-eta-geo></button><p data-eta-msg hidden></p><ul class="eta-panel__list"></ul></div>`);
}
const CONFIG = {
  origin: COMUNAS[0], cutoffMin: 840, dispatchDays: [1, 2, 3, 4, 5, 6], holidays: [],
  flatComunaIds: ['8261414'], flatTiers: Rules.parseTable('30 = 2000\n* = 4000'),
  showCountdown: true, box: { length: 30, width: 20, height: 10 }, services: ['starken:20'],
};
const tick = () => new Promise(r => setTimeout(r, 0));

test('flat comuna renders immediately with day promise', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[1]);
  const data = { weightFor: async () => 1, quote: async () => [{ amount: 3070 }] };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  const w = window.document.querySelector('[data-eta-widget]');
  assert.match(w.textContent, /Llega hoy por \$2\.000/);
  assert.equal(window.document.querySelector('[data-eta-label]').textContent, 'Enviar a Providencia');
});

test('a stale quote never overwrites a newer comuna', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[2]); // Temuco, courier only
  let releaseSlow;
  const data = {
    weightFor: async () => 1,
    quote: c => c.id === '8261311'
      ? new Promise(r => { releaseSlow = () => r([{ amount: 9999 }]); })
      : Promise.resolve([]),
  };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  const first = app.update();
  await tick();
  store.set(COMUNAS[1]); // switch to Providencia while Temuco is pending
  await app.update();
  releaseSlow();
  await first;
  const w = window.document.querySelector('[data-eta-widget]');
  assert.match(w.textContent, /Providencia/);
  assert.doesNotMatch(w.textContent, /9\.999/);
});

test('failed quote on a courier-only comuna shows the checkout fallback', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[2]);
  const data = { weightFor: async () => 1, quote: async () => null };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  assert.match(window.document.querySelector('[data-eta-widget]').textContent, /se calcula en el checkout/);
});

test('no saved comuna renders the invitation and does not quote', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  let quoted = false;
  const data = { weightFor: async () => 1, quote: async () => { quoted = true; return []; } };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  assert.match(window.document.querySelector('[data-eta-widget]').textContent, /Envío a todo Chile/);
  assert.equal(quoted, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/eta-boot.js'`.

- [ ] **Step 3: Implement `src/eta-boot.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Eta = root.Eta || {}; root.Eta.Boot = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BOX = { length: 30, width: 20, height: 10 };

  function readConfig(ds, comunas, rules, warn) {
    warn = warn || function (m) { if (typeof console !== 'undefined') console.warn(m); };
    var origin = rules.resolveComunas([ds.origin || 'Santiago'], comunas, warn)[0] ||
      rules.resolveComunas(['Santiago'], comunas)[0];
    var dims = String(ds.box || '').split('x').map(Number);
    var box = dims.length === 3 && dims.every(function (n) { return n > 0; })
      ? { length: dims[0], width: dims[1], height: dims[2] } : DEFAULT_BOX;
    return {
      origin: origin,
      cutoffMin: rules.parseCutoff(ds.cutoff || '14:00', warn),
      dispatchDays: rules.parseList(ds.days).map(Number).filter(function (n) { return n >= 0 && n <= 6; }),
      holidays: rules.parseList(ds.holidays),
      flatComunaIds: rules.resolveComunas(rules.parseList(ds.flatComunas), comunas, warn).map(function (c) { return c.id; }),
      flatTiers: rules.parseTable(ds.flatTable, warn),
      showCountdown: ds.countdown === '1',
      box: box,
      services: rules.parseServices(ds.services),
    };
  }

  function start(o) {
    var doc = o.doc, cfg = o.config, rules = o.rules, ui = o.ui;
    var widget = doc.querySelector('[data-eta-widget]');
    var labels = doc.querySelectorAll('[data-eta-label]');
    var panelEl = doc.querySelector('[data-eta-panel]');
    var seq = 0;

    var panel = panelEl && ui.mountPanel(panelEl, {
      comunas: o.comunas, rules: rules,
      onPick: function (c) { o.store.set(c); },
      geolocate: o.geolocate || function () { return Promise.resolve(null); },
    });
    doc.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-eta-open]');
      if (t && panel) { e.preventDefault(); panel.open(); }
    });

    function update() {
      var mySeq = ++seq;
      var comuna = o.store.get();
      labels.forEach(function (l) { ui.renderLabel(l, comuna); });
      if (!widget) return Promise.resolve();
      if (!comuna) { ui.renderWidget(widget, { kind: 'no-comuna' }, rules); return Promise.resolve(); }

      var productId = widget.getAttribute('data-product-id');
      return o.data.weightFor(productId, o.getVariantId()).then(function (kg) {
        if (mySeq !== seq) return;
        var flat = rules.flatRate(comuna.id, kg, cfg);
        var promise = rules.promiseDay(o.now(), cfg);
        var render = function (quotes) {
          if (mySeq !== seq) return;
          var pick = rules.pickPrice(flat, quotes);
          if (pick.price == null) { ui.renderWidget(widget, { kind: 'unavailable', comuna: comuna }, rules); return; }
          ui.renderWidget(widget, { kind: 'priced', comuna: comuna, price: pick.price, source: pick.source,
            promise: pick.source === 'flat' ? promise : null, showCountdown: cfg.showCountdown }, rules);
        };
        if (flat != null) render([]); else ui.renderWidget(widget, { kind: 'loading', comuna: comuna }, rules);
        return o.data.quote(comuna, kg).then(render);
      });
    }

    doc.addEventListener('eta:comuna-changed', function () { update(); });
    var form = doc.querySelector('form[name="buy"]');
    if (form) form.addEventListener('change', function () { update(); });
    var counter = doc.querySelector('.theme-cart-counter');
    if (counter && o.win.MutationObserver) {
      new o.win.MutationObserver(function () { update(); })
        .observe(counter, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    if (o.win.setInterval && !o.noInterval) o.win.setInterval(update, 60000);

    return { update: update };
  }

  function getCartPromise(win) {
    return new Promise(function (resolve) {
      if (!win.Jumpseller || !win.Jumpseller.getCart) { resolve(null); return; }
      win.Jumpseller.getCart({ callback: function (c) { resolve(c && Array.isArray(c.products) ? c : null); } });
    });
  }

  function geolocate(win, comunas, rules, ui) {
    return new Promise(function (resolve) {
      if (!win.navigator.geolocation) { resolve(null); return; }
      win.navigator.geolocation.getCurrentPosition(function (pos) {
        var url = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=14' +
          '&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude;
        win.fetch(url).then(function (r) { return r.json(); })
          .then(function (j) { resolve(ui.geoToComuna(j && j.address, comunas, rules)); })
          .catch(function () { resolve(null); });
      }, function () { resolve(null); }, { timeout: 10000 });
    });
  }

  function getVariantIdFrom(doc) {
    var el = doc.querySelector('form[name="buy"] [name="variant_id"], form[name="buy"] [name="variant"]');
    return el && el.value ? el.value : null;
  }

  function autoStart(win) {
    var doc = win.document;
    var cfgEl = doc.getElementById('eta-config');
    if (!cfgEl || !win.Eta) return;
    var E = win.Eta;
    var storage = null;
    try { storage = win.localStorage; } catch (e) { storage = null; }
    var config = readConfig(cfgEl.dataset, E.Comunas, E.Rules);
    var app = start({
      doc: doc, win: win, config: config, comunas: E.Comunas, rules: E.Rules, ui: E.UI,
      store: E.Store.createStore({ storage: storage, eventTarget: doc }),
      data: E.Data.createData({
        rules: E.Rules, fetch: win.fetch.bind(win), storage: storage,
        getCart: function () { return getCartPromise(win); },
        now: function () { return Date.now(); },
        origin: config.origin, box: config.box, services: config.services,
      }),
      now: function () { return new Date(); },
      getVariantId: function () { return getVariantIdFrom(doc); },
      geolocate: function () { return geolocate(win, E.Comunas, E.Rules, E.UI); },
    });
    app.update();
  }

  if (typeof window !== 'undefined' && typeof module === 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoStart(window); });
    else autoStart(window);
  }

  return { readConfig: readConfig, start: start, getVariantIdFrom: getVariantIdFrom };
});
```

The tests pass `noInterval: true` so the 60 s interval is not registered and `node --test` can exit.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS, and the process exits (no hanging interval).

- [ ] **Step 5: Write `scripts/build.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = ['eta-comunas.js', 'eta-rules.js', 'eta-store.js', 'eta-data.js', 'eta-ui.js', 'eta-boot.js'];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const parts = ORDER.map(f => `/* ${f} */\n` + readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'));
const out = `/*! jumpseller-delivery-estimate v${pkg.version} */\n` + parts.join('\n');
mkdirSync(new URL('../theme-kit/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('../theme-kit/assets/eta-widget.js', import.meta.url), out);
console.log(`theme-kit/assets/eta-widget.js ${(out.length / 1024).toFixed(1)} KB`);
```

- [ ] **Step 6: Build and smoke-test the bundle in jsdom**

Run: `npm run build && node -e "const {JSDOM}=require('jsdom');const fs=require('fs');const d=new JSDOM('<div></div>',{runScripts:'outside-only'});d.window.eval(fs.readFileSync('theme-kit/assets/eta-widget.js','utf8'));const E=d.window.Eta;console.log(Object.keys(E).sort().join(','), E.Comunas.length)"`
Expected: `Boot,Comunas,Data,Rules,Store,UI 3xx`.

- [ ] **Step 7: Commit**

```bash
git add src/eta-boot.js scripts/build.mjs test/boot.test.mjs theme-kit/assets/eta-widget.js
git commit -m "Wire modules together and build the theme bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Theme kit (partials, options, CSS, install guide)

**Files:**
- Create: `theme-kit/partials/eta_config.liquid`, `theme-kit/partials/eta_selector.liquid`, `theme-kit/partials/eta_widget.liquid`, `theme-kit/config/options-group.json`, `theme-kit/assets/eta-widget.css`, `theme-kit/INSTALL.md`, `test/kit.test.mjs`

**Interfaces:**
- Consumes: markup contract from Task 6; `readConfig` dataset keys from Task 7 (`origin, cutoff, days, holidays, flatComunas, flatTable, countdown, box, services` → HTML attributes `data-origin`, `data-cutoff`, `data-days`, `data-holidays`, `data-flat-comunas`, `data-flat-table`, `data-countdown`, `data-box`, `data-services`).
- Produces: theme option ids prefixed `eta_` (listed in `options-group.json`).

- [ ] **Step 1: Write the failing test** — `test/kit.test.mjs` (keeps the kit and the JS in sync)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Rules = require('../src/eta-rules.js');
const Comunas = require('../src/eta-comunas.js');

const read = p => readFileSync(new URL('../theme-kit/' + p, import.meta.url), 'utf8');
const group = JSON.parse(read('config/options-group.json'));
const opts = Object.values(group)[0].options;

test('options group is off by default and every option is prefixed eta_', () => {
  assert.equal(opts.eta_enabled.default, false);
  for (const id of Object.keys(opts)) assert.match(id, /^eta_/);
});

test('every option referenced in the partials exists', () => {
  const liquid = read('partials/eta_config.liquid') + read('partials/eta_selector.liquid') + read('partials/eta_widget.liquid');
  const used = new Set([...liquid.matchAll(/options\.(eta_[a-z_]+)/g)].map(m => m[1]));
  for (const id of used) assert.ok(opts[id], `missing option ${id}`);
});

test('config partial exposes every dataset key readConfig needs', () => {
  const cfg = read('partials/eta_config.liquid');
  for (const attr of ['data-origin', 'data-cutoff', 'data-days', 'data-holidays', 'data-flat-comunas',
    'data-flat-table', 'data-countdown', 'data-box', 'data-services']) {
    assert.ok(cfg.includes(attr + '='), `missing ${attr}`);
  }
});

test('default flat-rate comunas are the 32 comunas of Provincia de Santiago and all resolve', () => {
  const warnings = [];
  const names = Rules.parseList(opts.eta_flat_comunas.default);
  assert.equal(names.length, 32);
  assert.equal(Rules.resolveComunas(names, Comunas, w => warnings.push(w)).length, 32, warnings.join('; '));
});

test('default table, cutoff and services parse cleanly', () => {
  const warnings = [];
  assert.equal(Rules.parseTable(opts.eta_flat_table.default, w => warnings.push(w)).length, 2);
  assert.equal(Rules.parseCutoff(opts.eta_cutoff.default, w => warnings.push(w)), 840);
  assert.equal(Rules.parseServices(opts.eta_services.default).length, 4);
  assert.deepEqual(warnings, []);
});

test('default holidays are valid ISO dates', () => {
  for (const d of Rules.parseList(opts.eta_holidays.default)) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(d + 'T12:00:00Z').toISOString().slice(0, 10), d);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `ENOENT ... theme-kit/config/options-group.json`.

- [ ] **Step 3: Create `theme-kit/config/options-group.json`**

List defaults are comma-separated so they work whether the field type is a single-line `input` or a `textarea` (the parser accepts both). Holidays: Chile 2026–2027 (verify against the official calendar before enabling in production; merchant-editable).

```json
{
  "delivery-estimate": {
    "name": "Envío estimado",
    "icon": "truck",
    "help": "Muestra en la página de producto cuánto cuesta el envío y cuándo llega, y agrega un selector de comuna en la barra superior.",
    "options": {
      "eta_enabled": { "name": "Activar envío estimado", "type": "checkbox", "default": false },
      "eta_origin_comuna": { "name": "Comuna de origen (bodega)", "type": "input", "default": "Santiago", "visible_if": "{{ options.eta_enabled }}" },
      "eta_cutoff": { "name": "Hora de corte (HH:MM)", "type": "input", "default": "14:00", "help": "Antes de esta hora se promete despacho el mismo día.", "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_mon": { "name": "Despacha lunes", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_tue": { "name": "Despacha martes", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_wed": { "name": "Despacha miércoles", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_thu": { "name": "Despacha jueves", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_fri": { "name": "Despacha viernes", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_sat": { "name": "Despacha sábado", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_day_sun": { "name": "Despacha domingo", "type": "checkbox", "default": false, "visible_if": "{{ options.eta_enabled }}" },
      "eta_holidays": {
        "name": "Feriados (AAAA-MM-DD)", "type": "textarea",
        "default": "2026-01-01, 2026-04-03, 2026-04-04, 2026-05-01, 2026-05-21, 2026-06-21, 2026-06-29, 2026-07-16, 2026-08-15, 2026-09-18, 2026-09-19, 2026-10-12, 2026-10-31, 2026-11-01, 2026-12-08, 2026-12-25, 2027-01-01, 2027-03-26, 2027-03-27, 2027-05-01, 2027-05-21, 2027-06-21, 2027-06-28, 2027-07-16, 2027-08-15, 2027-09-18, 2027-09-19, 2027-10-11, 2027-10-31, 2027-11-01, 2027-12-08, 2027-12-25",
        "help": "Separados por coma o uno por línea.", "visible_if": "{{ options.eta_enabled }}"
      },
      "eta_flat_comunas": {
        "name": "Comunas con tarifa plana", "type": "textarea",
        "default": "Santiago, Cerrillos, Cerro Navia, Conchalí, El Bosque, Estación Central, Huechuraba, Independencia, La Cisterna, La Florida, La Granja, La Pintana, La Reina, Las Condes, Lo Barnechea, Lo Espejo, Lo Prado, Macul, Maipú, Ñuñoa, Pedro Aguirre Cerda, Peñalolén, Providencia, Pudahuel, Quilicura, Quinta Normal, Recoleta, Renca, San Joaquín, San Miguel, San Ramón, Vitacura",
        "help": "Separadas por coma o una por línea. Tildes y mayúsculas no importan.", "visible_if": "{{ options.eta_enabled }}"
      },
      "eta_flat_table": {
        "name": "Tabla de tarifa plana", "type": "textarea", "default": "30 = 2000, * = 4000",
        "help": "Formato: peso máximo en kg = precio. * significa sin límite. Ej: 5 = 1500, 30 = 2000, * = 4000", "visible_if": "{{ options.eta_enabled }}"
      },
      "eta_countdown": { "name": "Mostrar cuenta regresiva antes del corte", "type": "checkbox", "default": true, "visible_if": "{{ options.eta_enabled }}" },
      "eta_box_length": { "name": "Caja por defecto: largo (cm)", "type": "input", "default": "30", "visible_if": "{{ options.eta_enabled }}" },
      "eta_box_width": { "name": "Caja por defecto: ancho (cm)", "type": "input", "default": "20", "visible_if": "{{ options.eta_enabled }}" },
      "eta_box_height": { "name": "Caja por defecto: alto (cm)", "type": "input", "default": "10", "visible_if": "{{ options.eta_enabled }}" },
      "eta_services": {
        "name": "Servicios de courier a domicilio", "type": "textarea", "default": "starken:20, correos_chile:24, bluexpress:EX, bluexpress:PY",
        "help": "empresa:código. Solo estos servicios se usan para el precio \"desde\".", "visible_if": "{{ options.eta_enabled }}"
      }
    }
  }
}
```

- [ ] **Step 4: Create the partials**

`theme-kit/partials/eta_config.liquid`:

```liquid
{% comment %}
  Delivery estimate — config + shared comuna panel. Render once in templates/layout.liquid.
  Options: Opciones del tema > Envío estimado.
{% endcomment %}
{% if options.eta_enabled %}
  <div id="eta-config" hidden
    data-origin="{{ options.eta_origin_comuna | escape }}"
    data-cutoff="{{ options.eta_cutoff | escape }}"
    data-days="{% if options.eta_day_sun %}0,{% endif %}{% if options.eta_day_mon %}1,{% endif %}{% if options.eta_day_tue %}2,{% endif %}{% if options.eta_day_wed %}3,{% endif %}{% if options.eta_day_thu %}4,{% endif %}{% if options.eta_day_fri %}5,{% endif %}{% if options.eta_day_sat %}6{% endif %}"
    data-holidays="{{ options.eta_holidays | escape }}"
    data-flat-comunas="{{ options.eta_flat_comunas | escape }}"
    data-flat-table="{{ options.eta_flat_table | escape }}"
    data-countdown="{% if options.eta_countdown %}1{% endif %}"
    data-box="{{ options.eta_box_length }}x{{ options.eta_box_width }}x{{ options.eta_box_height }}"
    data-services="{{ options.eta_services | escape }}"></div>
  <div class="eta-panel" data-eta-panel hidden>
    <div class="eta-panel__backdrop" data-eta-close></div>
    <div class="eta-panel__sheet" role="dialog" aria-modal="true" aria-labelledby="eta-panel-title">
      <button type="button" class="eta-panel__x" data-eta-close aria-label="Cerrar">×</button>
      <p class="eta-panel__title" id="eta-panel-title">¿Dónde lo recibes?</p>
      <input class="eta-panel__search" type="search" placeholder="Busca tu comuna" autocomplete="off">
      <button type="button" class="eta-panel__geo" data-eta-geo>📍 Usar mi ubicación</button>
      <p class="eta-panel__msg" data-eta-msg hidden></p>
      <ul class="eta-panel__list" role="listbox"></ul>
    </div>
  </div>
{% endif %}
```

`theme-kit/partials/eta_selector.liquid` (reuses the theme's top-bar link classes so it looks native):

```liquid
{% if options.eta_enabled %}
  <button type="button" class="button header__link eta-selector" data-eta-open aria-haspopup="dialog">
    <i class="theme-icon ph ph-map-pin header__icon" aria-hidden="true"></i>
    <span class="header__text" data-eta-label>¿Dónde lo recibes?</span>
    <i class="theme-icon ph ph-caret-down header__angle" aria-hidden="true"></i>
  </button>
{% endif %}
```

`theme-kit/partials/eta_widget.liquid`:

```liquid
{% if options.eta_enabled %}
  <div class="eta-widget eta-widget--loading" data-eta-widget data-product-id="{{ prod.id }}" aria-live="polite">
    <span class="eta-widget__icon" aria-hidden="true">🚚</span>
    <div class="eta-widget__body">
      <p class="eta-widget__title"><span class="eta-widget__skeleton" aria-hidden="true"></span></p>
      <p class="eta-widget__meta">&nbsp;</p>
    </div>
  </div>
{% endif %}
```

- [ ] **Step 5: Create `theme-kit/assets/eta-widget.css`**

Colors inherit from the theme (`currentColor`, `inherit`) so the widget adopts each store's palette.

```css
.eta-widget {
  display: flex; gap: 12px; align-items: flex-start;
  margin: 12px 0; padding: 12px 14px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: var(--theme-border-radius, 8px);
  font-size: 0.95rem; line-height: 1.35;
}
.eta-widget__icon { font-size: 1.25rem; line-height: 1.2; }
.eta-widget__body { flex: 1; min-width: 0; }
.eta-widget__body p { margin: 0; }
.eta-widget__title strong { font-weight: 700; }
.eta-widget__meta { margin-top: 2px !important; opacity: 0.8; font-size: 0.875rem; min-height: 1.2em; }
.eta-widget__countdown { margin-top: 4px !important; font-size: 0.875rem; font-weight: 600; }
.eta-widget__change, .eta-panel__geo, .eta-panel__x {
  background: none; border: 0; padding: 0; color: inherit; font: inherit;
  text-decoration: underline; cursor: pointer;
}
.eta-widget__skeleton {
  display: inline-block; width: 9em; height: 0.9em; vertical-align: middle; border-radius: 4px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  animation: eta-pulse 1.2s ease-in-out infinite;
}
@keyframes eta-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .eta-widget__skeleton { animation: none; } }

.eta-panel[hidden] { display: none; }
.eta-panel { position: fixed; inset: 0; z-index: 1100; }
.eta-panel__backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.35); }
.eta-panel__sheet {
  position: absolute; top: 72px; right: 24px; width: min(360px, calc(100vw - 32px));
  max-height: calc(100vh - 96px); overflow: auto;
  background: var(--theme-background, #fff); color: var(--theme-text, #111);
  border-radius: var(--theme-border-radius, 12px); padding: 16px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.eta-panel__x { position: absolute; top: 8px; right: 12px; font-size: 1.5rem; text-decoration: none; }
.eta-panel__title { margin: 0 0 10px; font-weight: 700; }
.eta-panel__search {
  width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 8px;
  background: transparent; color: inherit;
}
.eta-panel__geo { display: block; margin: 10px 0 4px; }
.eta-panel__msg { margin: 6px 0 0; font-size: 0.875rem; opacity: 0.8; }
.eta-panel__list { list-style: none; margin: 8px 0 0; padding: 0; }
.eta-panel__list button {
  width: 100%; text-align: left; padding: 10px 8px; border: 0; background: none;
  color: inherit; font: inherit; border-radius: 6px; cursor: pointer;
}
.eta-panel__list button:hover, .eta-panel__list button:focus-visible {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

@media (max-width: 991.98px) {
  .eta-panel__sheet {
    top: auto; right: 0; bottom: 0; left: 0; width: 100%;
    max-height: 80vh; border-radius: 16px 16px 0 0;
  }
}
```

- [ ] **Step 6: Create `theme-kit/INSTALL.md`**

````markdown
# Installing in a Jumpseller 4.x theme

Everything is gated by the `eta_enabled` theme option (off by default): uploading the files changes nothing until it is turned on.

## 1. Copy files

| From `theme-kit/` | To theme |
|---|---|
| `assets/eta-widget.js`, `assets/eta-widget.css` | `assets/` |
| `partials/eta_config.liquid`, `eta_selector.liquid`, `eta_widget.liquid` | `partials/` |

Merge the object inside `config/options-group.json` into the theme's `config/options.json`, as a new top-level group placed before `translations`.

If the theme's `options.json` has no option with `"type": "textarea"` (check with `grep -o '"type": *"[a-z_]*"' config/options.json | sort | uniq -c`), change the four `textarea` options to `"input"`. Defaults are comma-separated and parse the same either way.

## 2. One-line edits

| File | Where | Insert |
|---|---|---|
| `templates/layout.liquid` | inside `<head>`, after the theme's main CSS link | `{% if options.eta_enabled %}<link rel="stylesheet" href="{{ 'eta-widget.css' \| asset }}">{% endif %}` |
| `templates/layout.liquid` | right before `</body>` | `{% render 'eta_config' %}{% if options.eta_enabled %}<script src="{{ 'eta-widget.js' \| asset }}" defer></script>{% endif %}` |
| top-bar partial (find with `grep -rln "header-dropdown-languages" partials components`) | inside `ul.header__menu`, before the languages `<li>` | `<li class="header__item d-none d-lg-flex">{% render 'eta_selector' %}</li>` |
| `components/product-form.liquid` | right after `<!-- end .product-form__wrapper -->` | `{% if template == 'product' %}{% render 'eta_widget', prod: prod %}{% endif %}` |

## 3. Upload and enable

```bash
jumpseller theme watch <theme-id> theme -s STORE.jumpseller.com   # keep running
touch theme/assets/eta-widget.js   # repeat for each changed file, 1–2 s apart; read stdout for Liquid errors
```

Enable in admin → Themes → Options → "Envío estimado" → "Activar envío estimado".
````

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS (including the 32-comunas default check).

- [ ] **Step 8: Commit**

```bash
git add theme-kit test/kit.test.mjs
git commit -m "Add theme kit: partials, options group, styles and install guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Install on the test store and verify end to end

Run by the controller session (needs the `jumpseller` CLI with store access and a browser). **Prerequisite:** the user has run `jumpseller access add alejandrotest.jumpseller.com` (interactive).

**Files:**
- Modify (in the gitignored `theme/` export, not committed): the four files listed in `theme-kit/INSTALL.md`.
- Create: `docs/verification.md` (results, screenshots referenced by relative path, no merchant name).

- [ ] **Step 1: Export the active theme**

```bash
jumpseller theme list -s alejandrotest.jumpseller.com
jumpseller theme export <active-id> theme -s alejandrotest.jumpseller.com
```

- [ ] **Step 2: Confirm the variant input name**

Run: `grep -rn 'name="variant' theme/components/product-form.liquid theme/partials | head`
If the form uses a name other than `variant_id` or `variant`, update the selector in `getVariantIdFrom` (`src/eta-boot.js`), add a test for it in `test/boot.test.mjs`, rebuild, and commit before continuing.

- [ ] **Step 3: Apply `theme-kit/INSTALL.md` to `theme/`**, start `jumpseller theme watch`, touch each changed file, and confirm stdout shows no Liquid errors.

- [ ] **Step 4: Verify flag off = no change**

Run: `curl -s https://alejandrotest.jumpseller.com/farinha-1kg | grep -c 'eta-'`
Expected: `0`.

- [ ] **Step 5: Enable** `eta_enabled` in the theme options (admin UI) and verify with Playwright at 1280 px and 375 px:

| Scenario | Expected |
|---|---|
| Fresh browser, product page | "Envío a todo Chile" + "📍 ¿Dónde lo recibes?"; top bar shows "¿Dónde lo recibes?" (desktop) |
| Pick Providencia in panel | Widget → "Llega hoy/mañana por $2.000"; top bar → "Enviar a Providencia"; reload keeps it |
| Add product until cart > 30 kg | Widget → $4.000 without reload |
| Pick Temuco | Skeleton, then "Envío a Temuco desde $X" with no day promise; X equals the cheapest home-delivery service |
| Clock mocked (`page.clock`) Sat 15:00 | Flat comuna shows "Llega el lunes" |
| 375 px | "Cambiar" opens the bottom sheet; `document.documentElement.scrollWidth <= 375` |
| Console | No errors from `eta-widget.js` |

- [ ] **Step 6: Record results** in `docs/verification.md` (table above with pass/fail and notes), then commit:

```bash
git add docs/verification.md
git commit -m "Record end-to-end verification on the test store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
