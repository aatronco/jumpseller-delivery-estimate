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

test('service codes match case-insensitively', () => {
  assert.deepEqual(R.filterHomeDelivery(RATES, R.parseServices('bluexpress:ex')),
    [{ company: 'bluexpress', label: 'Express', amount: 2979 }]);
  assert.deepEqual(R.filterHomeDelivery(
    [{ fulfillment_company: 'Bluexpress', service_label: 'Express', service_code: 'ex', amount: '$2.979' }],
    R.parseServices('bluexpress:EX')), [{ company: 'Bluexpress', label: 'Express', amount: 2979 }]);
});
