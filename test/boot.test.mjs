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

test('getVariantIdFrom reads product-form\'s variant.id', () => {
  const { window } = new JSDOM('<product-form></product-form>');
  window.document.querySelector('product-form').variant = { id: 77 };
  assert.equal(Boot.getVariantIdFrom(window.document), '77');
});

test('getVariantIdFrom returns null when product-form has no variant and no inputs', () => {
  const { window } = new JSDOM('<product-form></product-form>');
  window.document.querySelector('product-form').variant = null;
  assert.equal(Boot.getVariantIdFrom(window.document), null);
});

test('getVariantIdFrom falls back to the buy form input when there is no product-form', () => {
  const { window } = new JSDOM('<form name="buy"><input name="variant_id" value="5"></form>');
  assert.equal(Boot.getVariantIdFrom(window.document), '5');
});

test('a delegated change event inside product-form re-renders after a tick', async () => {
  const { window } = new JSDOM(`
    <span data-eta-label></span>
    <product-form><select name="v"><option value="a">A</option></select></product-form>
    <div data-eta-widget data-product-id="1"></div>
    <span class="theme-cart-counter" data-products-count="0">0</span>
    <div class="eta-panel" data-eta-panel hidden><div data-eta-close></div>
      <input class="eta-panel__search"><button data-eta-geo></button><p data-eta-msg hidden></p><ul class="eta-panel__list"></ul></div>`);
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[1]);
  let calls = 0;
  const data = {
    weightFor: async () => (++calls === 1 ? 1 : 40),
    quote: async () => [],
  };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  const w = window.document.querySelector('[data-eta-widget]');
  assert.match(w.textContent, /\$2\.000/);
  const select = window.document.querySelector('product-form select');
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 10));
  assert.match(w.textContent, /\$4\.000/);
});

test('a rejected weightFor resolves update() and shows the checkout fallback', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[1]);
  const data = { weightFor: async () => { throw new Error('boom'); }, quote: async () => [] };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  assert.match(window.document.querySelector('[data-eta-widget]').textContent, /se calcula en el checkout/);
});

test('a courier quote below the flat rate shows the courier price without a day promise', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[1]);
  const data = { weightFor: async () => 1, quote: async () => [{ amount: 1500 }] };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => new Date('2026-09-23T15:00:00Z'), getVariantId: () => null, noInterval: true });
  await app.update();
  const text = window.document.querySelector('[data-eta-widget]').textContent;
  assert.match(text, /Envío a Providencia desde \$1\.500/);
  assert.doesNotMatch(text, /Llega/);
});

test('refreshPromise re-renders the day promise without re-fetching weight or quotes', async () => {
  const { window } = page();
  const store = Store.createStore({ storage: null, eventTarget: window.document });
  store.set(COMUNAS[1]);
  let weights = 0, quotes = 0;
  let now = new Date('2026-09-23T15:00:00Z'); // 12:00 in Santiago, before cutoff
  const data = { weightFor: async () => { weights++; return 1; }, quote: async () => { quotes++; return []; } };
  const app = Boot.start({ doc: window.document, win: window, config: CONFIG, comunas: COMUNAS, rules: Rules, ui: UI,
    store, data, now: () => now, getVariantId: () => null, noInterval: true });
  await app.update();
  const w = window.document.querySelector('[data-eta-widget]');
  assert.match(w.textContent, /Llega hoy/);
  now = new Date('2026-09-23T18:00:00Z'); // 15:00, past cutoff
  app.refreshPromise();
  assert.match(w.textContent, /Llega mañana por \$2\.000/);
  assert.equal(weights, 1);
  assert.equal(quotes, 1);
});

test('getVariantIdFrom prefers the product-form that contains the widget', () => {
  const { window } = new JSDOM('<product-form id="a"></product-form><product-form id="b"><div data-eta-widget></div></product-form>');
  window.document.getElementById('a').variant = { id: 1 };
  window.document.getElementById('b').variant = { id: 2 };
  const widget = window.document.querySelector('[data-eta-widget]');
  assert.equal(Boot.getVariantIdFrom(window.document, widget), '2');
  assert.equal(Boot.getVariantIdFrom(window.document), '1');
});
