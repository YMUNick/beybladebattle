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

test('single elim: undoing a semifinal invalidates an already-decided final and champion', () => {
  const se = BBEngines.get('single_elim');
  const players = ps(4);
  let st = se.init(players, { seed: 'input' });
  // decide both semifinals (advance p1 of each)
  const sf1 = st.rounds[0].matches[0], sf2 = st.rounds[0].matches[1];
  st = se.recordResult(st, players, sf1.id, sf1.p1);
  st = se.recordResult(st, players, sf2.id, sf2.p1);
  const finalM = st.rounds[1].matches[0];
  // crown the finalist that came from sf2, then undo sf1 (the *other* half)
  st = se.recordResult(st, players, finalM.id, finalM.p2);
  assert.equal(se.isComplete(st), true);
  st = se.undoResult(st, players, sf1.id);
  assert.equal(se.isComplete(st), false, 'final result must be invalidated when a feeder is undone');
  assert.equal(se.champion(st), null);
  assert.equal(st.rounds[1].matches[0].winner, null);
});

test('swiss: fixed number of rounds, round 1 pairs top vs bottom half', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(4);
  const st = sw.init(players, { rounds: 3 });
  assert.equal(st.options.rounds, 3);
  assert.equal(st.rounds.length, 1); // only round 1 generated up front
  assert.equal(st.rounds[0].matches.length, 2);
});

test('swiss: next round is generated only after current round fully recorded, avoids rematches', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(4);
  let st = sw.init(players, { rounds: 2 });
  const r1 = st.rounds[0].matches.map(m => [m.p1, m.p2]);
  st.rounds[0].matches.forEach(m => { st = sw.recordResult(st, players, m.id, m.p1); });
  assert.equal(st.rounds.length, 2); // round 2 now exists
  // no round-2 pairing repeats a round-1 pairing
  st.rounds[1].matches.forEach(m => {
    const repeat = r1.some(pr => (pr[0] === m.p1 && pr[1] === m.p2) || (pr[0] === m.p2 && pr[1] === m.p1));
    assert.equal(repeat, false);
  });
});

test('swiss: odd players -> exactly one bye per round, no repeat bye while avoidable', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(5);
  let st = sw.init(players, { rounds: 2 });
  const byes1 = st.rounds[0].matches.filter(m => m.bye);
  assert.equal(byes1.length, 1);
  st.rounds[0].matches.forEach(m => { if (!m.bye) st = sw.recordResult(st, players, m.id, m.p1); });
  const byeId1 = byes1[0].p1;
  const byes2 = st.rounds[1].matches.filter(m => m.bye);
  assert.equal(byes2.length, 1);
  assert.notEqual(byes2[0].p1, byeId1);
});

test('swiss: undo drops later generated rounds', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(4);
  let st = sw.init(players, { rounds: 2 });
  st.rounds[0].matches.forEach(m => { st = sw.recordResult(st, players, m.id, m.p1); });
  assert.equal(st.rounds.length, 2);
  const firstMatch = st.rounds[0].matches[0];
  st = sw.undoResult(st, players, firstMatch.id);
  assert.equal(st.rounds.length, 1);
  assert.equal(st.rounds[0].matches[0].winner, null);
});

// ---- edge-case regression guards ----

test('round robin: 2 players -> 1 round, 1 match, completes with a champion', () => {
  const rr = BBEngines.get('round_robin');
  const players = ps(2);
  let st = rr.init(players, {});
  assert.equal(st.rounds.length, 1);
  assert.equal(st.rounds[0].matches.length, 1);
  st = rr.recordResult(st, players, st.rounds[0].matches[0].id, 'p1');
  assert.equal(rr.isComplete(st), true);
  assert.equal(rr.champion(st, players), 'p1');
});

test('single elim: non-power-of-two (5 and 7) has correct rounds/byes and plays to a champion', () => {
  const se = BBEngines.get('single_elim');
  [[5, 3, 3], [7, 3, 1]].forEach(function (cfg) {
    const n = cfg[0], expectRounds = cfg[1], expectByes = cfg[2];
    const players = ps(n);
    let st = se.init(players, { seed: 'input' });
    assert.equal(st.rounds.length, expectRounds, n + ' players -> ' + expectRounds + ' rounds');
    assert.equal(st.rounds[0].matches.filter(m => m.bye).length, expectByes, n + ' players -> ' + expectByes + ' byes');
    // play everything: always advance p1 when both slots are filled
    let guard = 0;
    while (!se.isComplete(st) && guard++ < 50) {
      st.rounds.forEach(rd => rd.matches.forEach(m => {
        if (!m.bye && m.winner == null && m.p1 && m.p2) st = se.recordResult(st, players, m.id, m.p1);
      }));
    }
    assert.equal(se.isComplete(st), true, n + ' players completes');
    assert.ok(se.champion(st), n + ' players has champion');
  });
});

