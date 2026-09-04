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

  // engines are attached in later tasks
  var BBEngines = {
    round_robin: roundRobin,
    single_elim: singleElim,
    _util: util,
    get: function (fmt) { return this[fmt]; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BBEngines;
  else root.BBEngines = BBEngines;
})(typeof window !== 'undefined' ? window : this);
