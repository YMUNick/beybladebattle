import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const BBEngines = require('../js/tournament-engines.js');

test('registry exposes three engines', () => {
  assert.ok(BBEngines.get('round_robin'));
  assert.ok(BBEngines.get('single_elim'));
  assert.ok(BBEngines.get('swiss'));
});

test('nextPow2 and seedOrder helpers', () => {
  assert.equal(BBEngines._util.nextPow2(6), 8);
  assert.equal(BBEngines._util.nextPow2(4), 4);
  assert.deepEqual(BBEngines._util.seedOrder(4), [1, 4, 3, 2]);
  assert.deepEqual(BBEngines._util.seedOrder(8), [1, 8, 5, 4, 3, 6, 7, 2]);
});
