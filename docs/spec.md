# Jumpseller Delivery Estimate — Design Spec

Date: 2026-09-23 · Status: approved design, pending implementation plan

## 1. Goal

On the product page of a Jumpseller 4.x store, tell the shopper what shipping will cost and when it arrives, without asking them to fill a form:

> 🚚 Llega **mañana** por **$2.000**

The price shown must match what the shopper will see at checkout. A merchant can adjust every business rule from theme options, without touching code.

### Out of scope

- Per-card estimates on product listings (`product_block`). Rejected: one courier quote per card is too slow.
- Delivery-day promises for courier shipments (the quote API returns no transit time).
- Agency / branch pickup prices.
- A reusable Jumpseller App. Can be extracted later if other merchants ask.

## 2. Business rules

All values below are **initial defaults**; each one is a theme option (§5).

| Rule | Default |
|---|---|
| Flat-rate destinations | The 32 comunas of Provincia de Santiago |
| Flat-rate price | ≤ 30 kg → $2.000; > 30 kg → $4.000 |
| Other destinations | Live courier quotes only |
| Price shown | `min(flat rate if applicable, home-delivery courier quotes)` |
| Weight used | Cart weight + current variant weight (variant not added twice if already in cart) |
| Cutoff | 14:00, `America/Santiago` |
| Dispatch days | Monday–Saturday, excluding holidays |
| Day promise | Only when the flat rate wins. Couriers show price only: "Envío a Temuco desde $4.470" |

### Day promise (`promiseDay`)

- Dispatch day = enabled weekday that is not a listed holiday.
- Today is a dispatch day and now < cutoff → **"hoy"** + countdown to cutoff.
- Otherwise the next dispatch day → **"mañana"** if it is tomorrow, else the weekday name (**"el lunes"**).
- Time is computed with `Intl.DateTimeFormat` in `America/Santiago`, never the device timezone.

## 3. Surfaces

### 3.1 Address selector — top bar

- Lives in the top bar right column (`ul.header__menu`), next to the language/currency dropdowns, reusing their markup (`header__item` + `theme-dropdown`).
- Label: `📍 Enviar a Providencia ▾` (or `📍 ¿Dónde lo recibes?` with no comuna saved).
- Opens: comuna search with autocomplete + "Usar mi ubicación" (browser geolocation → reverse geocode → comuna).
- The only place a comuna is chosen and saved. Emits `eta:comuna-changed`.
- That column is hidden below `lg`; on mobile the same selector opens as a bottom sheet from the product widget's "Cambiar" link.

### 3.2 Product widget — product page

Rendered by `partials/eta_widget.liquid` from `components/product-form.liquid`.

| # | State | Content |
|---|---|---|
| 1 | No comuna saved | "Envío a todo Chile" · "📍 ¿Dónde lo recibes?" (opens selector) |
| 2 | Flat rate | "Llega hoy por $2.000" · "a Providencia · Cambiar" · "Compra en las próximas 2 h 15 min" |
| 3 | Quoting | "Envío a Temuco ░░░░" (skeleton reserving final height, no spinner) |
| 4 | Quoted | "Envío a Temuco desde $4.470" · "Cambiar comuna" |
| 5 | No rates / error | "Envío a Temuco: se calcula en el checkout" |

Styling uses the theme's own CSS variables so it inherits each store's colors and fonts. No layout shift above the add-to-cart button.

## 4. Architecture

```
templates/layout.liquid        → loads eta-widget.css / eta-widget.js only if options.eta_enabled
top bar (header partial)       → {% render 'eta_selector' %}
components/product-form.liquid → {% render 'eta_widget', prod: prod %}
partials/eta_widget.liquid     → initial HTML + config as data-* attributes (from theme options)
partials/eta_selector.liquid   → selector markup
assets/eta-widget.js / .css
assets/eta-comunas.json        → comuna name → {id, region} (geographic data, not business rules)
config/options.json            → "Envío estimado" group
```

Follows the proven pattern of the free-shipping widget: partials plus one-line edits to existing `.liquid` files, no new `components/*.json` (blocked by `jumpseller theme watch`), everything gated behind an off-by-default flag.

### JS units

| Unit | Responsibility | Depends on |
|---|---|---|
| `EtaRules` | Pure functions: `flatRate(comunaId, kg, cfg)`, `promiseDay(now, cfg)`, `pickPrice(flat, quotes, cfg)`, `parseTable(text)`, `normalizeComuna(name)` | nothing |
| `EtaStore` | Saved comuna in `localStorage` (try/catch, in-memory fallback); dispatches `eta:comuna-changed` | `localStorage` |
| `EtaData` | Cart + variant weight, courier quote, quote cache | `Jumpseller.getCart`, `estimate_rates.json`, `EtaStore` |
| `EtaWidget` / `EtaSelector` | Render states, bind events | all above |

