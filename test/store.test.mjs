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
