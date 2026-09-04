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
