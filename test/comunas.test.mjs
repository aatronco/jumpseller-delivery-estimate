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

test('no inline comments or URLs in names', () => {
  for (const c of Comunas) {
    assert.ok(!c.name.includes('#'), `name contains #: ${c.name}`);
    assert.ok(!c.name.includes('http'), `name contains http: ${c.name}`);
  }
});

test('Santiago Centro was renamed to Santiago, Aisén preserved', () => {
  const byName = Object.fromEntries(Comunas.map(c => [c.name, c]));
  assert.ok(byName['Santiago'], 'Santiago should exist');
  assert.equal(byName['Santiago'].id, '8261395', 'Santiago should have id 8261395');
  assert.ok(!byName['Santiago Centro'], 'Santiago Centro should not exist');
  assert.equal(byName['Aisén'].id, '8261162', 'Aisén should have id 8261162');
});
