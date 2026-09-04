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

function ps(n) { var a = []; for (var i = 1; i <= n; i++) a.push({ id: 'p' + i, name: 'P' + i }); return a; }

test('round robin: 4 players -> 3 rounds, 6 matches, everyone plays everyone once', () => {
  const rr = BBEngines.get('round_robin');
  const players = ps(4);
  const st = rr.init(players, {});
  assert.equal(st.rounds.length, 3);
  let total = 0; const pairs = new Set();
  st.rounds.forEach(rd => rd.matches.forEach(m => {
    total++;
    pairs.add([m.p1, m.p2].sort().join('-'));
  }));
  assert.equal(total, 6);
  assert.equal(pairs.size, 6);
});

test('round robin: odd players get one bye per round', () => {
  const rr = BBEngines.get('round_robin');
  const st = rr.init(ps(3), {});
  assert.equal(st.rounds.length, 3);
  st.rounds.forEach(rd => {
    const byes = rd.matches.filter(m => m.bye);
    assert.equal(byes.length, 1);
  });
});

test('round robin: recording results produces standings and champion when complete', () => {
  const rr = BBEngines.get('round_robin');
  const players = ps(4);
  let st = rr.init(players, {});
  // p1 wins all its matches, others lose to p1
  st.rounds.forEach(rd => rd.matches.forEach(m => {
    if (m.bye) return;
    const winner = (m.p1 === 'p1' || m.p2 === 'p1') ? 'p1' : m.p1;
    st = rr.recordResult(st, players, m.id, winner);
  }));
  assert.equal(rr.isComplete(st), true);
  assert.equal(rr.champion(st, players), 'p1');
  const table = rr.standings(st, players);
  assert.equal(table[0].playerId, 'p1');
  assert.equal(table[0].rank, 1);
});

test('single elim: 4 players -> 2 rounds, champion after final', () => {
  const se = BBEngines.get('single_elim');
  const players = ps(4);
  let st = se.init(players, { seed: 'input' });
  assert.equal(st.rounds.length, 2);
  assert.equal(st.rounds[0].matches.length, 2);
  // decide semifinals
  st.rounds[0].matches.forEach(m => { st = se.recordResult(st, players, m.id, m.p1); });
  // final now has both players filled
  const finalMatch = st.rounds[1].matches[0];
  assert.ok(finalMatch.p1 && finalMatch.p2);
  st = se.recordResult(st, players, finalMatch.id, finalMatch.p1);
  assert.equal(se.isComplete(st), true);
  assert.equal(se.champion(st, players), finalMatch.p1);
});

test('single elim: 6 players -> byes auto-advance top seeds', () => {
  const se = BBEngines.get('single_elim');
  const players = ps(6);
  const st = se.init(players, { seed: 'input' });
  assert.equal(st.rounds.length, 3); // bracket size 8
  const byes = st.rounds[0].matches.filter(m => m.bye);
  assert.equal(byes.length, 2);
  byes.forEach(m => assert.ok(m.winner)); // bye winner set
});

test('single elim: undo a semifinal clears the final slot', () => {
  const se = BBEngines.get('single_elim');
  const players = ps(4);
  let st = se.init(players, { seed: 'input' });
  const sf = st.rounds[0].matches[0];
  st = se.recordResult(st, players, sf.id, sf.p1);
  assert.ok(st.rounds[1].matches[0].p1 || st.rounds[1].matches[0].p2);
  st = se.undoResult(st, players, sf.id);
  const finalM = st.rounds[1].matches[0];
  assert.ok(!finalM.p1 || !finalM.p2); // one slot cleared
});
