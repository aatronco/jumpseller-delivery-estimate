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
  { id: '8261162', name: 'Aisén', region: '02' },
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

test('searchComunas: Aysen alias matches the official Aisén name', () => {
  assert.deepEqual(UI.searchComunas('Aysen', COMUNAS, Rules).map(c => c.name), ['Aisén']);
});

test('geoToComuna uses the zoom-10 object name first (the comuna boundary)', () => {
  assert.equal(UI.geoToComuna({ name: 'Providencia', address: { city: 'Santiago' } }, COMUNAS, Rules).name, 'Providencia');
  assert.equal(UI.geoToComuna({ name: 'Ñuñoa' }, COMUNAS, Rules).name, 'Ñuñoa');
});

test('geoToComuna falls back to the most specific address field that is a comuna', () => {
  assert.equal(UI.geoToComuna({ name: 'Región Metropolitana', address: { suburb: 'Providencia', city: 'Santiago' } }, COMUNAS, Rules).name, 'Providencia');
  assert.equal(UI.geoToComuna({ address: { city: 'Temuco' } }, COMUNAS, Rules).name, 'Temuco');
  assert.equal(UI.geoToComuna({ name: 'Región de la Araucanía', address: { state: 'Región de la Araucanía' } }, COMUNAS, Rules), null);
  assert.equal(UI.geoToComuna(null, COMUNAS, Rules), null);
});

test('geoToComuna maps the Aysen alias to the official Aisén comuna', () => {
  assert.equal(UI.geoToComuna({ name: 'Aysén' }, COMUNAS, Rules).name, 'Aisén');
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

test('renderWidget with an unchanged state does not replace the DOM', () => {
  const doc = dom();
  const w = doc.getElementById('w');
  const state = { kind: 'priced', comuna: PROV, price: 2000, source: 'courier', promise: null };
  UI.renderWidget(w, state, Rules);
  const first = w.firstChild;
  UI.renderWidget(w, { ...state }, Rules);
  assert.equal(w.firstChild, first);
  UI.renderWidget(w, { ...state, price: 3000 }, Rules);
  assert.notEqual(w.firstChild, first);
});

test('mountPanel: closing restores focus to the opener', () => {
  const doc = dom();
  const opener = doc.createElement('button');
  doc.body.appendChild(opener);
  opener.focus();
  const panel = doc.querySelector('[data-eta-panel]');
  const api = UI.mountPanel(panel, { comunas: COMUNAS, rules: Rules, onPick: () => {}, geolocate: async () => null });
  api.open();
  assert.equal(doc.activeElement, panel.querySelector('.eta-panel__search'));
  api.close();
  assert.equal(doc.activeElement, opener);
});
