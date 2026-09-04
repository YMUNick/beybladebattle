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
