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