test('swiss: rematch fallback pairs everyone even when rematches are unavoidable', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(4);
  // 4 players over 5 rounds forces rematches after round 3
  let st = sw.init(players, { rounds: 5 });
  let guard = 0;
  while (!sw.isComplete(st) && guard++ < 20) {
    const cur = st.rounds[st.rounds.length - 1];
    cur.matches.forEach(m => { if (!m.bye && m.winner == null) st = sw.recordResult(st, players, m.id, m.p1); });
  }
  assert.equal(st.rounds.length, 5);
  assert.equal(sw.isComplete(st), true);
  // every round paired all 4 players (2 matches, no one stranded)
  st.rounds.forEach(rd => {
    const seated = new Set();
    rd.matches.forEach(m => { if (m.p1) seated.add(m.p1); if (m.p2) seated.add(m.p2); });
    assert.equal(seated.size, 4);
  });
});

test('round robin: bye win is excluded from winPct denominator', () => {
  const rr = BBEngines.get('round_robin');
  const players = ps(3); // odd -> each round has one bye
  let st = rr.init(players, {});
  // record only real matches: p1 beats everyone it faces, others lose their real games
  st.rounds.forEach(rd => rd.matches.forEach(m => {
    if (m.bye) return;
    const winner = (m.p1 === 'p1' || m.p2 === 'p1') ? 'p1' : m.p1;
    st = rr.recordResult(st, players, m.id, winner);
  }));
  const table = rr.standings(st, players);
  // a player that got a bye plus a real loss must not show inflated winPct from the bye
  const loser = table.find(r => r.byes === 1 && (r.wins - r.byes) === 0 && r.losses >= 1);
  assert.ok(loser, 'expected a player with a bye and no real win');
  assert.equal(loser.winPct, 0);
});

test('single elim bracket: 2 players -> only a center final, empty sides', () => {
  const se = BBEngines.get('single_elim');
  const b = se.bracket(se.init(ps(2), { seed: 'input' }));
  assert.equal(b.left.length, 0);
  assert.equal(b.right.length, 0);
  assert.ok(b.final && b.final.p1 && b.final.p2);
});

test('single elim bracket: 4 players -> one left, one right column, a final', () => {
  const se = BBEngines.get('single_elim');
  const b = se.bracket(se.init(ps(4), { seed: 'input' }));
  assert.equal(b.left.length, 1);
  assert.equal(b.left[0].length, 1);
  assert.equal(b.right.length, 1);
  assert.equal(b.right[0].length, 1);
  assert.ok(b.final);
});

test('single elim bracket: 8 players -> two columns per side, sizes 2 then 1', () => {
  const se = BBEngines.get('single_elim');
  const b = se.bracket(se.init(ps(8), { seed: 'input' }));
  assert.equal(b.left.length, 2);
  assert.equal(b.left[0].length, 2);
  assert.equal(b.left[1].length, 1);
  assert.equal(b.right.length, 2);
  assert.equal(b.right[0].length, 2);
  assert.equal(b.right[1].length, 1);
  assert.ok(b.final);
});

test('single elim bracket: 6 players (byes) still splits round-of-8 cleanly', () => {
  const se = BBEngines.get('single_elim');
  const b = se.bracket(se.init(ps(6), { seed: 'input' }));
  assert.equal(b.left.length, 2);
  assert.equal(b.left[0].length, 2);  // round of 8, left half = 2 matches (some byes)
  assert.equal(b.right[0].length, 2); // right half = 2 matches
  assert.ok(b.final);
});

test('setScore sets and clears a match score without touching the winner', () => {
  const rr = BBEngines.get('round_robin');
  const players = ps(4);
  let st = rr.init(players, {});
  const m = st.rounds[0].matches.find(x => !x.bye);
  st = rr.recordResult(st, players, m.id, m.p1);
  BBEngines.setScore(st, m.id, [3, 1]);
  const after = st.rounds.flatMap(r => r.matches).find(x => x.id === m.id);
  assert.deepEqual(after.score, [3, 1]);
  assert.equal(after.winner, m.p1); // unchanged
  BBEngines.setScore(st, m.id, null);
  assert.equal(after.score, null);
  assert.equal(after.winner, m.p1);
});

