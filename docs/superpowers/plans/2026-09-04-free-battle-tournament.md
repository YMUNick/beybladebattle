# 自由對戰（賽事舉辦）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "⚔ 自由對戰" tournament-hosting feature to the single-file Beyblade X scorer, supporting Round Robin, Single Elimination, and Swiss formats.

**Architecture:** Tournament logic lives in a new pure-function file `js/tournament-engines.js` (dual-mode: browser global `BBEngines` + CommonJS export for Node tests). Three engines implement one shared interface. The UI adds two `.screen` sections (`#freebattle`, `#tournament`) to `index.html`, reusing the existing `showScreen()`, `askConfirm()`, `toast()`, and neon styling. Tournaments persist to `localStorage` under key `bb_tournaments`.

**Tech Stack:** Vanilla JS (ES5-compatible, no build), HTML, CSS. Tests run with Node's built-in test runner (`node --test`), v24 available.

---

## File Structure

- Create: `js/tournament-engines.js` — shared helpers + 3 engines + `BBEngines` registry (dual browser/Node export).
- Create: `tests/engines.test.mjs` — Node tests for all three engines.
- Create: `js/free-battle.js` — UI logic: localStorage layer, list render, new-tournament wizard, tournament detail render + result wiring. Loaded as classic script.
- Modify: `index.html` — add `<script src>` tags, home-page button, `#freebattle` + `#tournament` markup, and CSS for tournament UI.

**Engine interface** (every engine object exposes these; all take `state` first, `participants` second for uniformity):

```
init(participants, options) -> state
recordResult(state, participants, matchId, winnerId, score) -> state
undoResult(state, participants, matchId) -> state
standings(state, participants) -> [{rank, playerId, name, wins, losses, winPct, diff}]
isComplete(state) -> boolean
champion(state, participants) -> playerId | null
view(state) -> { type:'rounds'|'bracket', rounds:[...] }
```

**Shared data shapes:**
- participant: `{ id, name }`
- match: `{ id, p1, p2, winner, score, bye }`  (`p2:null` + `bye:true` = walkover; `winner:null` = unplayed)
- state: `{ format, options, rounds:[{index, matches:[...]}], completed, champion }`

---

## Task 1: Engine scaffold + shared helpers + Node test harness

**Files:**
- Create: `js/tournament-engines.js`
- Create: `tests/engines.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/engines.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engines.test.mjs`
Expected: FAIL — `Cannot find module '../js/tournament-engines.js'`

- [ ] **Step 3: Write minimal implementation**

Create `js/tournament-engines.js`:

