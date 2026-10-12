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
  var ICON_TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
  function renderStandings(t) {
    var eng = BBEngines.get(t.format);
    var rows = eng.standings(t.state, t.participants);
    var champ = eng.champion(t.state, t.participants);
    var bh = rows.length && rows[0].buchholz !== undefined; // 瑞士制才有對手分
    var html = '<ol class="lb">' + rows.map(function (r) {
      var real = (r.wins - (r.byes || 0)) + r.losses;
      var pct = real ? Math.round(r.winPct * 100) : null;
      var diff = (r.diff > 0 ? '+' : '') + r.diff;
      var cls = 'lbrow' + (r.rank <= 3 ? ' r' + r.rank : '') + (r.playerId === champ ? ' champ' : '');
      function stat(label, val, extra) {
        return '<span class="lbstat' + (extra || '') + '"><em>' + label + '</em>' + val + '</span>';
      }
      return '<li class="' + cls + '">' +
        '<span class="lbrank" aria-label="第 ' + r.rank + ' 名">' + r.rank + '</span>' +
        '<div class="lbmain">' +
          '<div class="lbname">' + esc(r.name) + (r.playerId === champ ? '<span class="lbcrown">' + ICON_TROPHY + '冠軍</span>' : '') + '</div>' +
          '<div class="lbbar" aria-hidden="true"><i style="width:' + (pct || 0) + '%"></i></div>' +
          '<div class="lbstats">' +
            (bh ? stat('對手分', r.buchholz) : '') +
            stat('勝率', pct == null ? '—' : pct + '%') +
            stat('積分差', diff, r.diff > 0 ? ' pos' : r.diff < 0 ? ' neg' : '') +
          '</div>' +
        '</div>' +
        '<div class="lbwl" aria-label="' + r.wins + ' 勝 ' + r.losses + ' 敗"><b>' + r.wins + '</b><i>-</i><span>' + r.losses + '</span></div>' +
      '</li>';
    }).join('') + '</ol>';
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
      var pick = function () {
        var parts = el.getAttribute('data-pick').split('|');
        record(id, parts[0], parts[1]);
      };
      el.addEventListener('click', pick);
      if (el.getAttribute('role') === 'button') {
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
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
  function roundLabel(r, R) {
    var k = R - 1 - r;
    return k === 0 ? '決賽' : k === 1 ? '準決賽' : k === 2 ? '八強' : k === 3 ? '十六強' : '第 ' + (r + 1) + ' 輪';
  }
  // one match box: two player rows (name + score slab); winner row lit, loser dimmed
  function bkMatchHtml(t, m, isFinal, champId) {
    if (m.bye) {
      // 輪空的選手可能在 p1 或 p2(依種子位置),用 winner 取名字
      return '<div class="bkm bye"><div class="bkp win"><span class="bkn">' + esc(nameOf(t, m.winner)) + '</span><span class="bks"></span></div>' +
        '<div class="bkp tbd"><span class="bkn">輪空</span><span class="bks"></span></div></div>';
    }
    var decided = m.winner != null;
    var sc = m.score ? (m.winner === m.p1 ? m.score : [m.score[1], m.score[0]]) : null;
    function row(pid, i) {
      var isWin = decided && m.winner === pid;
      var cls = 'bkp' + (isWin ? ' win' : decided ? ' lose' : '') + (pid == null ? ' tbd' : ' pick');
      var attr = pid != null ? ' role="button" tabindex="0" data-pick="' + m.id + '|' + pid + '" aria-label="' +
        esc(nameOf(t, pid) + (isWin ? '(勝)' : ',點選設為勝方')) + '"' : '';
      var crown = isWin && isFinal && pid === champId ? '<span class="bkcrown">' + ICON_TROPHY + '</span>' : '';
      return '<div class="' + cls + '"' + attr + '><span class="bkn">' + crown + esc(pid == null ? '待定' : nameOf(t, pid)) + '</span>' +
        '<span class="bks">' + (sc ? sc[i] : '') + '</span></div>';
    }
    var tools = decided
      ? '<div class="bktools"><button type="button" class="bktool" data-score="' + m.id + '" aria-label="比分">' + ICON_EDIT + '</button>' +
        '<button type="button" class="bktool" data-undo="' + m.id + '" aria-label="清除">' + ICON_UNDO + '</button></div>'
      : '';
    var live = !decided && m.p1 != null && m.p2 != null ? ' ready' : '';
    return '<div class="bkm' + (decided ? ' done' : '') + live + (isFinal ? ' final' : '') +
      (isFinal && champId ? ' crowned' : '') + '">' + row(m.p1, 0) + row(m.p2, 1) + tools + '</div>';
  }
  // a round column; matches are grouped in feeder pairs so the CSS can draw the ⊐ joins
  function bkColHtml(t, label, matches, opts, champId) {
    var body = '';
    function slot(m) {
      var fed = m && (m.p1 != null || m.p2 != null) ? ' fed' : '';
      return '<div class="bkslot' + (m && m.winner != null ? ' won' : '') + fed + '">' + bkMatchHtml(t, m, opts.final, champId) + '</div>';
    }
    if (matches.length === 1) body = slot(matches[0]);
    else for (var i = 0; i < matches.length; i += 2) body += '<div class="bkpair">' + slot(matches[i]) + slot(matches[i + 1]) + '</div>';
    return '<div class="bkcol' + (opts.cls ? ' ' + opts.cls : '') + '"><div class="bkh">' + label + '</div><div class="bkbody">' + body + '</div></div>';
  }
  function renderBracket(t) {
    var eng = BBEngines.get('single_elim');
    var champId = eng.champion(t.state);
    var rs = t.state.rounds, R = rs.length;
    // phones: classic left-to-right tree; wide screens: two halves converging on the final
    var linear = rs.map(function (rd, r) {
      return bkColHtml(t, roundLabel(r, R), rd.matches, { final: r === R - 1, cls: r === 0 ? 'first' : r === R - 1 ? 'last' : '' }, champId);
    }).join('');
    var b = eng.bracket(t.state), conv = '';
    if (R > 1) {
      b.left.forEach(function (ms, r) { conv += bkColHtml(t, roundLabel(r, R), ms, { cls: r === 0 ? 'first' : '' }, champId); });
      conv += bkColHtml(t, '決賽', [b.final], { final: true, cls: 'center' }, champId);
      b.right.slice().reverse().forEach(function (ms, i, arr) {
        var r = arr.length - 1 - i;
        conv += bkColHtml(t, roundLabel(r, R), ms, { cls: 'rev' + (r === 0 ? ' first' : '') }, champId);
      });
    }
    var html = '<p class="bkhint" aria-hidden="true">← 左右滑動查看完整賽程 →</p><div class="bracket-scroll"><div class="bk bk-linear' + (R > 1 ? ' has-conv' : '') + '">' + linear + '</div>' +
      (R > 1 ? '<div class="bk bk-conv">' + conv + '</div>' : '') + '</div>';
    var box = document.getElementById('tMatches');
    box.innerHTML = html;
    // 畫面可能還沒顯示(先 render 再 showScreen),下一個 frame 再量寬度
    requestAnimationFrame(updBracketHint);
    wireMatchControls(box, t.id);
  }
  function updBracketHint() {
    var box = document.getElementById('tMatches'), sc = box.querySelector('.bracket-scroll');
    box.classList.toggle('bk-overflow', !!sc && sc.scrollWidth > sc.clientWidth + 4);
  }
  window.addEventListener('resize', updBracketHint);
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