test('single elim: changing a decided semifinal winner updates the final matchup', () => {
  const se = BBEngines.get('single_elim');
  const players = ps(4);
  let st = se.init(players, { seed: 'input' });
  const sf1 = st.rounds[0].matches[0], sf2 = st.rounds[0].matches[1];
  st = se.recordResult(st, players, sf1.id, sf1.p1);
  st = se.recordResult(st, players, sf2.id, sf2.p1);
  const finalP1Before = st.rounds[1].matches[0].p1;
  st = se.recordResult(st, players, sf1.id, sf1.p2); // change sf1 winner
  assert.equal(st.rounds[1].matches[0].p1, sf1.p2);
  assert.notEqual(st.rounds[1].matches[0].p1, finalP1Before);
});

test('standings: 3-way head-to-head cycle falls through to diff, independent of input order', () => {
  const sw = BBEngines.get('swiss');
  const players = ps(3);
  // A beat B 4-3, B beat C 4-3, C beat A 4-0 -> all 1-1, h2h 1 each; diffs: A -3, B 0, C +3
  const state = { format: 'swiss', options: { rounds: 3 }, completed: true, champion: null, rounds: [
    { index: 1, matches: [{ id: 'm1', p1: 'p1', p2: 'p2', winner: 'p1', score: [4, 3], bye: false }] },
    { index: 2, matches: [{ id: 'm2', p1: 'p2', p2: 'p3', winner: 'p2', score: [4, 3], bye: false }] },
    { index: 3, matches: [{ id: 'm3', p1: 'p3', p2: 'p1', winner: 'p3', score: [4, 0], bye: false }] }
  ] };
  [players, players.slice().reverse(), [players[1], players[2], players[0]]].forEach(order => {
    const rows = sw.standings(state, order);
    assert.deepEqual(rows.map(r => r.playerId), ['p3', 'p2', 'p1']);
  });
});

test('standings: two-way tie still decided by head-to-head before diff', () => {
  const rr = BBEngines.get('round_robin');
  const state = { format: 'round_robin', options: {}, completed: false, champion: null, rounds: [
    { index: 1, matches: [{ id: 'm1', p1: 'p1', p2: 'p2', winner: 'p1', score: [4, 3], bye: false },
                          { id: 'm2', p1: 'p3', p2: 'p4', winner: 'p3', score: [4, 0], bye: false }] },
    { index: 2, matches: [{ id: 'm3', p1: 'p2', p2: 'p4', winner: 'p2', score: [4, 0], bye: false },
                          { id: 'm4', p1: 'p3', p2: 'p1', winner: 'p3', score: [4, 0], bye: false }] }
  ] };
  // p1 1-1 (diff -3), p2 1-1 (diff +3); p1 beat p2 -> p1 ahead
  const rows = rr.standings(state, ps(4));
  assert.deepEqual(rows.map(r => r.playerId), ['p3', 'p1', 'p2', 'p4']);
});

test('standings: higher wins always ranks first (fuzzed swiss)', () => {
  const sw = BBEngines.get('swiss');
  for (let it = 0; it < 300; it++) {
    const P = ps(3 + (it % 10));
    let s = sw.init(P, { rounds: 4 });
    while (!s.completed) {
      const m = s.rounds[s.rounds.length - 1].matches.find(x => x.winner == null);
      s = sw.recordResult(s, P, m.id, Math.random() < 0.5 ? m.p1 : m.p2, [4, Math.floor(Math.random() * 4)]);
    }
    const st = sw.standings(s, P);
    for (let i = 1; i < st.length; i++) {
      assert.ok(st[i].wins <= st[i - 1].wins);
    }
  }
});

function playSwiss(sw, P, rounds, pick) {
  let s = sw.init(P, { rounds });
  while (!s.completed) {
    const m = s.rounds[s.rounds.length - 1].matches.find(x => x.winner == null);
    s = sw.recordResult(s, P, m.id, pick(m));
  }
  return s;
}