```js
(function (root) {
  'use strict';

  // ---------- shared helpers ----------
  function findMatch(state, id) {
    for (var r = 0; r < state.rounds.length; r++) {
      var ms = state.rounds[r].matches;
      for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i];
    }
    return null;
  }
  function eachMatch(state, fn) {
    state.rounds.forEach(function (rd, r) {
      rd.matches.forEach(function (m, i) { fn(m, r, i); });
    });
  }
  function mkMatch(n, a, b) {
    return { id: 'm' + n, p1: a, p2: b, winner: null, score: null, bye: false };
  }
  function nextPow2(n) { var p = 1; while (p < n) p *= 2; return p; }
  function seedOrder(size) {
    var rounds = Math.round(Math.log2(size));
    var seeds = [1, 2];
    for (var r = 1; r < rounds; r++) {
      var next = [], sum = Math.pow(2, r + 1) + 1;
      for (var i = 0; i < seeds.length; i++) {
        if (i % 2 === 0) { next.push(seeds[i]); next.push(sum - seeds[i]); }
        else { next.push(sum - seeds[i]); next.push(seeds[i]); }
      }
      seeds = next;
    }
    return seeds;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function countMatches(state) {
    var n = 0; state.rounds.forEach(function (r) { n += r.matches.length; }); return n;
  }
  // returns -1 if a beat b, 1 if b beat a, 0 otherwise
  function headToHead(state, a, b) {
    var res = 0;
    eachMatch(state, function (m) {
      if (m.bye || m.winner == null) return;
      if ((m.p1 === a && m.p2 === b) || (m.p1 === b && m.p2 === a)) {
        res = (m.winner === a) ? -1 : 1;
      }
    });
    return res;
  }
  function havePlayed(state, a, b) {
    var yes = false;
    eachMatch(state, function (m) {
      if (m.bye) return;
      if ((m.p1 === a && m.p2 === b) || (m.p1 === b && m.p2 === a)) yes = true;
    });
    return yes;
  }
  function hadBye(state, id) {
    var yes = false;
    eachMatch(state, function (m) { if (m.bye && m.p1 === id) yes = true; });
    return yes;
  }
  // shared standings for round_robin + swiss
  function tallyStandings(state, participants) {
    var map = {};
    participants.forEach(function (p) {
      map[p.id] = { rank: 0, playerId: p.id, name: p.name, wins: 0, losses: 0, winPct: 0, diff: 0 };
    });
    eachMatch(state, function (m) {
      if (m.winner == null) return;
      if (m.bye) { if (map[m.winner]) map[m.winner].wins++; return; }
      var w = m.winner, l = (m.p1 === w ? m.p2 : m.p1);
      if (map[w]) map[w].wins++;
      if (map[l]) map[l].losses++;
      if (m.score && map[w] && map[l]) {
        var d = m.score[0] - m.score[1];
        map[w].diff += d; map[l].diff -= d;
      }
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    rows.forEach(function (r) { var g = r.wins + r.losses; r.winPct = g ? r.wins / g : 0; });
    rows.sort(function (a, b) {
      return (b.wins - a.wins) || headToHead(state, a.playerId, b.playerId) ||
             (b.diff - a.diff) || a.name.localeCompare(b.name);
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }
  function allDecided(state) {
    var any = false, ok = true;
    eachMatch(state, function (m) {
      if (m.bye) return;
      any = true;
      if (m.winner == null) ok = false;
    });
    return any && ok;
  }

  var util = {
    findMatch: findMatch, eachMatch: eachMatch, mkMatch: mkMatch, nextPow2: nextPow2,
    seedOrder: seedOrder, shuffle: shuffle, countMatches: countMatches,
    headToHead: headToHead, havePlayed: havePlayed, hadBye: hadBye,
    tallyStandings: tallyStandings, allDecided: allDecided
  };

  // engines are attached in later tasks
  var BBEngines = {
    _util: util,
    get: function (fmt) { return this[fmt]; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BBEngines;
  else root.BBEngines = BBEngines;
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 4: Run test to verify it fails on missing engines but passes helpers**

Run: `node --test tests/engines.test.mjs`
Expected: `nextPow2 and seedOrder helpers` PASS; `registry exposes three engines` FAIL (engines not attached yet). This confirms helpers work; engines come next.

- [ ] **Step 5: Commit**

```bash
git add js/tournament-engines.js tests/engines.test.mjs
git commit -m "feat: tournament engine scaffold with shared helpers and test harness"
```

---

## Task 2: Round Robin engine

**Files:**
- Modify: `js/tournament-engines.js` (add `round_robin` engine before the export)
- Modify: `tests/engines.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/engines.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engines.test.mjs`
Expected: the three round-robin tests FAIL with `Cannot read properties of undefined (reading 'init')`.

- [ ] **Step 3: Write minimal implementation**

In `js/tournament-engines.js`, insert this block immediately **before** the `var BBEngines = {` line:

```js
  // ---------- Round Robin ----------
  function rrInit(participants, options) {
    options = options || {};
    var ids = participants.map(function (p) { return p.id; });
    var arr = ids.slice();
    if (arr.length % 2 !== 0) arr.push(null); // null = BYE seat
    var n = arr.length, roundsCount = n - 1;
    var rounds = [], mc = 0;
    var passes = options.doubleRound ? 2 : 1;
    for (var pass = 0; pass < passes; pass++) {
      var order = arr.slice();
      for (var r = 0; r < roundsCount; r++) {
        var matches = [];
        for (var i = 0; i < n / 2; i++) {
          var a = order[i], b = order[n - 1 - i];
          if (a === null || b === null) {
            var solo = a === null ? b : a;
            if (solo != null) {
              matches.push({ id: 'm' + (++mc), p1: solo, p2: null, winner: solo, score: null, bye: true });
            }
          } else {
            if (pass === 1) { var t = a; a = b; b = t; }
            matches.push(mkMatch(++mc, a, b));
          }
        }
        rounds.push({ index: rounds.length + 1, matches: matches });
        var fixed = order[0], rest = order.slice(1);
        rest.unshift(rest.pop());
        order = [fixed].concat(rest);
      }
    }
    return { format: 'round_robin', options: options, rounds: rounds, completed: false, champion: null };
  }
  function rrRecord(state, participants, matchId, winnerId, score) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    if (winnerId !== m.p1 && winnerId !== m.p2) return state;
    m.winner = winnerId; m.score = score || null;
    state.completed = allDecided(state);
    state.champion = state.completed ? tallyStandings(state, participants)[0].playerId : null;
    return state;
  }
  function rrUndo(state, participants, matchId) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    m.winner = null; m.score = null;
    state.completed = false; state.champion = null;
    return state;
  }
  var roundRobin = {
    init: rrInit, recordResult: rrRecord, undoResult: rrUndo,
    standings: tallyStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s, p) { return s.completed ? tallyStandings(s, p)[0].playerId : null; },
    view: function (s) { return { type: 'rounds', rounds: s.rounds }; }
  };
