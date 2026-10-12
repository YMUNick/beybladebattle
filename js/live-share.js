/* 直播分享 — 透過 Firebase Realtime Database REST API 同步賽事,觀眾掃 QR Code 即時觀看。
   依賴 window.BB_LIVE_CONFIG, window.FreeBattle, window.showScreen, window.toast, QRCode(qrcodejs)。
   主辦端:匿名登入後 PUT /live/{shareId};觀眾端:?live={shareId} 以 EventSource 串流唯讀顯示。 */
(function () {
  'use strict';
  var CFG = window.BB_LIVE_CONFIG || {};
  var AUTH_KEY = 'bb_live_auth';
  var LIFETIME = 48 * 3600 * 1000; // 直播連結有效 2 天(Firebase 規則同步強制)

  function configured() { return !!(CFG.apiKey && CFG.databaseURL); }
  function dbBase() { return CFG.databaseURL.replace(/\/+$/, ''); }
  function nodeUrl(shareId) { return dbBase() + '/live/' + encodeURIComponent(shareId) + '.json'; }
  function viewerUrl(shareId) { return location.origin + location.pathname + '?live=' + encodeURIComponent(shareId); }
  function expiresAt(createdAt) { return createdAt + LIFETIME; }
  function fmtTime(ms) {
    return new Date(ms).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // 沒有 shareCreatedAt 的是舊版建立的直播,視同過期
  function isExpired(t) { return !t.shareCreatedAt || Date.now() >= expiresAt(t.shareCreatedAt); }
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
  var creating = {}; // shareId -> true:第一次上傳要寫入 createdAt(伺服器時間)
  function publish(t) {
    if (!configured() || !t || !t.shareId) return;
    if (isExpired(t)) { expireLocal(t); return; }
    pending[t.shareId] = snapshot(t);
    flush();
  }
  function send(id, data, a, create) {
    var body = { owner: a.uid, updatedAt: { '.sv': 'timestamp' }, data: data };
    if (create) body.createdAt = { '.sv': 'timestamp' };
    // 更新用 PATCH,保留伺服器上的 createdAt(規則不允許改動)
    return fetch(nodeUrl(id) + '?auth=' + encodeURIComponent(a.idToken), {
      method: create ? 'PUT' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  function flush() {
    if (busy) return;
    var ids = Object.keys(pending);
    if (!ids.length) return;
    var id = ids[0], data = pending[id];
    delete pending[id];
    busy = true;
    getAuth().then(function (a) {
      return send(id, data, a, !!creating[id]).then(function (r) {
        // 雲端沒有這筆(例如建立時網路失敗後重新整理頁面):改成建立
        if (r.status === 401 && !creating[id]) return send(id, data, a, true);
        return r;
      });
    }).then(function (r) { if (!r.ok) return fail(r); delete creating[id]; })
      .catch(function (e) { if (window.toast) toast('直播同步失敗:' + e.message); })
      .then(function () { busy = false; flush(); });
  }
  // 過期:清掉本機的直播狀態並刪除雲端資料(在 upsert 之外執行,避免遞迴)
  function expireLocal(t) {
    setTimeout(function () {
      var x = FreeBattle.getById(t.id);
      if (!x || x.shareId !== t.shareId) return;
      unpublish(x.shareId);
      delete x.shareId; delete x.shareCreatedAt;
      FreeBattle.upsert(x);
      FreeBattle.refreshShareBtn(x);
      if (window.toast) toast('直播已超過 2 天,已自動結束');
    }, 0);
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
    if (t.shareId && isExpired(t)) { // 過期就開一個新的直播連結
      unpublish(t.shareId); delete t.shareId; delete t.shareCreatedAt;
      if (window.toast) toast('舊的直播已超過 2 天,已產生新的連結');
    }
    if (!t.shareId) {
      t.shareId = newShareId(); t.shareCreatedAt = Date.now();
      creating[t.shareId] = true;
      FreeBattle.upsert(t); // upsert 會觸發 publish
    } else publish(t);
    modalTid = tid;
    var url = viewerUrl(t.shareId);
    document.getElementById('lvUrl').value = url;
    document.getElementById('lvExpire').textContent = '連結有效至 ' + fmtTime(expiresAt(t.shareCreatedAt)) + '(2 天)';
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
      delete t.shareId; delete t.shareCreatedAt; FreeBattle.upsert(t);
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
    var node = null, es = null, expTimer = null;
    function ended(msg) {
      setStatus(msg, false);
      document.getElementById('tName').textContent = '—';
      ['tMeta', 'tChampion', 'tStandings', 'tMatches'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    }
    function expire() {
      if (es) es.close();
      clearTimeout(expTimer);
      ended('直播已超過 2 天,連結已失效');
    }
    function render() {
      if (node && node.createdAt && Date.now() >= expiresAt(node.createdAt)) { expire(); return; }
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
      setStatus('● 直播中・更新於 ' + ts.toLocaleTimeString('zh-TW', { hour12: false }) +
        (node.createdAt ? '・有效至 ' + fmtTime(expiresAt(node.createdAt)) : ''), true);
      if (node.createdAt) {
        clearTimeout(expTimer);
        expTimer = setTimeout(expire, Math.min(expiresAt(node.createdAt) - Date.now(), 2147483000));
      }
    }
    function apply(evt) {
      var msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      var path = (msg.path || '/').replace(/^\/+/, '');
      if (!path) node = (evt.type === 'patch') ? Object.assign(node || {}, msg.data) : msg.data;
      else { node = node || {}; node[path.split('/')[0]] = msg.data; }
      render();
    }
    // 規則拒絕讀取(過期或還不存在)時 EventSource 會直接關閉。剛分享時主辦端可能還在上傳,
    // 所以還沒收過資料前先重試幾次,再判定為已結束。
    var retries = 0, gotData = false;
    function connect() {
      es = new EventSource(nodeUrl(shareId));
      es.addEventListener('put', function (e) { gotData = true; apply(e); });
      es.addEventListener('patch', apply);
      es.addEventListener('cancel', function () { setStatus('無法讀取直播(權限設定?)', false); });
      es.onerror = function () {
        if (es.readyState !== 2) { setStatus('連線中斷,重新連線中…', false); return; }
        if (!gotData && retries++ < 5) { setStatus('連線中…', false); setTimeout(connect, 2000); return; }
        ended('直播已結束或連結已失效');
      };
    }
    connect();
  }

  document.getElementById('lvCopy').addEventListener('click', copyUrl);
  document.getElementById('lvStop').addEventListener('click', stopShare);
  document.getElementById('lvClose').addEventListener('click', closeShare);
  document.getElementById('liveModal').addEventListener('click', function (e) { if (e.target.id === 'liveModal') closeShare(); });

  window.BBLive = { configured: configured, publish: publish, unpublish: unpublish, openShare: openShare };

  var liveId = new URLSearchParams(location.search).get('live');
  if (liveId) startViewer(liveId);
})();