test('swiss: a rematch only happens when no rematch-free pairing exists for that round', () => {
  const sw = BBEngines.get('swiss');
  const U = BBEngines._util;
  function canPair(pool, prev) {
    if (!pool.length) return true;
    for (let i = 1; i < pool.length; i++) {
      if (!U.havePlayed(prev, pool[0], pool[i]) && canPair(pool.filter((_, k) => k !== 0 && k !== i), prev)) return true;
    }
    return false;
  }
  for (let it = 0; it < 300; it++) {
    const P = ps(4 + (it % 7));
    const s = playSwiss(sw, P, 5, m => (Math.random() < 0.5 ? m.p1 : m.p2));
    s.rounds.forEach((rd, r) => {
      const prev = { rounds: s.rounds.slice(0, r) };
      const real = rd.matches.filter(m => !m.bye);
      if (real.some(m => U.havePlayed(prev, m.p1, m.p2))) {
        assert.ok(!canPair(real.flatMap(m => [m.p1, m.p2]), prev), 'avoidable rematch in round ' + (r + 1));
      }
    });
  }
});

test('swiss: odd players never get a second bye while someone has none', () => {
  const sw = BBEngines.get('swiss');
  for (let it = 0; it < 100; it++) {
    const s = playSwiss(sw, ps(5), 5, m => (Math.random() < 0.5 ? m.p1 : m.p2));
    const byes = s.rounds.map(rd => rd.matches.find(m => m.bye).p1);
    assert.equal(new Set(byes).size, 5);
  }
});

test('swiss: re-picking an earlier winner re-pairs later rounds that have no results', () => {
  const sw = BBEngines.get('swiss');
  const P = ps(4);
  let s = sw.init(P, { rounds: 3 });
  const r1 = s.rounds[0].matches;
  s = sw.recordResult(s, P, r1[0].id, r1[0].p1);
  s = sw.recordResult(s, P, r1[1].id, r1[1].p1);
  assert.equal(s.rounds.length, 2);
  const before = s.rounds[1].matches.map(m => m.p1 + m.p2).join();
  s = sw.recordResult(s, P, r1[0].id, r1[0].p2); // flip round-1 result
  assert.equal(s.rounds.length, 2);
  const winners = [r1[0].p2, r1[1].p1].sort();
  const top = s.rounds[1].matches.find(m => winners.includes(m.p1) && winners.includes(m.p2));
  assert.ok(top, 'round 2 pairs the two new 1-0 players: ' + before);
});

test('swiss: undo on a bye is ignored; undoDropsResults flags later results', () => {
  const sw = BBEngines.get('swiss');
  const P = ps(3);
  let s = sw.init(P, { rounds: 2 });
  const bye = s.rounds[0].matches.find(m => m.bye);
  s = sw.undoResult(s, P, bye.id);
  assert.equal(bye.winner, bye.p1);
  const real = s.rounds[0].matches.find(m => !m.bye);
  s = sw.recordResult(s, P, real.id, real.p1);
  assert.equal(sw.undoDropsResults(s, real.id), false);
  const r2 = s.rounds[1].matches.find(m => !m.bye);
  s = sw.recordResult(s, P, r2.id, r2.p1);
  assert.equal(sw.undoDropsResults(s, real.id), true);
});

test('swiss: 對手分 (Buchholz) ranks right after wins; round robin has none', () => {
  const sw = BBEngines.get('swiss');
  const M = (id, a, b, w) => ({ id, p1: a, p2: b, winner: w, score: null, bye: false });
  // R1: p1>p3, p2>p4   R2: p3>p4  => p1, p2, p3 all have 1 win
  // 對手分: p1 = p3's 1 win = 1, p3 = p1(1)+p4(0) = 1, p2 = p4's 0 wins = 0
  // p2 drops below on 對手分; p1 vs p3 tie on 對手分 and p1 beat p3 head-to-head
  const state = { format: 'swiss', options: { rounds: 2 }, completed: false, champion: null, rounds: [
    { index: 1, matches: [M('m1', 'p1', 'p3', 'p1'), M('m2', 'p2', 'p4', 'p2')] },
    { index: 2, matches: [M('m3', 'p3', 'p4', 'p3')] }
  ] };
  const P = ps(4);
  // input order puts p2 first; diff is 0 for all, so the order comes from the tiebreaks
  const rows = sw.standings(state, [P[1], P[0], P[2], P[3]]);
  assert.deepEqual(rows.map(r => r.playerId), ['p1', 'p3', 'p2', 'p4']);
  assert.deepEqual(rows.map(r => r.buchholz), [1, 1, 0, 2]);
  const rr = BBEngines.get('round_robin').standings(state, P);
  assert.equal(rr[0].buchholz, undefined);
});