```

Then add `round_robin: roundRobin,` as the first property inside the `var BBEngines = {` object literal (right after `{`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engines.test.mjs`
Expected: all round-robin tests PASS. (`registry exposes three engines` still fails until the other two engines are added.)

- [ ] **Step 5: Commit**

```bash
git add js/tournament-engines.js tests/engines.test.mjs
git commit -m "feat: round robin tournament engine"
```

---

## Task 3: Single Elimination engine

**Files:**
- Modify: `js/tournament-engines.js`
- Modify: `tests/engines.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/engines.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engines.test.mjs`
Expected: single-elim tests FAIL (`se` is undefined → reading 'init').

- [ ] **Step 3: Write minimal implementation**

In `js/tournament-engines.js`, insert **before** `var BBEngines = {`:

```js
  // ---------- Single Elimination ----------
  function seInit(participants, options) {
    options = options || {};
    var ids = participants.map(function (p) { return p.id; });
    if (options.seed === 'random') ids = shuffle(ids);
    var n = ids.length, size = nextPow2(n);
    var order = seedOrder(size); // seed numbers per bracket slot
    var seats = order.map(function (s) { return s <= n ? ids[s - 1] : null; });
    var rounds = [], mc = 0, r1 = [];
    for (var i = 0; i < size; i += 2) {
      var a = seats[i], b = seats[i + 1];
      var m = mkMatch(++mc, a, b);
      if (a == null && b != null) { m.winner = b; m.bye = true; }
      else if (b == null && a != null) { m.winner = a; m.bye = true; }
      r1.push(m);
    }
    rounds.push({ index: 1, matches: r1 });
    var prev = r1.length, idx = 2;
    while (prev > 1) {
      var ms = [];
      for (var k = 0; k < prev / 2; k++) ms.push(mkMatch(++mc, null, null));
      rounds.push({ index: idx++, matches: ms });
      prev = ms.length;
    }
    var state = { format: 'single_elim', options: options, rounds: rounds, completed: false, champion: null };
    seRecompute(state);
    return state;
  }
  function seRecompute(state) {
    var rs = state.rounds;
    for (var r = 1; r < rs.length; r++) {
      rs[r].matches.forEach(function (m, i) {
        var c1 = rs[r - 1].matches[i * 2], c2 = rs[r - 1].matches[i * 2 + 1];
        m.p1 = c1.winner || null;
        m.p2 = c2.winner || null;
        if (m.winner && m.winner !== m.p1 && m.winner !== m.p2) { m.winner = null; m.score = null; }
      });
    }
    var fin = rs[rs.length - 1].matches[0];
    state.champion = fin.winner || null;
    state.completed = !!state.champion;
  }
  function seRecord(state, participants, matchId, winnerId, score) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    if (winnerId !== m.p1 && winnerId !== m.p2) return state;
    m.winner = winnerId; m.score = score || null;
    seRecompute(state);
    return state;
  }
  function seUndo(state, participants, matchId) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    m.winner = null; m.score = null;
    seRecompute(state);
    return state;
  }
  function seStandings(state, participants) {
    var info = {};
    participants.forEach(function (p) {
      info[p.id] = { rank: 0, playerId: p.id, name: p.name, wins: 0, losses: 0, winPct: 0, diff: 0, elimRound: 0 };
    });
    eachMatch(state, function (m, r) {
      if (m.bye || m.winner == null) return;
      var l = (m.winner === m.p1 ? m.p2 : m.p1);
      if (info[m.winner]) info[m.winner].wins++;
      if (l && info[l]) { info[l].losses++; info[l].elimRound = r + 1; }
    });
    var rows = Object.keys(info).map(function (k) { return info[k]; });
    rows.forEach(function (x) { var g = x.wins + x.losses; x.winPct = g ? x.wins / g : 0; });
    var champ = state.champion;
    rows.sort(function (a, b) {
      var ca = a.playerId === champ ? 1 : 0, cb = b.playerId === champ ? 1 : 0;
      return (cb - ca) || (b.elimRound - a.elimRound) || a.name.localeCompare(b.name);
    });
    var rank = 1;
    rows.forEach(function (r, i) {
      if (i > 0) {
        var prev = rows[i - 1];
        var tie = r.playerId !== champ && prev.playerId !== champ && r.elimRound === prev.elimRound;
        rank = tie ? rank : i + 1;
      }
      r.rank = rank;
    });
    return rows;
  }
  var singleElim = {
    init: seInit, recordResult: seRecord, undoResult: seUndo,
    standings: seStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s) { return s.champion; },
    view: function (s) { return { type: 'bracket', rounds: s.rounds }; }
  };
```

Then add `single_elim: singleElim,` inside the `BBEngines` object literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engines.test.mjs`
Expected: all single-elim tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/tournament-engines.js tests/engines.test.mjs
git commit -m "feat: single elimination tournament engine"
```

---

## Task 4: Swiss engine

**Files:**
- Modify: `js/tournament-engines.js`
- Modify: `tests/engines.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/engines.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engines.test.mjs`
Expected: swiss tests FAIL (`sw` undefined).

- [ ] **Step 3: Write minimal implementation**

In `js/tournament-engines.js`, insert **before** `var BBEngines = {`:

```js
  // ---------- Swiss ----------
  function swInit(participants, options) {
    options = options || {};
    var target = options.rounds || Math.max(1, Math.ceil(Math.log2(participants.length)));
    var state = { format: 'swiss', options: { rounds: target }, rounds: [], completed: false, champion: null };
    swGenerate(state, participants, 1);
    return state;
  }
  function swGenerate(state, participants, index) {
    var order = tallyStandings(state, participants).map(function (r) { return r.playerId; });
    var pool = order.slice();
    var mc = countMatches(state);
    var matches = [];
    if (pool.length % 2 === 1) {
      var byeId = null;
      for (var i = pool.length - 1; i >= 0; i--) { if (!hadBye(state, pool[i])) { byeId = pool[i]; break; } }
      if (byeId == null) byeId = pool[pool.length - 1];
      pool = pool.filter(function (id) { return id !== byeId; });
      matches.push({ id: 'm' + (++mc), p1: byeId, p2: null, winner: byeId, score: null, bye: true });
    }
    if (index === 1) {
      var half = pool.length / 2;
      for (var k = 0; k < half; k++) matches.push(mkMatch(++mc, pool[k], pool[k + half]));
    } else {
      var used = {};
      for (var a = 0; a < pool.length; a++) {
        if (used[pool[a]]) continue;
        var pa = pool[a], paired = false;
        for (var b = a + 1; b < pool.length; b++) {
          var pb = pool[b];
          if (used[pb]) continue;
          if (!havePlayed(state, pa, pb)) { matches.push(mkMatch(++mc, pa, pb)); used[pa] = used[pb] = true; paired = true; break; }
        }
        if (!paired) {
          for (var c = a + 1; c < pool.length; c++) {
            var pc = pool[c];
            if (!used[pc]) { matches.push(mkMatch(++mc, pa, pc)); used[pa] = used[pc] = true; break; }
          }
        }
      }
    }
    state.rounds.push({ index: index, matches: matches });
  }
  function swRecord(state, participants, matchId, winnerId, score) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    if (winnerId !== m.p1 && winnerId !== m.p2) return state;
    m.winner = winnerId; m.score = score || null;
    var cur = state.rounds[state.rounds.length - 1];
    var done = cur.matches.every(function (x) { return x.winner != null; });
    if (done) {
      if (state.rounds.length < state.options.rounds) {
        swGenerate(state, participants, state.rounds.length + 1);
      } else {
        state.completed = true;
        var st = tallyStandings(state, participants);
        state.champion = st.length ? st[0].playerId : null;
      }
    }
    return state;
  }
  function swUndo(state, participants, matchId) {
    var ri = -1;
    for (var r = 0; r < state.rounds.length; r++) {
      if (state.rounds[r].matches.some(function (m) { return m.id === matchId; })) { ri = r; break; }
    }
    if (ri < 0) return state;
    state.rounds = state.rounds.slice(0, ri + 1);
    var m = findMatch(state, matchId);
    if (m) { m.winner = null; m.score = null; }
    state.completed = false; state.champion = null;
    return state;
  }
  var swiss = {
    init: swInit, recordResult: swRecord, undoResult: swUndo,
    standings: tallyStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s, p) { return s.completed ? tallyStandings(s, p)[0].playerId : null; },
    view: function (s) { return { type: 'rounds', rounds: s.rounds }; }
  };
```

Then add `swiss: swiss,` inside the `BBEngines` object literal.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test tests/engines.test.mjs`
Expected: ALL tests PASS, including `registry exposes three engines`.

- [ ] **Step 5: Commit**

```bash
git add js/tournament-engines.js tests/engines.test.mjs
git commit -m "feat: swiss tournament engine"
```

---

## Task 5: Home-page button + screen markup + script includes

**Files:**
- Modify: `index.html` (subbtns around line 470-476; add screens before `#confirmBox` at line 666; add scripts before `</body>`)

- [ ] **Step 1: Add the home-page entry button**

In the `.subbtns` block inside `#setup` (currently near line 471), add as the first button:

```html
    <button class="ghostbtn" id="gotoFreeBattle">⚔ 自由對戰</button>
```

- [ ] **Step 2: Add the two new screens**

Immediately before `<div id="confirmBox">` (line 666), insert:

```html
<!-- ================= 自由對戰:賽事列表 ================= -->
<section class="screen" id="freebattle">
  <div class="brand">FREE<span class="x">BATTLE</span><small>自由對戰・賽事舉辦</small></div>
  <div class="subbtns" style="margin-bottom:12px">
    <button class="ghostbtn" id="fbNewBtn">＋ 新增比賽</button>
    <button class="ghostbtn" id="fbHomeBtn">🏠 回到設定</button>
  </div>
  <div id="fbList"></div>
</section>

<!-- ================= 自由對戰:賽事詳情 ================= -->
<section class="screen" id="tournament">
  <div class="brand">STAND<span class="x">INGS</span><small id="tName">賽事</small></div>
  <div class="subbtns" style="margin-bottom:12px">
    <button class="ghostbtn" id="tBackBtn">↩ 賽事列表</button>
    <span id="tMeta" class="thint"></span>
  </div>
  <div id="tChampion"></div>
  <h3 class="rules-cat">積分榜</h3>
  <div id="tStandings"></div>
  <h3 class="rules-cat">對戰</h3>
  <div id="tMatches"></div>
</section>

<!-- ================= 自由對戰:新增比賽彈窗 ================= -->
<div id="fbWizard">
  <div class="cwin wide">
    <div class="wtitle">新增比賽</div>
    <div class="field"><label>比賽名稱</label><input id="wzName" maxlength="24" placeholder="例如:週五 4PM 自由對戰"></div>
    <label class="wlabel">選擇制度</label>
    <div id="wzFormats" class="wzfmts"></div>
    <div id="wzOptions"></div>
    <label class="wlabel">參賽者</label>
    <div class="wzaddrow"><input id="wzPlayer" maxlength="12" placeholder="輸入姓名後按新增"><button class="ctrl" id="wzAdd">新增</button></div>
    <div id="wzPlayers" class="wzplayers"></div>
    <div class="cbtns">
      <button class="cok" id="wzStart">開始</button>
      <button class="ccancel" id="wzCancel">取消</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the script includes**

Immediately before `</body>` (find the closing body tag near the end of the file), add:

```html
<script src="js/tournament-engines.js"></script>
<script src="js/free-battle.js"></script>
```

- [ ] **Step 4: Verify manually**

Run: open `index.html` in a browser (or `python -m http.server` in the repo and visit `http://localhost:8000`).
Expected: A `⚔ 自由對戰` button appears on the home screen. Clicking it does nothing yet (wired in Task 7). No console errors from the new `<script src>` tags (files exist; `free-battle.js` is created next task and may 404 until then — acceptable at this step, resolved in Task 6).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add free-battle button, screens and wizard markup"
```

---

## Task 6: CSS for tournament UI

**Files:**
- Modify: `index.html` (append rules in the existing `<style>` block, e.g. just before `/* ====== 賽事規則 ====== */` or at the end of the style block)

- [ ] **Step 1: Add styles**

Locate the closing `</style>` tag and insert the following CSS immediately before it:

```css
/* ====== 自由對戰 ====== */
#freebattle,#tournament{padding:0 14px 40px;max-width:900px;margin:0 auto;width:100%}
.thint{color:#9adf9f;font-size:14px;align-self:center;letter-spacing:.1em}
.fbcard{border:1px solid rgba(0,255,160,.35);border-radius:12px;padding:12px 14px;margin-bottom:10px;
  background:rgba(0,40,25,.35);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px}
.fbcard:hover{border-color:var(--neon);box-shadow:var(--neon-glow)}
.fbcard .fbtitle{font-size:17px;color:#eafff2}
.fbcard .fbsub{font-size:13px;color:#9adf9f;margin-top:3px;letter-spacing:.05em}
.fbcard .fbdel{background:none;border:1px solid rgba(255,80,80,.5);color:#ff8080;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:13px}
.fbempty{color:#9adf9f;text-align:center;padding:30px 10px;letter-spacing:.1em}
/* standings table */
.sttable{width:100%;border-collapse:collapse;font-size:15px;overflow-x:auto;display:block}
.sttable th,.sttable td{padding:8px 10px;text-align:center;white-space:nowrap}
.sttable thead th{color:var(--neon);text-shadow:var(--neon-glow);border-bottom:1px solid rgba(0,255,160,.4);letter-spacing:.15em;font-size:13px}
.sttable tbody tr:nth-child(odd){background:rgba(0,50,32,.3)}
.sttable td.stname{text-align:left;color:#eafff2}
.sttable tr.champrow{background:rgba(255,215,0,.15)!important}
.sttable tr.champrow td{color:#ffe66a}
/* matches */
.rnd{margin-bottom:16px}
.rndh{color:var(--neon);letter-spacing:.2em;font-size:14px;margin:8px 0}
.matchrow{display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px dashed rgba(0,255,160,.18)}
.mside{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.mside.right{justify-content:flex-end}
.mname{color:#eafff2;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mname.win{color:#7dffb0;font-weight:700}
.winbtn{background:none;border:1px solid rgba(0,255,160,.5);color:#9adf9f;border-radius:8px;padding:4px 9px;cursor:pointer;font-size:13px}
.winbtn:hover{border-color:var(--neon);color:#eafff2}
.mvs{color:#5f8f74;font-size:12px}
.mundo{background:none;border:none;color:#8fb;cursor:pointer;font-size:12px;text-decoration:underline}
.mbye{color:#9adf9f;font-size:14px;font-style:italic}
.champbanner{border:1px solid rgba(255,215,0,.6);background:rgba(255,215,0,.12);color:#ffe66a;
  border-radius:12px;padding:12px;text-align:center;letter-spacing:.2em;margin-bottom:14px;font-size:18px}
/* wizard */
#fbWizard{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
#fbWizard.show{display:flex}
#fbWizard .cwin.wide{max-width:460px;width:100%;text-align:left;max-height:90vh;overflow-y:auto}
.wtitle{font-size:20px;color:var(--neon);text-shadow:var(--neon-glow);letter-spacing:.2em;margin-bottom:12px;text-align:center}
.wlabel{display:block;font-size:14px;color:#9adf9f;letter-spacing:.15em;margin:12px 0 6px}
.wzfmts{display:flex;flex-direction:column;gap:8px}
.wzfmt{border:1px solid rgba(0,255,160,.3);border-radius:10px;padding:8px 10px;cursor:pointer}
.wzfmt.sel{border-color:var(--neon);box-shadow:var(--neon-glow)}
.wzfmt b{color:#eafff2}
.wzfmt small{display:block;color:#9adf9f;font-size:12px;margin-top:3px}
.wzaddrow{display:flex;gap:8px}
.wzaddrow input{flex:1}
.wzplayers{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.wzchip{border:1px solid rgba(0,255,160,.4);border-radius:16px;padding:3px 10px;font-size:14px;color:#eafff2;display:flex;align-items:center;gap:6px}
.wzchip button{background:none;border:none;color:#ff8080;cursor:pointer;font-size:15px;line-height:1}
```

- [ ] **Step 2: Verify manually**

Run: reload the page, click `⚔ 自由對戰` is not wired yet; instead temporarily confirm styles load by checking there are no CSS parse errors in devtools. (Full visual check happens in Task 7-9.)
Expected: no console/style errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: styles for free-battle list, standings, matches and wizard"
```

---

## Task 7: Data layer + list rendering + navigation wiring

**Files:**
- Create: `js/free-battle.js`

- [ ] **Step 1: Create the file with storage + list + navigation**

Create `js/free-battle.js`:

```js
/* 自由對戰 UI 邏輯 — 依賴 window.BBEngines, window.showScreen, window.askConfirm, window.toast */
(function () {
  'use strict';
  var KEY = 'bb_tournaments';
  var current = null; // currently open tournament id

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); }
    catch (e) { if (window.toast) toast('儲存失敗(空間不足或隱私模式)'); }
  }
  function getById(id) { return load().filter(function (t) { return t.id === id; })[0] || null; }
  function upsert(t) {
    var list = load(), i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === t.id) { i = k; break; }
    if (i >= 0) list[i] = t; else list.unshift(t);
    save(list);
  }
  function remove(id) { save(load().filter(function (t) { return t.id !== id; })); }

  var FORMAT_LABELS = { round_robin: '循環賽', single_elim: '單淘汰', swiss: '瑞士制' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function progressText(t) {
    var eng = BBEngines.get(t.format);
    if (eng.isComplete(t.state)) return '已完成';
    return '進行中・第 ' + t.state.rounds.length + ' 輪';
  }

  function renderList() {
    var box = document.getElementById('fbList');
    var list = load();
    if (!list.length) { box.innerHTML = '<div class="fbempty">還沒有比賽,點「＋ 新增比賽」開始舉辦。</div>'; return; }
    box.innerHTML = list.map(function (t) {
      return '<div class="fbcard" data-id="' + t.id + '">' +
        '<div><div class="fbtitle">' + esc(t.name) + '</div>' +
        '<div class="fbsub">' + FORMAT_LABELS[t.format] + '・' + t.participants.length + ' 人・' + progressText(t) + '</div></div>' +
        '<button class="fbdel" data-del="' + t.id + '">刪除</button></div>';
    }).join('');
    box.querySelectorAll('.fbcard').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-del')) return;
        openTournament(el.getAttribute('data-id'));
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-del');
        (window.askConfirm ? askConfirm('確定刪除這場比賽?', '刪除') : Promise.resolve(confirm('刪除?')))
          .then(function (ok) { if (ok) { remove(id); renderList(); if (window.toast) toast('已刪除'); } });
      });
    });
  }

  // openTournament + renderDetail implemented in Task 9; stub for now:
  function openTournament(id) { current = id; if (window.__renderDetail) window.__renderDetail(id); showScreen('tournament'); }

  // navigation
  document.getElementById('gotoFreeBattle').addEventListener('click', function () { renderList(); showScreen('freebattle'); });
  document.getElementById('fbHomeBtn').addEventListener('click', function () { showScreen('setup'); });
  document.getElementById('tBackBtn').addEventListener('click', function () { renderList(); showScreen('freebattle'); });

  // expose for other tasks/modules
  window.FreeBattle = {
    load: load, save: save, getById: getById, upsert: upsert, remove: remove,
    renderList: renderList, openTournament: openTournament,
    FORMAT_LABELS: FORMAT_LABELS, esc: esc
  };
})();
```

- [ ] **Step 2: Verify manually**

Run: reload page, click `⚔ 自由對戰`.
Expected: navigates to FREEBATTLE screen showing empty-state text "還沒有比賽…". `🏠 回到設定` returns home. No console errors. (`＋ 新增比賽` wired next task.)

- [ ] **Step 3: Commit**

```bash
git add js/free-battle.js
git commit -m "feat: free-battle storage layer, list render and navigation"
```

---

## Task 8: New-tournament wizard

**Files:**
- Modify: `js/free-battle.js`

- [ ] **Step 1: Add wizard logic**

In `js/free-battle.js`, insert the following just before the `window.FreeBattle = {` line:

```js
  // ---------- new tournament wizard ----------
  var FORMAT_DEFS = [
    { key: 'round_robin', name: '循環賽', desc: '每人互打一場,依總勝場排名。最公平。' },
    { key: 'single_elim', name: '單淘汰', desc: '輸一場淘汰,勝者晉級到冠軍。最快。' },
    { key: 'swiss', name: '瑞士制', desc: '不淘汰,每輪依戰績配對,打固定輪數。' }
  ];
  var wz = { format: 'round_robin', players: [] };

  function optionsHtml(fmt) {
    if (fmt === 'single_elim') {
      return '<label class="wlabel">種子順序</label>' +
        '<div class="format-row"><button class="fmt sel" data-seed="input">依輸入順序</button>' +
        '<button class="fmt" data-seed="random">隨機</button></div>' +
        '<label class="wlabel"><input type="checkbox" id="wzThird"> 加打季軍賽</label>';
    }
    if (fmt === 'swiss') {
      var def = Math.max(3, Math.ceil(Math.log2(Math.max(2, wz.players.length))));
      return '<label class="wlabel">輪數</label>' +
        '<input id="wzRounds" type="number" min="1" max="12" value="' + def + '" style="width:80px">';
    }
    return '<label class="wlabel">循環方式</label>' +
      '<div class="format-row"><button class="fmt sel" data-dbl="0">單循環</button>' +
      '<button class="fmt" data-dbl="1">雙循環</button></div>';
  }

  function renderFormats() {
    document.getElementById('wzFormats').innerHTML = FORMAT_DEFS.map(function (f) {
      return '<div class="wzfmt' + (f.key === wz.format ? ' sel' : '') + '" data-fmt="' + f.key + '">' +
        '<b>' + f.name + '</b><small>' + f.desc + '</small></div>';
    }).join('');
    document.querySelectorAll('#wzFormats .wzfmt').forEach(function (el) {
      el.addEventListener('click', function () { wz.format = el.getAttribute('data-fmt'); renderFormats(); renderOptions(); });
    });
  }
  function renderOptions() {
    var box = document.getElementById('wzOptions');
    box.innerHTML = optionsHtml(wz.format);
    box.querySelectorAll('[data-seed]').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('[data-seed]').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
    });
    box.querySelectorAll('[data-dbl]').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('[data-dbl]').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
    });
  }
  function renderPlayers() {
    document.getElementById('wzPlayers').innerHTML = wz.players.map(function (n, i) {
      return '<span class="wzchip">' + esc(n) + '<button data-i="' + i + '">×</button></span>';
    }).join('');
    document.querySelectorAll('#wzPlayers .wzchip button').forEach(function (b) {
      b.addEventListener('click', function () { wz.players.splice(+b.getAttribute('data-i'), 1); renderPlayers(); });
    });
  }
  function uniqueName(name) {
    var base = name, n = 2;
    while (wz.players.indexOf(name) >= 0) { name = base + ' ' + (n++); }
    return name;
  }
  function addPlayer() {
    var inp = document.getElementById('wzPlayer');
    var v = (inp.value || '').trim();
    if (!v) return;
    wz.players.push(uniqueName(v));
    inp.value = ''; inp.focus(); renderPlayers();
  }
  function openWizard() {
    wz = { format: 'round_robin', players: [] };
    document.getElementById('wzName').value = '自由對戰 ' + new Date().toLocaleDateString('zh-TW');
    renderFormats(); renderOptions(); renderPlayers();
    document.getElementById('fbWizard').classList.add('show');
  }
  function closeWizard() { document.getElementById('fbWizard').classList.remove('show'); }

  function collectOptions() {
    var o = {};
    if (wz.format === 'single_elim') {
      var seedBtn = document.querySelector('#wzOptions [data-seed].sel');
      o.seed = seedBtn ? seedBtn.getAttribute('data-seed') : 'input';
      o.thirdPlace = !!document.getElementById('wzThird') && document.getElementById('wzThird').checked;
    } else if (wz.format === 'swiss') {
      o.rounds = Math.max(1, parseInt(document.getElementById('wzRounds').value, 10) || 3);
    } else {
      var dbl = document.querySelector('#wzOptions [data-dbl].sel');
      o.doubleRound = dbl ? dbl.getAttribute('data-dbl') === '1' : false;
    }
    return o;
  }
  function startTournament() {
    if (wz.players.length < 2) { if (window.toast) toast('至少需要 2 位參賽者'); return; }
    var name = (document.getElementById('wzName').value || '').trim() || '自由對戰';
    var participants = wz.players.map(function (n, i) { return { id: 'p' + (i + 1), name: n }; });
    var eng = BBEngines.get(wz.format);
    var state = eng.init(participants, collectOptions());
    var t = {
      id: 't_' + Date.now().toString(36),
      name: name, format: wz.format, options: state.options,
      createdAt: Date.now(), participants: participants, state: state
    };
    upsert(t);
    closeWizard();
    openTournament(t.id);
  }

  document.getElementById('fbNewBtn').addEventListener('click', openWizard);
  document.getElementById('wzCancel').addEventListener('click', closeWizard);
  document.getElementById('wzAdd').addEventListener('click', addPlayer);
  document.getElementById('wzPlayer').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPlayer(); } });
  document.getElementById('wzStart').addEventListener('click', startTournament);
```

- [ ] **Step 2: Verify manually**

Run: reload, `⚔ 自由對戰` → `＋ 新增比賽`.
Expected: wizard opens; can pick a format (options change: RR shows 單/雙循環, single_elim shows 種子/季軍, swiss shows 輪數 defaulting to a number); add several names as chips (duplicate name auto-suffixes " 2"); remove a chip; `取消` closes; `開始` with <2 players shows toast. With ≥2 players, `開始` creates the tournament and navigates to the (still blank) tournament screen. Reload and the card should appear in the list.

- [ ] **Step 3: Commit**

```bash
git add js/free-battle.js
git commit -m "feat: new-tournament wizard (format, options, participants)"
```

---

## Task 9: Tournament detail — standings table + matches + record/undo

**Files:**
- Modify: `js/free-battle.js`

- [ ] **Step 1: Add detail rendering + result wiring**

In `js/free-battle.js`, replace the stub line

```js
  function openTournament(id) { current = id; if (window.__renderDetail) window.__renderDetail(id); showScreen('tournament'); }
```

with:

```js
  function nameOf(t, pid) {
    if (pid == null) return '—';
    var p = t.participants.filter(function (x) { return x.id === pid; })[0];
    return p ? p.name : '—';
  }
  function renderStandings(t) {
    var eng = BBEngines.get(t.format);
    var rows = eng.standings(t.state, t.participants);
    var champ = eng.champion(t.state, t.participants);
    var html = '<table class="sttable"><thead><tr>' +
      '<th>#</th><th>選手</th><th>勝-敗</th><th>勝率</th><th>積分差</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr class="' + (r.playerId === champ ? 'champrow' : '') + '">' +
        '<td>' + r.rank + '</td>' +
        '<td class="stname">' + esc(r.name) + '</td>' +
        '<td>' + r.wins + '-' + r.losses + '</td>' +
        '<td>' + Math.round(r.winPct * 100) + '%</td>' +
        '<td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('tStandings').innerHTML = html;
  }
  function matchRowHtml(t, m) {
    if (m.bye) {
      return '<div class="matchrow"><span class="mbye">' + esc(nameOf(t, m.p1)) + ' — 輪空(自動晉級)</span></div>';
    }
    var decided = m.winner != null;
    var p1w = m.winner === m.p1, p2w = m.winner === m.p2;
    var left = '<div class="mside">' +
      '<span class="mname ' + (p1w ? 'win' : '') + '">' + esc(nameOf(t, m.p1)) + '</span>' +
      (decided || m.p1 == null ? '' : '<button class="winbtn" data-win="' + m.id + '|' + m.p1 + '">勝</button>') + '</div>';
    var mid = decided
      ? '<span class="mvs">' + (m.score ? m.score[0] + '-' + m.score[1] : 'VS') + ' <button class="mundo" data-undo="' + m.id + '">復原</button></span>'
      : '<span class="mvs">VS</span>';
    var right = '<div class="mside right">' +
      (decided || m.p2 == null ? '' : '<button class="winbtn" data-win="' + m.id + '|' + m.p2 + '">勝</button>') +
      '<span class="mname ' + (p2w ? 'win' : '') + '">' + esc(nameOf(t, m.p2)) + '</span></div>';
    return '<div class="matchrow">' + left + mid + right + '</div>';
  }
  function renderMatches(t) {
    var box = document.getElementById('tMatches');
    box.innerHTML = t.state.rounds.map(function (rd) {
      return '<div class="rnd"><div class="rndh">第 ' + rd.index + ' 輪</div>' +
        rd.matches.map(function (m) { return matchRowHtml(t, m); }).join('') + '</div>';
    }).join('');
    box.querySelectorAll('[data-win]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-win').split('|');
        record(t.id, parts[0], parts[1]);
      });
    });
    box.querySelectorAll('[data-undo]').forEach(function (b) {
      b.addEventListener('click', function () { undo(t.id, b.getAttribute('data-undo')); });
    });
  }
  function renderChampion(t) {
    var eng = BBEngines.get(t.format);
    var box = document.getElementById('tChampion');
    if (eng.isComplete(t.state)) {
      box.innerHTML = '<div class="champbanner">🏆 冠軍:' + esc(nameOf(t, eng.champion(t.state, t.participants))) + '</div>';
    } else box.innerHTML = '';
  }
  function renderDetail(id) {
    var t = getById(id);
    if (!t) { showScreen('freebattle'); return; }
    document.getElementById('tName').textContent = t.name;
    document.getElementById('tMeta').textContent = FORMAT_LABELS[t.format] + '・' + t.participants.length + ' 人・' + progressText(t);
    renderChampion(t); renderStandings(t); renderMatches(t);
  }
  function record(id, matchId, winnerId) {
    var t = getById(id); if (!t) return;
    var eng = BBEngines.get(t.format);
    t.state = eng.recordResult(t.state, t.participants, matchId, winnerId);
    upsert(t); renderDetail(id);
  }
  function undo(id, matchId) {
    var t = getById(id); if (!t) return;
    var eng = BBEngines.get(t.format);
    t.state = eng.undoResult(t.state, t.participants, matchId);
    upsert(t); renderDetail(id);
  }
  function openTournament(id) { current = id; renderDetail(id); showScreen('tournament'); }
```

- [ ] **Step 2: Verify manually — Round Robin end-to-end**

Run: reload, create a Round Robin with 4 players.
Expected: 3 rounds shown, 2 matches each; tapping 勝 marks the winner green, updates standings (勝-敗, 勝率, 積分差) immediately; 復原 reverts; after all matches decided, 🏆 冠軍 banner appears and the top standings row is gold. Reload page → open the card → state persists exactly.

- [ ] **Step 3: Verify manually — Single Elim + Swiss**

Run: create a 6-player Single Elimination and a 5-player Swiss (rounds=3).
Expected (single elim): round 1 shows 2 walkovers ("輪空(自動晉級)") + 2 real matches; deciding a match fills the next round's slot; final winner → champion banner; standings show placement ranks with ties (e.g. two players rank 3). Undoing a semifinal clears the final slot.
Expected (swiss): only round 1 visible at first; after all round-1 matches recorded, round 2 appears with no rematched pairings; the odd player gets exactly one 輪空 per round and not the same player twice; after the last round, champion + final standings shown.

- [ ] **Step 4: Commit**

```bash
git add js/free-battle.js
git commit -m "feat: tournament detail with standings table, match list and result recording"
```

---

## Task 10: Full regression + polish

**Files:**
- Modify: as needed based on findings

- [ ] **Step 1: Run the engine test suite**

Run: `node --test tests/engines.test.mjs`
Expected: all tests PASS.

- [ ] **Step 2: Cross-format manual sweep**

Verify each scenario in a browser served over http (`python -m http.server`):
- Round Robin odd count (5 players): one bye per round, standings correct, completes.
- Single Elim exact power of two (4 and 8): no byes for 4; correct rounds for 8.
- Swiss with 4 players, 2 rounds: completes, champion set.
- Delete a tournament from the list (askConfirm) → removed and persists after reload.
- localStorage persistence: create, close browser tab, reopen → tournaments intact.

- [ ] **Step 3: Confirm no regressions to existing app**

Verify the original battle scorer still works: home → 進入對戰 flow, 對戰紀錄, 賽事搜尋, 賽事規則 all still navigate and function. New scripts must not throw on the home screen.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: free-battle polish and regression fixes"
```

- [ ] **Step 5: (optional) Merge/PR via finishing-a-development-branch skill**

---

## Self-Review Notes

- **Spec coverage:** home button (T5), `#freebattle` list + `#tournament` detail (T5/T7/T9), wizard with name/format/options/participants (T8), 3 engines round_robin/single_elim/swiss (T2/T3/T4), tap-winner scoring + optional score display + undo (T9), Challonge-style standings columns 排名/選手/勝-敗/勝率/積分差 (T9), localStorage persistence + delete (T7), engine unit tests (T1-T4). Excluded formats (double_elim, group+playoffs, points ladder) intentionally not shown, per approved scope.
- **Type consistency:** engine interface `init/recordResult/undoResult/standings/isComplete/champion/view` used identically across T2-T4 and called consistently in T9; match/state/participant shapes match the File Structure section; `FORMAT_LABELS` keys align with engine keys.
- **Score entry:** the plan displays optional score if present but the tap-winner path records without a score (score stays `null`); this satisfies the spec ("比分選填"). A dedicated score-input UI is a future enhancement, consistent with the spec calling it optional.
