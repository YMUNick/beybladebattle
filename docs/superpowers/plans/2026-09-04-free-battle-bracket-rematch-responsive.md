# 自由對戰 v2：重賽 / 單淘汰括號圖 / 比分編輯 / 響應式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "rematch same players", a converging single-elimination bracket view, editable scores + re-pickable winners, and full responsive layout to the existing 自由對戰 tournament feature.

**Architecture:** Two new pure functions in `js/tournament-engines.js` (`singleElim.bracket(state)` and `BBEngines.setScore(state, matchId, score)`), unit-tested in Node. UI changes in `js/free-battle.js`: a shared match-control wiring (click a player to set/change winner, `✎` to edit score, `↺` to clear), a `renderBracket()` for single-elim, and a `rematch()` action. Markup + CSS additions in `index.html` (rematch button, score-editor modal, bracket + responsive CSS). No new dependencies, no build.

**Tech Stack:** Vanilla JS (ES5-style), HTML, CSS. Tests: Node `node --test` (v24). jsdom smoke test installed to a throwaway dir (not committed).

---

## File Structure

- Modify: `js/tournament-engines.js` — add `seBracket` + `singleElim.bracket`, add `setScore` + `BBEngines.setScore`.
- Modify: `tests/engines.test.mjs` — tests for bracket shape, setScore, decided-winner change cascade.
- Modify: `index.html` — rematch button in `#tournament`; `id="tStandingsHead"` on the 積分榜 heading; `#scoreEditor` modal; CSS for bracket, score editor, `.miconbtn`, and responsive breakpoints.
- Modify: `js/free-battle.js` — `rematch()`, `findMatchInState()`, rewritten `matchRowHtml`, `wireMatchControls()`, updated `renderMatches`, new `renderBracket()` + bracket cell helpers, score-editor functions, updated `renderDetail`, new event wiring.

**Interface contracts (used across tasks):**
- `BBEngines.get('single_elim').bracket(state)` → `{ left: match[][], final: match|null, right: match[][] }` where `left`/`right` are arrays of round-columns ordered outer→inner (R1, R2, …), `final` is the center match.
- `BBEngines.setScore(state, matchId, score)` → sets `match.score` (`[winScore, loseScore] | null`), never touches `winner`; returns `state`.
- UI match controls use attributes: `data-pick="<matchId>|<playerId>"` (set/change winner), `data-score="<matchId>"` (edit score), `data-undo="<matchId>"` (clear winner).

---

## Task 1: Engine — `singleElim.bracket()` and `BBEngines.setScore()`

