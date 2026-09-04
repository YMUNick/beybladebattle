/* 自由對戰 UI 邏輯 — 依賴 window.BBEngines, window.showScreen, window.askConfirm, window.toast */
(function () {
  'use strict';
  var KEY = 'bb_tournaments';

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

  function nameOf(t, pid) {
    if (pid == null) return '—';
    var p = t.participants.filter(function (x) { return x.id === pid; })[0];
    return p ? p.name : '—';
  }
  function findMatchInState(state, matchId) {
    for (var r = 0; r < state.rounds.length; r++) {
      var ms = state.rounds[r].matches;
      for (var i = 0; i < ms.length; i++) if (ms[i].id === matchId) return ms[i];
    }
    return null;
  }
  function rematch(id) {
    var t = getById(id); if (!t) return;
    if (t.participants.length < 2) { if (window.toast) toast('人數不足,無法重賽'); return; }
    var participants = t.participants.map(function (p) { return { id: p.id, name: p.name }; });
    var eng = BBEngines.get(t.format);
    var state = eng.init(participants, (t.state && t.state.options) || {});
    var base = t.name.replace(/\s*\(重賽\)\s*$/, '');
    var nt = {
      id: 't_' + Date.now().toString(36),
      name: base + ' (重賽)', format: t.format,
      createdAt: Date.now(), participants: participants, state: state
    };
    upsert(nt);
    openTournament(nt.id);
    if (window.toast) toast('已用相同名單開新一場');
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
    function nameCell(pid, isWin, right) {
      var clickable = pid != null;
      var cls = 'mname' + (isWin ? ' win' : '') + (clickable ? ' pick' : '');
      var attr = clickable ? ' data-pick="' + m.id + '|' + pid + '"' : '';
      return '<div class="mside' + (right ? ' right' : '') + '"><span class="' + cls + '"' + attr + '>' +
        esc(nameOf(t, pid)) + '</span></div>';
    }
    var scoreTxt = m.score ? m.score[0] + '-' + m.score[1] : 'VS';
    var tools = decided
      ? ' <button class="miconbtn" data-score="' + m.id + '" title="比分">✎</button>' +
        '<button class="miconbtn" data-undo="' + m.id + '" title="清除">↺</button>'
      : '';
    var mid = '<span class="mvs">' + scoreTxt + tools + '</span>';
    return '<div class="matchrow">' + nameCell(m.p1, m.winner === m.p1, false) + mid +
      nameCell(m.p2, m.winner === m.p2, true) + '</div>';
  }
  function wireMatchControls(box, id) {
    box.querySelectorAll('[data-pick]').forEach(function (el) {
      el.addEventListener('click', function () {
        var parts = el.getAttribute('data-pick').split('|');
        record(id, parts[0], parts[1]);
      });
    });
    box.querySelectorAll('[data-undo]').forEach(function (b) {
      b.addEventListener('click', function () { undo(id, b.getAttribute('data-undo')); });
    });
    box.querySelectorAll('[data-score]').forEach(function (b) {
      b.addEventListener('click', function () { openScoreEditor(id, b.getAttribute('data-score')); });
    });
  }
  function renderMatches(t) {
    var box = document.getElementById('tMatches');
    box.innerHTML = t.state.rounds.map(function (rd) {
      return '<div class="rnd"><div class="rndh">第 ' + rd.index + ' 輪</div>' +
        rd.matches.map(function (m) { return matchRowHtml(t, m); }).join('') + '</div>';
    }).join('');
    wireMatchControls(box, t.id);
  }
  var scoreCtx = null;
  function openScoreEditor(id, matchId) {
    var t = getById(id); if (!t) return;
    var m = findMatchInState(t.state, matchId);
    if (!m || m.winner == null) { if (window.toast) toast('請先選勝方再填比分'); return; }
    var winId = m.winner, loseId = (m.p1 === winId ? m.p2 : m.p1);
    scoreCtx = { id: id, matchId: matchId };
    document.getElementById('seN1').textContent = nameOf(t, winId);
    document.getElementById('seN2').textContent = nameOf(t, loseId);
    document.getElementById('seP1').value = m.score ? m.score[0] : '';
    document.getElementById('seP2').value = m.score ? m.score[1] : '';
    document.getElementById('scoreEditor').classList.add('show');
  }
  function saveScore() {
    if (!scoreCtx) return;
    var t = getById(scoreCtx.id);
    if (t) {
      var s = [parseInt(document.getElementById('seP1').value, 10) || 0,
               parseInt(document.getElementById('seP2').value, 10) || 0];
      BBEngines.setScore(t.state, scoreCtx.matchId, s);
      upsert(t); renderDetail(scoreCtx.id);
    }
    closeScoreEditor();
  }
  function clearScore() {
    if (!scoreCtx) return;
    var t = getById(scoreCtx.id);
    if (t) { BBEngines.setScore(t.state, scoreCtx.matchId, null); upsert(t); renderDetail(scoreCtx.id); }
    closeScoreEditor();
  }
  function closeScoreEditor() { document.getElementById('scoreEditor').classList.remove('show'); scoreCtx = null; }
  function renderChampion(t) {
    var eng = BBEngines.get(t.format);
    var box = document.getElementById('tChampion');
    if (eng.isComplete(t.state)) {
      box.innerHTML = '<div class="champbanner">🏆 冠軍:' + esc(nameOf(t, eng.champion(t.state, t.participants))) + '</div>';
    } else box.innerHTML = '';
  }
  function bracketCellHtml(t, m, side, champId) {
    if (!m) return '<div class="bcell ' + side + '"><div class="bp dim"><span class="bpn">—</span></div></div>';
    if (m.bye) {
      return '<div class="bcell ' + side + '">' +
        '<div class="bp win"><span class="bpn">' + esc(nameOf(t, m.p1)) + '</span></div>' +
        '<div class="bp dim"><span class="bpn">輪空</span></div></div>';
    }
    var decided = m.winner != null;
    function bp(pid, isWin) {
      var clickable = pid != null;
      var sc = m.score ? (isWin ? m.score[0] : m.score[1]) : '';
      return '<div class="bp' + (isWin ? ' win' : '') + (clickable ? ' pick' : ' dim') + '"' +
        (clickable ? ' data-pick="' + m.id + '|' + pid + '"' : '') + '>' +
        '<span class="bpn">' + esc(nameOf(t, pid)) + '</span><span class="bps">' + sc + '</span></div>';
    }
    var champ = (champId && m.winner === champId && side === 'final') ? ' champ' : '';
    var tools = decided
      ? '<div class="btools"><button class="miconbtn" data-score="' + m.id + '" title="比分">✎</button>' +
        '<button class="miconbtn" data-undo="' + m.id + '" title="清除">↺</button></div>'
      : '';
    return '<div class="bcell ' + side + champ + '">' + bp(m.p1, m.winner === m.p1) + bp(m.p2, m.winner === m.p2) + tools + '</div>';
  }
  function bracketColHtml(t, matches, side, champId) {
    return '<div class="bcol' + (side === 'final' ? ' final' : '') + '">' +
      matches.map(function (m) { return bracketCellHtml(t, m, side, champId); }).join('') + '</div>';
  }
  function renderBracket(t) {
    var b = BBEngines.get('single_elim').bracket(t.state);
    var champId = BBEngines.get('single_elim').champion(t.state);
    var html = '<div class="bracket">';
    b.left.forEach(function (rm) { html += bracketColHtml(t, rm, 'l', champId); });
    html += bracketColHtml(t, b.final ? [b.final] : [], 'final', champId);
    b.right.slice().reverse().forEach(function (rm) { html += bracketColHtml(t, rm, 'r', champId); });
    html += '</div>';
    var box = document.getElementById('tMatches');
    box.innerHTML = html;
    wireMatchControls(box, t.id);
  }
  function renderDetail(id) {
    var t = getById(id);
    if (!t) { showScreen('freebattle'); return; }
    document.getElementById('tName').textContent = t.name;
    document.getElementById('tMeta').textContent = FORMAT_LABELS[t.format] + '・' + t.participants.length + ' 人・' + progressText(t);
    var isSE = t.format === 'single_elim';
    document.getElementById('tStandingsHead').style.display = isSE ? 'none' : '';
    document.getElementById('tStandings').style.display = isSE ? 'none' : '';
    renderChampion(t);
    if (isSE) { renderBracket(t); }
    else { renderStandings(t); renderMatches(t); }
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
  var openId = null;
  function openTournament(id) { openId = id; renderDetail(id); showScreen('tournament'); }

  // navigation
  document.getElementById('gotoFreeBattle').addEventListener('click', function () { renderList(); showScreen('freebattle'); });
  document.getElementById('fbHomeBtn').addEventListener('click', function () { showScreen('setup'); });
  document.getElementById('tBackBtn').addEventListener('click', function () { renderList(); showScreen('freebattle'); });
  document.getElementById('tRematchBtn').addEventListener('click', function () { if (openId) rematch(openId); });

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
        '<button class="fmt" data-seed="random">隨機</button></div>';
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
      name: name, format: wz.format,
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

  document.getElementById('seOk').addEventListener('click', saveScore);
  document.getElementById('seClear').addEventListener('click', clearScore);
  document.getElementById('seCancel').addEventListener('click', closeScoreEditor);

  // expose for other tasks/modules
  window.FreeBattle = {
    load: load, save: save, getById: getById, upsert: upsert, remove: remove,
    renderList: renderList, openTournament: openTournament,
    FORMAT_LABELS: FORMAT_LABELS, esc: esc
  };
})();
