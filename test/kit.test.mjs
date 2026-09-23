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
