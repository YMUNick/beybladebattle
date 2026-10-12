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
    if (t.shareId && window.BBLive) BBLive.publish(t);
  }
  function remove(id) {
    var t = getById(id);
    if (t && t.shareId && window.BBLive) BBLive.unpublish(t.shareId);
    save(load().filter(function (t) { return t.id !== id; }));
  }

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
    // 重賽時打亂選手順序,讓配對 / 種子位置重新洗牌
    var participants = BBEngines._util.shuffle(
      t.participants.map(function (p) { return { id: p.id, name: p.name }; }));
    var eng = BBEngines.get(t.format);
    var state = eng.init(participants, (t.state && t.state.options) || {});
    var base = t.name.replace(/\s*\(重賽\)\s*$/, '');
    var nt = {
      id: 't_' + Date.now().toString(36),
      name: base + ' (重賽)', format: t.format,
      createdAt: Date.now(), participants: participants, state: state
    };
    // 直播中的話,觀眾連結直接跟到新的一場
    if (t.shareId) { nt.shareId = t.shareId; delete t.shareId; upsert(t); }
    upsert(nt);
    openTournament(nt.id);
    if (window.toast) toast('已用相同名單開新一場');
  }
  var ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var ICON_UNDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  function renderStandings(t) {
    var eng = BBEngines.get(t.format);
    var rows = eng.standings(t.state, t.participants);
    var champ = eng.champion(t.state, t.participants);
    var bh = rows.length && rows[0].buchholz !== undefined; // 瑞士制才有對手分
    var html = '<div class="stwrap"><table class="sttable"><thead><tr>' +
      '<th class="strk">#</th><th class="stname">選手</th><th>勝-敗</th>' +
      (bh ? '<th title="所有對手的勝場加總">對手分</th>' : '') + '<th>勝率</th><th>積分差</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var real = (r.wins - (r.byes || 0)) + r.losses;
      var rk = r.rank <= 3 ? ' r' + r.rank : '';
      var diffCls = r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : '';
      html += '<tr class="' + (r.playerId === champ ? 'champrow' : '') + '">' +
        '<td class="strk"><span class="rk' + rk + '">' + r.rank + '</span></td>' +
        '<td class="stname">' + esc(r.name) + (r.playerId === champ ? ' <span class="sttag">冠軍</span>' : '') + '</td>' +
        '<td class="stwl"><b>' + r.wins + '</b><i>-</i><span>' + r.losses + '</span></td>' +
        (bh ? '<td class="stnum">' + r.buchholz + '</td>' : '') +
        // 只有輪空、尚無實際對戰時勝率顯示「—」,避免出現「1-0 / 0%」
        '<td class="stnum">' + (real ? Math.round(r.winPct * 100) + '%' : '—') + '</td>' +
        '<td class="stnum ' + diffCls + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</td></tr>';
    });
    html += '</tbody></table></div>';
    document.getElementById('tStandings').innerHTML = html;
  }
  function matchRowHtml(t, m) {
    if (m.bye) {
      return '<div class="mcard bye"><span class="mbye"><b>' + esc(nameOf(t, m.p1)) + '</b>輪空・自動晉級</span></div>';
    }
    var decided = m.winner != null;
    // m.score 是 [勝方, 敗方];換成 p1 / p2 的順序顯示
    var sc = m.score ? (m.winner === m.p1 ? m.score : [m.score[1], m.score[0]]) : null;
    function side(pid, i) {
      var isWin = decided && m.winner === pid, isLose = decided && !isWin;
      var cls = 'mplayer' + (i ? ' right' : '') + (isWin ? ' win' : '') + (isLose ? ' lose' : '') + (pid != null ? ' pick' : '');
      var label = nameOf(t, pid) + (isWin ? '(勝)' : decided ? '' : ',點選設為勝方');
      return '<button type="button" class="' + cls + '"' + (pid != null ? ' data-pick="' + m.id + '|' + pid + '"' : ' disabled') +
        ' aria-pressed="' + isWin + '" aria-label="' + esc(label) + '">' +
        '<span class="mpname">' + esc(nameOf(t, pid)) + '</span>' +
        (isWin ? '<span class="mptag">' + ICON_CHECK + 'WIN</span>' : '') + '</button>';
    }
    var mid = sc
      ? '<span class="mscore"><b class="' + (m.winner === m.p1 ? 'w' : '') + '">' + sc[0] + '</b><i>:</i><b class="' + (m.winner === m.p2 ? 'w' : '') + '">' + sc[1] + '</b></span>'
      : '<span class="mvs">VS</span>';
    var tools = decided
      ? '<div class="mtools"><button type="button" class="mtool" data-score="' + m.id + '">' + ICON_EDIT + (m.score ? '改比分' : '填比分') + '</button>' +
        '<button type="button" class="mtool" data-undo="' + m.id + '">' + ICON_UNDO + '清除</button></div>'
      : '';
    return '<div class="mcard' + (decided ? ' done' : '') + '"><div class="mrow">' + side(m.p1, 0) + '<div class="mmid">' + mid + '</div>' +
      side(m.p2, 1) + '</div>' + tools + '</div>';
  }
  function wireMatchControls(box, id) {
    if (readOnly) return;
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
    var last = t.state.rounds.length - 1;
    var anyDecided = false;
    var html = t.state.rounds.map(function (rd, ri) {
      var real = rd.matches.filter(function (m) { return !m.bye; });
      var done = real.filter(function (m) { return m.winner != null; }).length;
      if (done) anyDecided = true;
      var complete = done === real.length;
      var chip = complete ? '<span class="rchip ok">' + ICON_CHECK + '完成</span>'
        : '<span class="rchip live">' + done + ' / ' + real.length + (ri === last ? '・進行中' : '') + '</span>';
      return '<section class="rnd' + (complete ? ' complete' : '') + '"><div class="rndh"><span>第 ' + rd.index + ' 輪</span>' + chip + '</div>' +
        rd.matches.map(function (m) { return matchRowHtml(t, m); }).join('') + '</section>';
    }).join('');
    box.innerHTML = (anyDecided || readOnly ? '' : '<p class="mhint">點選手名字即可選出勝方</p>') + html;
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
      if (s[0] < 0 || s[1] < 0 || s[0] <= s[1]) { if (window.toast) toast('勝方分數要大於敗方'); return; }
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
    var html = '<div class="bracket-scroll"><div class="bracket">';
    b.left.forEach(function (rm) { html += bracketColHtml(t, rm, 'l', champId); });
    html += bracketColHtml(t, b.final ? [b.final] : [], 'final', champId);
    b.right.slice().reverse().forEach(function (rm) { html += bracketColHtml(t, rm, 'r', champId); });
    html += '</div></div>';
    var box = document.getElementById('tMatches');
    box.innerHTML = html;
    wireMatchControls(box, t.id);
  }
  function renderDetail(id) {
    var t = getById(id);
    if (!t) { showScreen('freebattle'); return; }
    renderTournament(t);
    refreshShareBtn(t);
  }
  // 觀眾端唯讀渲染(直播);點選 / 編輯控制由 body.liveview 的 CSS 隱藏且不綁定事件
  var readOnly = false;
  function renderView(t) { readOnly = true; renderTournament(t); }
  function refreshShareBtn(t) {
    var b = document.getElementById('tShareBtn');
    b.textContent = t && t.shareId ? '📡 直播中' : '📡 直播分享';
    b.classList.toggle('on', !!(t && t.shareId));
  }
  function renderTournament(t) {
    document.getElementById('tName').textContent = t.name;
    document.getElementById('tMeta').textContent = FORMAT_LABELS[t.format] + '・' + t.participants.length + ' 人・' + progressText(t);
    var isSE = t.format === 'single_elim';
    document.getElementById('tStandingsHead').style.display = isSE ? 'none' : '';
    document.getElementById('tStandings').style.display = isSE ? 'none' : '';
    renderChampion(t);
    if (isSE) { renderBracket(t); }
    else { renderStandings(t); renderMatches(t); }
  }
  // Picking/changing a winner clears that match's score by design (recordResult resets
  // score when no score arg is passed) — the old score described the old result.
  function record(id, matchId, winnerId) {
    var t = getById(id); if (!t) return;
    var eng = BBEngines.get(t.format);
    t.state = eng.recordResult(t.state, t.participants, matchId, winnerId);
    upsert(t); renderDetail(id);
  }
  function undo(id, matchId) {
    var t = getById(id); if (!t) return;
    var eng = BBEngines.get(t.format);
    var go = function () {
      t.state = eng.undoResult(t.state, t.participants, matchId);
      upsert(t); renderDetail(id);
    };
    // 瑞士制:清除較早輪次的結果會連帶刪掉之後輪次(配對依戰績產生),先確認
    if (eng.undoDropsResults && eng.undoDropsResults(t.state, matchId)) {
      (window.askConfirm ? askConfirm('清除這場會一併刪除之後輪次的所有對戰結果,確定?', '清除') : Promise.resolve(confirm('確定?')))
        .then(function (ok) { if (ok) go(); });
    } else go();
  }
  var openId = null;
  function openTournament(id) { openId = id; renderDetail(id); showScreen('tournament'); }

  // navigation
  document.getElementById('gotoFreeBattle').addEventListener('click', function () { renderList(); showScreen('freebattle'); });
  document.getElementById('fbHomeBtn').addEventListener('click', function () { showScreen('setup'); });
  document.getElementById('tBackBtn').addEventListener('click', function () { renderList(); showScreen('freebattle'); });
  document.getElementById('tRematchBtn').addEventListener('click', function () { if (openId) rematch(openId); });
  document.getElementById('tShareBtn').addEventListener('click', function () {
    if (!openId) return;
    if (window.BBLive) BBLive.openShare(openId); else if (window.toast) toast('直播模組未載入');
  });

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
    renderView: renderView, refreshShareBtn: refreshShareBtn,
    FORMAT_LABELS: FORMAT_LABELS, esc: esc
  };
})();