**Files:**
- Modify: `js/tournament-engines.js`
- Modify: `tests/engines.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `tests/engines.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engines.test.mjs`
Expected: the bracket tests FAIL (`se.bracket is not a function`) and the setScore test FAILS (`BBEngines.setScore is not a function`). The "changing a decided semifinal winner" test should already PASS (existing engine supports it) — that's fine, it's a regression guard.

- [ ] **Step 3: Implement**

In `js/tournament-engines.js`, add these two functions immediately **before** the `var singleElim = {` line (around line 263):

```js
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
```

Add `bracket: seBracket` to the `singleElim` object literal (after `view:`):

```js
  var singleElim = {
    init: seInit, recordResult: seRecord, undoResult: seUndo,
    standings: seStandings,
    isComplete: function (s) { return s.completed; },
    champion: function (s) { return s.champion; },
    view: function (s) { return { type: 'bracket', rounds: s.rounds }; },
    bracket: seBracket
  };
```

Add the `setScore` helper immediately **before** the `var BBEngines = {` line (around line 352):

```js
  function setScore(state, matchId, score) {
    var m = findMatch(state, matchId);
    if (m) m.score = score || null;
    return state;
  }
```

Add `setScore: setScore` to the `BBEngines` object literal:

```js
  var BBEngines = {
    round_robin: roundRobin,
    single_elim: singleElim,
    swiss: swiss,
    setScore: setScore,
    _util: util,
    get: function (fmt) { return this[fmt]; }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engines.test.mjs`
Expected: ALL tests PASS (previous suite + 5 new).

- [ ] **Step 5: Commit**

```bash
git add js/tournament-engines.js tests/engines.test.mjs
git commit -m "feat: single-elim bracket() view model and setScore() engine helper"
```

---

## Task 2: index.html — rematch button, score-editor modal, standings heading id, CSS

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the rematch button and heading id**

In the `#tournament` section, replace this block:

```html
  <div class="subbtns" style="margin-bottom:12px">
    <button class="ghostbtn" id="tBackBtn">↩ 賽事列表</button>
    <span id="tMeta" class="thint"></span>
  </div>
  <div id="tChampion"></div>
  <h3 class="rules-cat">積分榜</h3>
  <div id="tStandings"></div>
```

with:

```html
  <div class="subbtns" style="margin-bottom:12px">
    <button class="ghostbtn" id="tBackBtn">↩ 賽事列表</button>
    <button class="ghostbtn" id="tRematchBtn">♻ 重賽一次</button>
    <span id="tMeta" class="thint"></span>
  </div>
  <div id="tChampion"></div>
  <h3 class="rules-cat" id="tStandingsHead">積分榜</h3>
  <div id="tStandings"></div>
```

- [ ] **Step 2: Add the score-editor modal**

Immediately after the `#fbWizard` closing `</div>` (the wizard modal, ends just before `<div id="confirmBox">`), insert:

```html
<!-- ================= 自由對戰:比分編輯 ================= -->
<div id="scoreEditor">
  <div class="cwin">
    <div class="cmsg">輸入比分(選填)</div>
    <div class="scorerow">
      <div class="scol"><span class="snm" id="seN1"></span><input id="seP1" type="number" min="0" inputmode="numeric"></div>
      <span class="sdash">-</span>
      <div class="scol"><span class="snm" id="seN2"></span><input id="seP2" type="number" min="0" inputmode="numeric"></div>
    </div>
    <div class="cbtns">
      <button class="cok" id="seOk">確定</button>
      <button class="ccancel" id="seClear">清除</button>
      <button class="ccancel" id="seCancel">取消</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the CSS**

Immediately before `</style>`, insert:

```css
/* ====== 自由對戰 v2:括號圖 / 比分 / 響應式 ====== */
.miconbtn{background:none;border:1px solid rgba(0,255,160,.4);color:#9adf9f;border-radius:6px;cursor:pointer;font-size:12px;padding:1px 6px;line-height:1.5}
.miconbtn:hover{border-color:var(--neon);color:#eafff2}
.mname.pick{cursor:pointer;border-bottom:1px dotted rgba(0,255,160,.4)}
.mname.pick:hover{color:#7dffb0}
/* single-elim bracket */
.bracket{display:flex;overflow-x:auto;padding:8px 4px 18px;align-items:stretch}
.bcol{display:flex;flex-direction:column;justify-content:space-around;min-width:132px}
.bcol.final{justify-content:center}
.bcell{position:relative;display:flex;flex-direction:column;gap:2px;border:1px solid rgba(0,255,160,.3);border-radius:8px;
  background:rgba(0,40,25,.4);padding:5px 7px;margin:8px}
.bcell.champ{border-color:rgba(255,215,0,.7);background:rgba(255,215,0,.1)}
.bcell.l::after{content:'';position:absolute;right:-9px;top:50%;width:9px;height:1px;background:rgba(0,255,160,.4)}
.bcell.r::before{content:'';position:absolute;left:-9px;top:50%;width:9px;height:1px;background:rgba(0,255,160,.4)}
.bp{display:flex;justify-content:space-between;gap:6px;padding:3px 4px;border-radius:4px}
.bp.pick{cursor:pointer}
.bp.pick:hover{background:rgba(0,255,160,.12)}
.bp.win .bpn{color:#7dffb0;font-weight:700}
.bpn{color:#eafff2;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp.dim .bpn{color:#9adf9f;font-style:italic}
.bps{color:#9adf9f;font-size:13px;min-width:14px;text-align:right}
.btools{display:flex;gap:6px;justify-content:flex-end;margin-top:3px}
/* score editor modal */
#scoreEditor{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;z-index:70;padding:16px}
#scoreEditor.show{display:flex}
.scorerow{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin:14px 0}
.scol{display:flex;flex-direction:column;align-items:center;gap:4px}
.scol .snm{color:#9adf9f;font-size:13px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scorerow input{width:64px;text-align:center;font-size:18px}
.sdash{color:#9adf9f;padding-bottom:6px}
/* responsive */
@media (max-width:768px){
  #freebattle,#tournament{padding:0 8px 40px}
  .bcol{min-width:112px}
}
@media (max-width:480px){
  .fbcard{flex-direction:column;align-items:flex-start;gap:6px}
  .fbcard .fbdel{align-self:flex-end}
  .sttable{font-size:13px}
  .sttable th,.sttable td{padding:6px 6px}
  .matchrow{gap:4px}
  .mname{font-size:13px}
  .bpn{font-size:12px}
  .bcol{min-width:96px}
  .bcell{margin:6px}
}
```

- [ ] **Step 4: Verify structure**

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8'); ['tRematchBtn','tStandingsHead','scoreEditor','seN1','seN2','seP1','seP2','seOk','seClear','seCancel'].forEach(id=>console.log(id, h.includes('id=\"'+id+'\"')?'OK':'MISSING')); console.log('style tags', (h.match(/<\/style>/g)||[]).length);"`
Expected: every id `OK`, exactly `1` `</style>`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: rematch button, score-editor modal, bracket + responsive CSS"
```

---

## Task 3: free-battle.js — rematch, re-pickable winners on rows, score editor

**Files:**
- Modify: `js/free-battle.js`

- [ ] **Step 1: Add `findMatchInState` and `rematch`**

In `js/free-battle.js`, insert these two functions immediately **after** the `nameOf` function (after its closing `}` near line 64):

```js
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
```

- [ ] **Step 2: Rewrite `matchRowHtml` for clickable names + score/clear**

Replace the entire `matchRowHtml` function (lines ~82–98) with:

```js
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
```

- [ ] **Step 3: Add `wireMatchControls` and update `renderMatches`**

Replace the entire `renderMatches` function (lines ~99–114) with:

```js
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
```

- [ ] **Step 4: Add score-editor functions**

Insert these functions immediately **after** the `renderMatches` function you just wrote:

```js
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
```

- [ ] **Step 5: Track the open tournament id and wire the buttons**

First, replace `function openTournament(id) { renderDetail(id); showScreen('tournament'); }` (line ~141) with a version that remembers the open id:

```js
  var openId = null;
  function openTournament(id) { openId = id; renderDetail(id); showScreen('tournament'); }
```

Then, in the `// navigation` block (after the `tBackBtn` listener, ~line 146), add the rematch listener:

```js
  document.getElementById('tRematchBtn').addEventListener('click', function () { if (openId) rematch(openId); });
```

Finally, at the very end of the IIFE (just before `// expose for other tasks/modules`), add the score-editor button wiring:

```js
  document.getElementById('seOk').addEventListener('click', saveScore);
  document.getElementById('seClear').addEventListener('click', clearScore);
  document.getElementById('seCancel').addEventListener('click', closeScoreEditor);
```

- [ ] **Step 6: Verify it parses and run engine tests**

Run: `node -e "new Function(require('fs').readFileSync('js/free-battle.js','utf8')); console.log('parses OK')"`
Expected: `parses OK`.
Run: `node --test tests/engines.test.mjs`
Expected: all engine tests still PASS (no engine change here).

- [ ] **Step 7: Commit**

```bash
git add js/free-battle.js
git commit -m "feat: rematch action, re-pickable winners on match rows, score editor"
```

---

## Task 4: free-battle.js — single-elim bracket rendering + renderDetail switch

**Files:**
- Modify: `js/free-battle.js`

- [ ] **Step 1: Add bracket rendering functions**

Insert these functions immediately **after** the `renderChampion` function (near line 121):

```js
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
```

- [ ] **Step 2: Update `renderDetail` to switch bracket vs list**

Replace the entire `renderDetail` function (lines ~122–128) with:

```js
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
```

- [ ] **Step 3: Verify parse + engine tests**

Run: `node -e "new Function(require('fs').readFileSync('js/free-battle.js','utf8')); console.log('parses OK')"`
Expected: `parses OK`.
Run: `node --test tests/engines.test.mjs`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add js/free-battle.js
git commit -m "feat: converging single-elim bracket view with in-bracket pick/score"
```

---

## Task 5: End-to-end jsdom smoke test + responsive check

**Files:**
- Create (throwaway, NOT committed): a jsdom driver in a temp dir.

- [ ] **Step 1: Install jsdom in a throwaway dir**

Run:
```bash
mkdir -p /tmp/bbverify2 && cd /tmp/bbverify2 && npm init -y >/dev/null 2>&1 && npm install jsdom >/dev/null 2>&1 && node -e "console.log('jsdom', require('jsdom/package.json').version)"
```
Expected: prints a jsdom version.

- [ ] **Step 2: Write the driver**

Write `C:/Users/NICK/AppData/Local/Temp/bbverify2/drive.mjs` (note: use this Windows-style absolute path so the Bash `/tmp` and the file location match):

```js
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const REPO = 'G:/claude/project/beybladebattle';
const dom = new JSDOM(fs.readFileSync(REPO + '/index.html', 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://beyblade.local/' });
const { window } = dom, { document } = window;
window.showScreen = id => { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id); if (el) el.classList.add('active'); window.__screen = id;
  document.body.dataset.screen = id; };
window.askConfirm = () => Promise.resolve(true);
window.toast = m => { window.__toast = m; };
const LS = window.localStorage;
const run = p => window.eval(fs.readFileSync(REPO + p, 'utf8'));
run('/js/tournament-engines.js'); run('/js/free-battle.js');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } else console.log('ok -', m); };
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const addP = n => { document.getElementById('wzPlayer').value = n; click(document.getElementById('wzAdd')); };

// --- single-elim bracket + rematch + score ---
click(document.getElementById('gotoFreeBattle'));
click(document.getElementById('fbNewBtn'));
click(document.querySelector('#wzFormats [data-fmt="single_elim"]'));
['A','B','C','D'].forEach(addP);
click(document.getElementById('wzStart'));
assert(document.querySelector('#tMatches .bracket'), 'single-elim renders a bracket');
assert(document.getElementById('tStandings').style.display === 'none', 'standings hidden for single-elim');
assert(document.querySelectorAll('#tMatches .bcol').length === 3, 'bracket has 3 columns (L, final, R)');

// Decide both semifinals. Re-query each time: every pick re-renders the bracket,
// detaching old nodes. The side class ('l'/'r') is on the CELL, not the column.
click(document.querySelector('#tMatches .bcell.l .bp.pick'));
click(document.querySelector('#tMatches .bcell.r .bp.pick'));
// final now has two pickable players; crown one
assert(document.querySelectorAll('#tMatches .bcol.final .bp.pick').length === 2, 'final has two pickable players after semifinals');
click(document.querySelector('#tMatches .bcol.final .bp.pick'));
assert(/冠軍/.test(document.getElementById('tChampion').textContent), 'champion banner after final via bracket');

// re-pick: click the finalist who is NOT the current winner -> champion flips
const champBefore = document.getElementById('tChampion').textContent;
click(document.querySelector('#tMatches .bcol.final .bp.pick:not(.win)'));
assert(document.getElementById('tChampion').textContent !== champBefore, 'changing final winner updates champion');

// score edit on the final
click(document.querySelector('#tMatches .bcol.final .btools [data-score]'));
assert(document.getElementById('scoreEditor').classList.contains('show'), 'score editor opens');
document.getElementById('seP1').value = '3'; document.getElementById('seP2').value = '1';
click(document.getElementById('seOk'));
const seT = JSON.parse(LS.getItem('bb_tournaments'))[0];
const finalM = seT.state.rounds[seT.state.rounds.length - 1].matches[0];
assert(finalM.score && finalM.score[0] === 3 && finalM.score[1] === 1, 'score saved to final match');

// rematch: same players, new record, original kept
const beforeCount = JSON.parse(LS.getItem('bb_tournaments')).length;
click(document.getElementById('tRematchBtn'));
const list = JSON.parse(LS.getItem('bb_tournaments'));
assert(list.length === beforeCount + 1, 'rematch creates a new tournament, original kept');
const fresh = list.find(x => / \(重賽\)$/.test(x.name));
assert(fresh, 'rematch name has (重賽) suffix');
assert(fresh.state.rounds.flatMap(r => r.matches).every(m => m.bye || m.winner == null), 'rematch starts undecided');

// --- round-robin: re-pick winner on a row + score ---
click(document.getElementById('tBackBtn'));
click(document.getElementById('fbNewBtn'));
click(document.querySelector('#wzFormats [data-fmt="round_robin"]'));
['X','Y'].forEach(addP);
click(document.getElementById('wzStart'));
const rrPick = document.querySelectorAll('#tMatches .mname.pick');
assert(rrPick.length === 2, 'round-robin row players are clickable');
click(rrPick[0]);
assert(document.querySelector('#tMatches .mname.win'), 'clicking a row name sets winner');
// re-pick the other
const rrPick2 = document.querySelectorAll('#tMatches .mname.pick');
click(rrPick2[1]);
const winName = document.querySelector('#tMatches .mname.win').textContent;
assert(winName, 'winner can be changed by clicking the other row name: ' + winName);

console.log('\nALL v2 SMOKE CHECKS PASSED');
```

- [ ] **Step 3: Run the smoke test**

Run: `cd /tmp/bbverify2 && node drive.mjs`
Expected: every line `ok - ...` and final `ALL v2 SMOKE CHECKS PASSED`. If any assertion FAILs, fix the underlying UI/engine code (not the test), re-commit, and re-run.

- [ ] **Step 4: Clean up the throwaway dir**

Run: `rm -rf /tmp/bbverify2`

- [ ] **Step 5: Responsive manual check (controller)**

The controller launches the page (jsdom cannot verify layout) or serves it (`python -m http.server`) and eyeballs at ~375px, ~768px, ~1200px widths:
- Bracket horizontally scrolls on narrow screens; cells legible.
- List cards stack; standings table scrolls or fits; wizard modal scrolls within viewport.
- Existing scorer screens unaffected.

- [ ] **Step 6: Commit any responsive fixes**

```bash
git add -A
git commit -m "fix: responsive polish for free-battle v2"
```

---

## Self-Review Notes

- **Spec coverage:** rematch (T2 button + T3 `rematch()`), single-elim bracket (T1 `bracket()` + T4 `renderBracket`), standings hidden for single-elim (T4 `renderDetail`), score editing (T1 `setScore` + T2 modal + T3 editor fns), re-pickable winner incl. single-elim cascade (T1 test + T3/T4 `data-pick` → `record`), RR/swiss row enhancement (T3), responsive (T2 CSS + T5 check), tests (T1 unit + T5 e2e).
- **Type consistency:** `bracket()` returns `{left,final,right}` consumed identically in T4; `data-pick`/`data-score`/`data-undo` produced in T3 (`matchRowHtml`) and T4 (`bracketCellHtml`) and consumed by one `wireMatchControls` (T3); `BBEngines.setScore` defined T1, called T3; `openScoreEditor`/`renderDetail`/`record`/`undo` names consistent across tasks.
- **Ordering note:** T3 Step 4 references `openScoreEditor` (defined in the same step) and `renderDetail` (updated in T4); since these are function declarations inside one IIFE they are hoisted/resolved at call time, so intermediate commits parse and run. `renderBracket` is only invoked after T4, so T3's committed state (RR/swiss) is fully functional on its own.
- **Score semantics:** editing never calls `recordResult`, so winner is untouched (spec: 點勝方為主). Score editor refuses to open when no winner is set.
