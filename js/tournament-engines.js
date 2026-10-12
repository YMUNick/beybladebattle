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
  // opts.buchholz (swiss): add 對手分 = sum of real opponents' wins, ranked right after wins.
  function tallyStandings(state, participants, opts) {
    opts = opts || {};
    var map = {};
    participants.forEach(function (p) {
      // `byes` is computation-only (used to exclude byes from winPct); it is not displayed.
      map[p.id] = { rank: 0, playerId: p.id, name: p.name, wins: 0, losses: 0, byes: 0, winPct: 0, diff: 0 };
    });
    eachMatch(state, function (m) {
      if (m.winner == null) return;
      // A bye counts as a win for standings/ranking, but is not a "played game":
      // byes are tracked separately and excluded from the winPct denominator below.
      if (m.bye) { if (map[m.winner]) { map[m.winner].wins++; map[m.winner].byes++; } return; }
      var w = m.winner, l = (m.p1 === w ? m.p2 : m.p1);
      if (map[w]) map[w].wins++;
      if (map[l]) map[l].losses++;
      if (m.score && map[w] && map[l]) {
        var d = m.score[0] - m.score[1];
        map[w].diff += d; map[l].diff -= d;
      }
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    rows.forEach(function (r) {
      var played = (r.wins - r.byes) + r.losses; // real games only
      r.winPct = played ? (r.wins - r.byes) / played : 0;
    });
    if (opts.buchholz) {
      rows.forEach(function (r) { r.buchholz = 0; });
      eachMatch(state, function (m) {
        if (m.bye || m.winner == null || !map[m.p1] || !map[m.p2]) return;
        map[m.p1].buchholz += map[m.p2].wins;
        map[m.p2].buchholz += map[m.p1].wins;
      });
    }
    // players in the same tie group (equal on every criterion ranked before head-to-head)
    function tied(a, b) { return a.wins === b.wins && (!opts.buchholz || a.buchholz === b.buchholz); }
    // Head-to-head tiebreak = mini-league among players tied on wins (count of wins
    // against the other tied players). A pairwise comparator is not transitive: with a
    // cycle (A>B, B>C, C>A) the result depended on input order and ignored diff.
    rows.forEach(function (r) { r.h2h = 0; });
    eachMatch(state, function (m) {
      if (m.bye || m.winner == null) return;
      var w = m.winner, l = (m.p1 === w ? m.p2 : m.p1);
      if (!map[w] || !map[l] || !tied(map[w], map[l])) return;
      map[w].h2h++;
    });
    rows.sort(function (a, b) {
      return (b.wins - a.wins) || (opts.buchholz ? b.buchholz - a.buchholz : 0) || (b.h2h - a.h2h) ||
             (b.diff - a.diff) || a.name.localeCompare(b.name);
    });
    rows.forEach(function (r) { delete r.h2h; });
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
        // Clear a recorded winner if this match is no longer valid: either feeder slot is
        // now empty (an earlier result was undone) or the winner is no longer a participant.
        if (m.winner && (!m.p1 || !m.p2 || (m.winner !== m.p1 && m.winner !== m.p2))) { m.winner = null; m.score = null; }
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
  // Converging bracket columns for rendering: left/right are round-columns ordered
  // outer->inner (R1, R2, ...); final is the single center match.
  function seBracket(state) {
    var rs = state.rounds, R = rs.length;
    if (R === 0) return { left: [], final: null, right: [] };
    var left = [], right = [];
    for (var r = 0; r < R - 1; r++) {
      var ms = rs[r].matches, half = ms.length / 2;
      left.push(ms.slice(0, half));
      right.push(ms.slice(half));
    }
    return { left: left, final: rs[R - 1].matches[0] || null, right: right };
  }
  var singleElim = {
    init: seInit, recordResult: seRecord, undoResult: seUndo,
    standings: seStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s) { return s.champion; },
    view: function (s) { return { type: 'bracket', rounds: s.rounds }; },
    bracket: seBracket
  };

  // ---------- Swiss ----------
  function swInit(participants, options) {
    options = options || {};
    var target = options.rounds || Math.max(1, Math.ceil(Math.log2(participants.length)));
    var state = { format: 'swiss', options: { rounds: target }, rounds: [], completed: false, champion: null };
    swGenerate(state, participants, 1);
    return state;
  }
  function swGenerate(state, participants, index) {
    var order = swStandings(state, participants).map(function (r) { return r.playerId; });
    var mc = countMatches(state);
    var matches = [], pairs = null, byeId = null;
    if (index === 1) {
      var pool1 = order.slice();
      if (pool1.length % 2 === 1) byeId = pool1.pop();
      var half = pool1.length / 2;
      pairs = [];
      for (var k = 0; k < half; k++) pairs.push([pool1[k], pool1[k + half]]);
    } else if (order.length % 2 === 1) {
      // Bye goes to the lowest-ranked player without one yet — but only if the rest can
      // still be paired without rematches; otherwise try the next candidate up.
      var cands = order.slice().reverse().filter(function (id) { return !hadBye(state, id); });
      if (!cands.length) cands = [order[order.length - 1]];
      for (var c = 0; c < cands.length && !pairs; c++) {
        pairs = swPair(state, without(order, cands[c]), false);
        if (pairs) byeId = cands[c];
      }
      if (!pairs) { byeId = cands[0]; pairs = swPair(state, without(order, byeId), true); }
    } else {
      pairs = swPair(state, order, false) || swPair(state, order, true);
    }
    if (byeId != null) matches.push({ id: 'm' + (++mc), p1: byeId, p2: null, winner: byeId, score: null, bye: true });
    pairs.forEach(function (p) { matches.push(mkMatch(++mc, p[0], p[1])); });
    state.rounds.push({ index: index, matches: matches });
  }
  function without(arr, id) { return arr.filter(function (x) { return x !== id; }); }
  // Pair players in standings order: the top remaining player takes the closest-ranked
  // opponent they haven't played, backtracking when that leaves the rest unpairable
  // (plain greedy got stuck and forced avoidable rematches). allowRematch=true is the
  // fallback when no rematch-free pairing exists: unplayed opponents are still preferred.
  function swPair(state, pool, allowRematch) {
    var budget = 20000, played = {};
    eachMatch(state, function (m) { if (!m.bye && m.p2 != null) played[m.p1 + '|' + m.p2] = played[m.p2 + '|' + m.p1] = true; });
    function met(a, b) { return !!played[a + '|' + b]; }
    function rec(rest) {
      if (!rest.length) return [];
      if (--budget < 0) return null;
      var a = rest[0], others = rest.slice(1);
      var tryOrder = others.filter(function (b) { return !met(a, b); });
      if (allowRematch) tryOrder = tryOrder.concat(others.filter(function (b) { return met(a, b); }));
      for (var i = 0; i < tryOrder.length; i++) {
        var sub = rec(without(others, tryOrder[i]));
        if (sub) return [[a, tryOrder[i]]].concat(sub);
      }
      return null;
    }
    var res = rec(pool);
    if (!res && allowRematch) { // budget exhausted: plain adjacent pairing
      res = [];
      for (var i = 0; i + 1 < pool.length; i += 2) res.push([pool[i], pool[i + 1]]);
    }
    return res;
  }
  function roundIndexOf(state, matchId) {
    for (var r = 0; r < state.rounds.length; r++) {
      if (state.rounds[r].matches.some(function (m) { return m.id === matchId; })) return r;
    }
    return -1;
  }
  // true if any round after `ri` has a decided (non-bye) match
  function laterResults(state, ri) {
    return state.rounds.slice(ri + 1).some(function (rd) {
      return rd.matches.some(function (m) { return !m.bye && m.winner != null; });
    });
  }
  function swRecord(state, participants, matchId, winnerId, score) {
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    if (winnerId !== m.p1 && winnerId !== m.p2) return state;
    m.winner = winnerId; m.score = score || null;
    // Changing an earlier round while later rounds have no results yet: those pairings
    // were based on the old standings, so drop them and re-pair from this round.
    var ri = roundIndexOf(state, matchId);
    if (ri < state.rounds.length - 1 && !laterResults(state, ri)) {
      state.rounds = state.rounds.slice(0, ri + 1);
      state.completed = false; state.champion = null;
    }
    var cur = state.rounds[state.rounds.length - 1];
    var done = cur.matches.every(function (x) { return x.winner != null; });
    if (done) {
      if (state.rounds.length < state.options.rounds) {
        swGenerate(state, participants, state.rounds.length + 1);
      } else {
        state.completed = true;
        var st = swStandings(state, participants);
        state.champion = st.length ? st[0].playerId : null;
      }
    }
    return state;
  }
  function swUndo(state, participants, matchId) {
    var ri = roundIndexOf(state, matchId);
    if (ri < 0) return state;
    var m = findMatch(state, matchId);
    if (!m || m.bye) return state;
    state.rounds = state.rounds.slice(0, ri + 1);
    m.winner = null; m.score = null;
    state.completed = false; state.champion = null;
    return state;
  }
  function swStandings(state, participants) { return tallyStandings(state, participants, { buchholz: true }); }
  var swiss = {
    init: swInit, recordResult: swRecord, undoResult: swUndo,
    standings: swStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s, p) { return s.completed ? swStandings(s, p)[0].playerId : null; },
    view: function (s) { return { type: 'rounds', rounds: s.rounds }; },
    // UI asks for confirmation before an undo that would discard later rounds' results
    undoDropsResults: function (s, matchId) { var ri = roundIndexOf(s, matchId); return ri >= 0 && laterResults(s, ri); }
  };

  function setScore(state, matchId, score) {
    var m = findMatch(state, matchId);
    if (m) m.score = score || null;
    return state;
  }

  var BBEngines = {
    round_robin: roundRobin,
    single_elim: singleElim,
    swiss: swiss,
    setScore: setScore,
    _util: util,
    get: function (fmt) { return this[fmt]; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BBEngines;
  else root.BBEngines = BBEngines;
})(typeof window !== 'undefined' ? window : this);