`EtaRules` receives the current date as an argument so time rules are testable without mocking the clock.

## 5. Theme options — group "Envío estimado"

| Option | Type | Default |
|---|---|---|
| Enable widget | checkbox | off |
| Origin comuna (warehouse) | text | Santiago |
| Cutoff hour | select | 14:00 |
| Dispatch days | 7 checkboxes | Mon–Sat on, Sun off |
| Holidays | textarea, one `YYYY-MM-DD` per line | Chile 2026–2027 |
| Flat-rate comunas | textarea, one name per line | 32 comunas of Provincia de Santiago |
| Flat-rate table | textarea, `max_kg = price` per line, `*` = no limit | `30 = 2000` / `* = 4000` |
| Show countdown | checkbox | on |
| Default box (cm) | 3 texts L/W/H | 30 / 20 / 10 |
| Home-delivery courier services | textarea, `company:code` per line | `starken:20`, `correos_chile:24`, `bluexpress:EX`, `bluexpress:PY` |

- Comuna names are normalized (lowercase, no accents) and mapped to IDs via `eta-comunas.json`; unknown names → `console.warn`, ignored.
- Table lines are sorted by kg; the first tier with `kg <= max_kg` wins.
- Courier services use an allowlist by code, not label matching: new or renamed services are excluded by default.

## 6. Data flow

1. Read saved comuna. None → state 1, stop.
2. `kg = Σ(cart line weight × qty) + variant weight` (skip variant if already in cart).
3. Comuna in flat-rate list → compute flat price, render state 2 immediately. Else → state 3.
4. In parallel, courier quote. Cache key `comuna|ceil(kg to 0.5)`; hit if < 6 h old.
   Miss → `POST https://api.jumpseller.com/landing/estimate_rates.json` with origin, destination (country, region, municipality), one package (default box, `kg`). Keep only allowlisted home-delivery services; parse `"$4.470"` → `4470`.
5. `price = min(flat?, couriers)`; re-render if changed. Day promise only if the flat rate wins.
6. Recompute on: variant `change`, cart re-render (`MutationObserver` on the theme's cart container), `eta:comuna-changed`.

### Verified API facts (spike, 2026-09-23)

- `estimate_rates.json` returns `Access-Control-Allow-Origin: *`; callable from any store domain.
- **Region codes must follow the Jumpseller shipping-regions numbering** (Araucanía `04`, Metropolitana `12`). A wrong region code returns `[]`, not an error.
- Latency 1–7 s per quote.
- `/api/cart.json` (via `Jumpseller.getCart`) returns per-line `weight` (unit) and `qty`; no dimensions.
- `/api/products/:id.json` returns `weight` and `length/width/height` (often `0`).

## 7. Errors and edge cases

| Case | Behavior |
|---|---|
| `localStorage` unavailable | Comuna kept in memory for the visit |
| Product weight 0 | Use 0.5 kg, `console.warn` |
| `getCart` fails / empty cart | Quote with product weight only |
| Courier API > 10 s or error | Flat rate if applicable, else state 5 |
| API returns `[]` | Same as error; cache the empty result 10 min only |
| Unknown comuna name in options | Ignored, `console.warn` |
| Cutoff passes while page is open | Countdown re-evaluates every minute; "hoy" → "mañana" |
| Widget disabled | Neither CSS nor JS loaded; theme unchanged |

## 8. Testing

1. **Unit** — `node --test` against `EtaRules`, no dependencies: 13:59 vs 14:00; Friday after cutoff → Saturday; Saturday after cutoff → Monday; Monday holiday → Tuesday; table parsing and the exact 30 kg boundary; comuna normalization; home-delivery filter; CLP parsing.
2. **Integration** — Playwright on the test store: empty cart vs 29 kg cart + 2 kg product; Santiago vs Temuco; variant change; top-bar comuna change updates the widget; 375 px mobile (bottom sheet, no horizontal scroll); mocked clock for hoy/mañana.
3. **Repo guard** — pre-commit hook blocks the merchant's name and credentials.

## 9. Rollout

1. Export the test store theme, implement, upload with `jumpseller theme watch`, test.
2. Port the same file diff to the merchant's theme, flag off.
3. Enable in theme options after merchant review.

## 10. Open items to confirm with the merchant

- Final flat-rate table; "Santiago" = Provincia de Santiago or all Región Metropolitana.
- Saturday dispatch and its cutoff hour; holiday list ownership.
- Regions: price only vs fixed range ("2–4 días hábiles").
- Default box dimensions.
