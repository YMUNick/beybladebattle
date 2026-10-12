/* 直播分享 — 透過 Firebase Realtime Database REST API 同步賽事,觀眾掃 QR Code 即時觀看。
   依賴 window.BB_LIVE_CONFIG, window.FreeBattle, window.showScreen, window.toast, QRCode(qrcodejs)。
   主辦端:匿名登入後 PUT /live/{shareId};觀眾端:?live={shareId} 以 EventSource 串流唯讀顯示。 */
(function () {
  'use strict';
  var CFG = window.BB_LIVE_CONFIG || {};
  var AUTH_KEY = 'bb_live_auth';

  function configured() { return !!(CFG.apiKey && CFG.databaseURL); }
  function dbBase() { return CFG.databaseURL.replace(/\/+$/, ''); }
  function nodeUrl(shareId) { return dbBase() + '/live/' + encodeURIComponent(shareId) + '.json'; }
  function viewerUrl(shareId) { return location.origin + location.pathname + '?live=' + encodeURIComponent(shareId); }
  function newShareId() {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    var buf = new Uint8Array(10);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) s += chars[buf[i] % chars.length];
    return s;
  }

  // ---------- 匿名登入(token 存本機,同一裝置維持同一 uid = 賽事擁有者) ----------
  function loadAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } }
  function saveAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {} }
  function fail(r) { return r.json().catch(function () { return {}; }).then(function (j) {
    throw new Error((j.error && (j.error.message || j.error)) || ('HTTP ' + r.status)); }); }
  function signUp() {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFG.apiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    }).then(function (r) { return r.ok ? r.json() : fail(r); }).then(function (j) {
      var a = { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (+j.expiresIn) * 1000 };
      saveAuth(a); return a;
    });
  }
  function refresh(a) {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + CFG.apiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refreshToken)
    }).then(function (r) { return r.ok ? r.json() : fail(r); }).then(function (j) {
      var n = { uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (+j.expires_in) * 1000 };
      saveAuth(n); return n;
    });
  }
  function getAuth() {
    var a = loadAuth();
    if (a && a.idToken && a.exp > Date.now() + 60000) return Promise.resolve(a);
    if (a && a.refreshToken) return refresh(a);
    return signUp();
  }

  // ---------- 主辦端:上傳(每個 shareId 只保留最新一筆,依序送出避免舊資料蓋掉新資料) ----------
  var pending = {}, busy = false;
  function snapshot(t) {
    return JSON.stringify({ name: t.name, format: t.format, participants: t.participants, state: t.state });
  }
  function publish(t) {
    if (!configured() || !t || !t.shareId) return;
    pending[t.shareId] = snapshot(t);
    flush();
  }
  function flush() {
    if (busy) return;
    var ids = Object.keys(pending);
    if (!ids.length) return;
    var id = ids[0], data = pending[id];
    delete pending[id];
    busy = true;
    getAuth().then(function (a) {
      return fetch(nodeUrl(id) + '?auth=' + encodeURIComponent(a.idToken), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: a.uid, updatedAt: { '.sv': 'timestamp' }, data: data })
      });
    }).then(function (r) { if (!r.ok) return fail(r); })
      .catch(function (e) { if (window.toast) toast('直播同步失敗:' + e.message); })
      .then(function () { busy = false; flush(); });
  }
  function unpublish(shareId) {
    if (!configured() || !shareId) return Promise.resolve();
    delete pending[shareId];
    return getAuth().then(function (a) {
      return fetch(nodeUrl(shareId) + '?auth=' + encodeURIComponent(a.idToken), { method: 'DELETE' });
    }).catch(function () {});
  }

  // ---------- 主辦端:分享彈窗 ----------
  var modalTid = null;
  function openShare(tid) {
    if (!configured()) { if (window.toast) toast('尚未設定直播分享(js/live-config.js),步驟見 README'); return; }
    var t = FreeBattle.getById(tid); if (!t) return;
    if (!t.shareId) { t.shareId = newShareId(); FreeBattle.upsert(t); } // upsert 會觸發 publish
    else publish(t);
    modalTid = tid;
    var url = viewerUrl(t.shareId);
    document.getElementById('lvUrl').value = url;
    var qr = document.getElementById('lvQr');
    qr.innerHTML = '';
    if (window.QRCode) new QRCode(qr, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    else qr.textContent = 'QR Code 載入失敗,請直接分享連結';
    document.getElementById('liveModal').classList.add('show');
    FreeBattle.refreshShareBtn(t);
  }
  function closeShare() { document.getElementById('liveModal').classList.remove('show'); modalTid = null; }
  function copyUrl() {
    var inp = document.getElementById('lvUrl'), url = inp.value;
    var done = function () { if (window.toast) toast('已複製連結'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { inp.select(); document.execCommand('copy'); done(); });
    else { inp.select(); document.execCommand('copy'); done(); }
  }
  function stopShare() {
    var t = modalTid && FreeBattle.getById(modalTid);
    if (t && t.shareId) {
      unpublish(t.shareId);
      delete t.shareId; FreeBattle.upsert(t);
      FreeBattle.refreshShareBtn(t);
      if (window.toast) toast('已停止直播');
    }
    closeShare();
  }

  // ---------- 觀眾端 ----------
  function startViewer(shareId) {
    document.body.classList.add('liveview');
    showScreen('tournament');
    var status = document.getElementById('tLiveStatus');
    function setStatus(txt, live) { status.textContent = txt; status.className = 'livestatus' + (live ? ' on' : ''); }
    if (!configured()) { setStatus('此網站尚未設定直播功能', false); return; }
    if (!window.EventSource) { setStatus('瀏覽器不支援即時更新', false); return; }
    setStatus('連線中…', false);
    var node = null;
    function render() {
      if (!node || !node.data) {
        setStatus('直播已結束或連結無效', false);
        document.getElementById('tName').textContent = '—';
        ['tMeta', 'tChampion', 'tStandings', 'tMatches'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
        return;
      }
      var t;
      try { t = JSON.parse(node.data); } catch (e) { return; }
      FreeBattle.renderView(t);
      var ts = node.updatedAt ? new Date(node.updatedAt) : new Date();
      setStatus('● 直播中・更新於 ' + ts.toLocaleTimeString('zh-TW', { hour12: false }), true);
    }
    function apply(evt) {
      var msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      var path = (msg.path || '/').replace(/^\/+/, '');
      if (!path) node = (evt.type === 'patch') ? Object.assign(node || {}, msg.data) : msg.data;
      else { node = node || {}; node[path.split('/')[0]] = msg.data; }
      render();
    }
    var es = new EventSource(nodeUrl(shareId));
    es.addEventListener('put', apply);
    es.addEventListener('patch', apply);
    es.addEventListener('cancel', function () { setStatus('無法讀取直播(權限設定?)', false); });
    es.onerror = function () { if (es.readyState !== 2) setStatus('連線中斷,重新連線中…', false); };
  }

  document.getElementById('lvCopy').addEventListener('click', copyUrl);
  document.getElementById('lvStop').addEventListener('click', stopShare);
  document.getElementById('lvClose').addEventListener('click', closeShare);
  document.getElementById('liveModal').addEventListener('click', function (e) { if (e.target.id === 'liveModal') closeShare(); });

  window.BBLive = { configured: configured, publish: publish, unpublish: unpublish, openShare: openShare };

  var liveId = new URLSearchParams(location.search).get('live');
  if (liveId) startViewer(liveId);
})();
