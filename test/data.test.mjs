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

test('network errors resolve null now and are cached as [] for the short TTL', async () => {
  let n = 0;
  const { data, tick } = setup({ fetch: async () => { n++; throw new TypeError('Failed to fetch'); } });
  assert.equal(await data.quote(TEMUCO, 1), null);
  assert.deepEqual(await data.quote(TEMUCO, 1), []);
  assert.equal(n, 1);
  tick(10 * 60e3 + 1);
  assert.equal(await data.quote(TEMUCO, 1), null);
  assert.equal(n, 2);
});

test('non-2xx responses are cached as [] for the short TTL', async () => {
  let n = 0;
  const { data } = setup({ fetch: async () => { n++; return { ok: false, status: 500, json: async () => ({}) }; } });
  assert.equal(await data.quote(TEMUCO, 1), null);
  assert.deepEqual(await data.quote(TEMUCO, 1), []);
  assert.equal(n, 1);
});

test('the quote cache key changes with origin, box and services', () => {
  const storage = memoryStorage();
  const keys = [];
  const spy = { getItem: k => { keys.push(k); return storage.getItem(k); }, setItem: storage.setItem };
  const make = over => D.createData({
    rules: Rules, fetch: async () => ({ ok: true, json: async () => [] }), storage: spy,
    getCart: async () => null, now: () => 0, origin: { id: '8261395', region: '12' },
    box: { length: 30, width: 20, height: 10 }, services: ['starken:20'], ...over,
  });
  make({}).quote(TEMUCO, 1);
  make({ origin: { id: '8261414', region: '12' } }).quote(TEMUCO, 1);
  make({ box: { length: 40, width: 20, height: 10 } }).quote(TEMUCO, 1);
  make({ services: ['starken:20', 'bluexpress:EX'] }).quote(TEMUCO, 1);
  assert.equal(new Set(keys).size, 4);
  assert.equal(keys[0], 'eta:q:8261395:30x20x10:starken:20|8261311|1');
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
