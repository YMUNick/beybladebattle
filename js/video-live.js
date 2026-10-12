/* 視訊直播 — 另一台手機當攝影機,以 WebRTC 點對點傳給觀眾(最多 5 人),連結 2 小時後失效。
   信令走 Firebase Realtime Database(/video/{videoId}),匿名登入與共用工具來自 window.BBLive。
   主辦端:賽事頁「🎥 視訊直播」→ 攝影機 QR + 觀眾連結。
   攝影機:?cam={videoId}&s={shareId}&exp={ms}。觀眾:?live={shareId}&video={videoId}&vexp={ms}。
   依賴 window.BBLive, window.FreeBattle, window.showScreen, window.toast, QRCode(qrcodejs)。 */
(function () {
  'use strict';
  var CFG = window.BB_LIVE_CONFIG || {};
  var LIFETIME = 2 * 3600 * 1000; // 視訊直播有效 2 小時(Firebase 規則同步強制)
  var MAX_VIEWERS = 5;
  var ICE = CFG.iceServers || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  var MAX_TIMEOUT = 2147483000; // setTimeout 上限

  function noop() {}
  function say(msg) { if (window.toast) toast(msg); }
  function configured() { return !!(window.BBLive && BBLive.configured()); }
  function supported() { return !!(window.RTCPeerConnection && window.EventSource); }
  function nodeUrl(path) { return BBLive.dbBase() + '/video/' + path + '.json'; }
  function authUrl(path, a) { return nodeUrl(path) + '?auth=' + encodeURIComponent(a.idToken); }
  function send(method, path, a, body) {
    return fetch(authUrl(path, a), {
      method: method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
  function pageBase() { return location.origin + location.pathname; }
  function camUrl(vid, sid, exp) {
    return pageBase() + '?cam=' + encodeURIComponent(vid) + '&s=' + encodeURIComponent(sid) + '&exp=' + exp;
  }
  function viewerUrl(sid, vid, exp) {
    return pageBase() + '?live=' + encodeURIComponent(sid) + '&video=' + encodeURIComponent(vid) + '&vexp=' + exp;
  }
  function setStatus(el, txt, cls) { el.textContent = txt; el.className = 'vidstatus' + (cls ? ' ' + cls : ''); }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    s %= 60;
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function shareLink(url) {
    if (navigator.share) { navigator.share({ title: 'BEYBLADE X 視訊直播', url: url }).catch(noop); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { say('已複製觀眾連結'); }, function () { window.prompt('複製觀眾連結', url); });
    } else window.prompt('複製觀眾連結', url);
  }
  // 非 trickle ICE:等候選收集完成(最多 2.5 秒)再一次送出完整 SDP
  function waitIce(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      var done = false;
      function fin() { if (done) return; done = true; pc.removeEventListener('icegatheringstatechange', chk); resolve(); }
      function chk() { if (pc.iceGatheringState === 'complete') fin(); }
      pc.addEventListener('icegatheringstatechange', chk);
      setTimeout(fin, 2500);
    });
  }
  // Firebase EventSource 的 put / patch 事件 → { path: ['a','b'], data, patch }
  function parseEvent(e) {
    var m; try { m = JSON.parse(e.data); } catch (x) { return null; }
    return { path: (m.path || '/').split('/').filter(Boolean), data: m.data, patch: e.type === 'patch' };
  }

  // ---------- 主辦端:產生攝影機 QR 與觀眾連結 ----------
  function openHost(tid) {
    if (!configured()) { say('尚未設定直播分享(js/live-config.js),步驟見 README'); return; }
    var t = BBLive.ensureShare(tid); if (!t) return;
    if (!t.videoId || !(t.videoExp > Date.now())) {
      t.videoId = BBLive.newId(); t.videoExp = Date.now() + LIFETIME;
      FreeBattle.upsert(t);
    }
    var cam = camUrl(t.videoId, t.shareId, t.videoExp);
    document.getElementById('vmUrl').value = viewerUrl(t.shareId, t.videoId, t.videoExp);
    document.getElementById('vmExpire').textContent = '連結有效至 ' + BBLive.fmtTime(t.videoExp) + '(2 小時)';
    var qr = document.getElementById('vmQr');
    qr.innerHTML = '';
    if (window.QRCode) new QRCode(qr, { text: cam, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    else qr.textContent = 'QR Code 載入失敗';
    document.getElementById('videoModal').classList.add('show');
    FreeBattle.refreshShareBtn(t);
  }
  function closeHost() { document.getElementById('videoModal').classList.remove('show'); }
  document.getElementById('vmCopy').addEventListener('click', function () { BBLive.copyText(document.getElementById('vmUrl')); });
  document.getElementById('vmShare').addEventListener('click', function () { shareLink(document.getElementById('vmUrl').value); });
  document.getElementById('vmClose').addEventListener('click', closeHost);
  document.getElementById('videoModal').addEventListener('click', function (e) { if (e.target.id === 'videoModal') closeHost(); });

  // ---------- 攝影機端 ----------
  function startCamera(vid, sid, exp) {
    showScreen('camera');
    var scr = document.getElementById('camera');
    var preview = document.getElementById('camPreview');
    var st = document.getElementById('camStatus');
    var startBtn = document.getElementById('camStart');
    var link = sid ? viewerUrl(sid, vid, exp) : '';
    var auth = null, stream = null, es = null, stopAt = 0, stopT = null, tick = null, wake = null, running = false;
    var peers = {}; // viewerUid -> { pc, offer }
    var state = {}; // 雲端 peers 節點的本機副本

    function linkExpired() { return !exp || Date.now() >= exp; }
    if (!configured()) { setStatus(st, '此網站尚未設定直播功能', 'err'); startBtn.disabled = true; return; }
    if (!supported() || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setStatus(st, '這個瀏覽器不支援視訊直播', 'err'); startBtn.disabled = true; return;
    }
    if (linkExpired()) { setStatus(st, '攝影機連結已過期,請在計分裝置重新產生', 'err'); startBtn.disabled = true; return; }

    function getMedia() {
      var video = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      return navigator.mediaDevices.getUserMedia({ video: video, audio: true })
        .catch(function () { return navigator.mediaDevices.getUserMedia({ video: video }); }); // 沒麥克風就只傳影像
    }
    // 建立 /video/{vid};已存在且是自己的(重新整理頁面)或已過期 → 刪掉重建
    function createNode() {
      return BBLive.getAuth().then(function (a) {
        auth = a;
        var put = function () { return send('PUT', vid, a, { owner: a.uid, createdAt: { '.sv': 'timestamp' } }); };
        return put().then(function (r) {
          if (r.ok) return r;
          return fetch(nodeUrl(vid) + '?shallow=true').then(function (r2) { return r2.ok ? r2.json() : null; }).then(function (node) {
            if (node && node.owner && node.owner !== a.uid) throw new Error('這個攝影機連結已被另一台裝置使用');
            return send('DELETE', vid, a).then(put);
          });
        });
      }).then(function (r) {
        if (!r.ok) throw new Error('無法建立直播(HTTP ' + r.status + ')');
        return r.json();
      }).then(function (j) { return typeof j.createdAt === 'number' ? j.createdAt : Date.now(); });
    }
    function keepAwake() {
      if (!navigator.wakeLock || !running) return;
      navigator.wakeLock.request('screen').then(function (w) { wake = w; }, noop);
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });

    function connectedCount() {
      return Object.keys(peers).filter(function (u) { return peers[u].pc.connectionState === 'connected'; }).length;
    }
    function updStatus() {
      if (!running) return;
      setStatus(st, '● 直播中・觀眾 ' + connectedCount() + '/' + MAX_VIEWERS + '・剩餘 ' + fmtLeft(stopAt - Date.now()), 'on');
    }
    function writePeer(uid, data) { return send('PATCH', vid + '/peers/' + uid, auth, data).catch(noop); }
    function closePeer(uid, remove) {
      var p = peers[uid]; if (!p) return;
      delete peers[uid];
      p.pc.onconnectionstatechange = null;
      p.pc.close();
      if (remove) send('DELETE', vid + '/peers/' + uid, auth).catch(noop);
      updStatus();
    }
    function answer(uid, offer) {
      var pc = new RTCPeerConnection({ iceServers: ICE });
      peers[uid] = { pc: pc, offer: offer };
      pc.onconnectionstatechange = function () {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(uid, true);
        updStatus();
      };
      pc.setRemoteDescription({ type: 'offer', sdp: offer }).then(function () {
        // 觀眾的 offer 是 recvonly 影像 + 聲音,把相機的軌道放進對應的 transceiver
        return Promise.all(pc.getTransceivers().map(function (tr) {
          var kind = tr.receiver.track && tr.receiver.track.kind;
          var track = stream.getTracks().filter(function (k) { return k.kind === kind; })[0];
          tr.direction = track ? 'sendonly' : 'inactive';
          return track ? tr.sender.replaceTrack(track) : null;
        }));
      }).then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () { return waitIce(pc); })
        .then(function () {
          if (!peers[uid] || peers[uid].pc !== pc) return;
          return writePeer(uid, { answer: pc.localDescription.sdp });
        })
        .catch(function () { closePeer(uid, true); });
    }
    function sync() {
      Object.keys(peers).forEach(function (uid) {
        if (!state[uid] || state[uid].offer !== peers[uid].offer) closePeer(uid, false); // 觀眾離開或重新發起
      });
      Object.keys(state).forEach(function (uid) {
        var p = state[uid];
        if (!p || !p.offer || peers[uid] || p.answer || p.full) return;
        if (Object.keys(peers).length >= MAX_VIEWERS) { writePeer(uid, { full: true }); return; }
        answer(uid, p.offer);
      });
    }
    function onPeers(e) {
      var ev = parseEvent(e); if (!ev) return;
      var path = ev.path, data = ev.data;
      if (!path.length) {
        if (ev.patch) Object.keys(data || {}).forEach(function (k) { if (data[k] === null) delete state[k]; else state[k] = data[k]; });
        else state = data || {};
      } else if (path.length === 1) {
        if (data === null) delete state[path[0]];
        else if (ev.patch) { state[path[0]] = state[path[0]] || {}; Object.keys(data).forEach(function (k) { state[path[0]][k] = data[k]; }); }
        else state[path[0]] = data;
      } else {
        var p = state[path[0]] = state[path[0]] || {};
        if (data === null) delete p[path[1]]; else p[path[1]] = data;
      }
      sync();
    }
    function listen() {
      if (!running) return;
      es = new EventSource(nodeUrl(vid + '/peers'));
      es.addEventListener('put', onPeers);
      es.addEventListener('patch', onPeers);
      es.onerror = function () {
        if (es.readyState !== 2 || !running) return;
        es = null; setTimeout(listen, 3000); // 連線被關閉:稍後重連
      };
    }
    function stop(msg, cls) {
      var wasRunning = running;
      running = false;
      if (es) { es.close(); es = null; }
      clearTimeout(stopT); clearInterval(tick);
      Object.keys(peers).forEach(function (uid) { closePeer(uid, false); });
      state = {};
      if (stream) stream.getTracks().forEach(function (k) { k.onended = null; k.stop(); });
      stream = null; preview.srcObject = null;
      if (wake) { wake.release().catch(noop); wake = null; }
      if (wasRunning && auth) send('DELETE', vid, auth).catch(noop);
      scr.classList.remove('running');
      startBtn.disabled = linkExpired();
      setStatus(st, msg, cls);
    }

    startBtn.addEventListener('click', function () {
      if (running) return;
      if (linkExpired()) { setStatus(st, '攝影機連結已過期,請在計分裝置重新產生', 'err'); startBtn.disabled = true; return; }
      startBtn.disabled = true;
      setStatus(st, '啟用相機中…');
      getMedia().then(function (s) {
        stream = s;
        preview.srcObject = s;
        preview.play().catch(noop);
        s.getTracks().forEach(function (k) { k.onended = function () { stop('相機已中斷,請重新開始直播', 'err'); }; });
        setStatus(st, '建立直播中…');
        return createNode();
      }).then(function (createdAt) {
        running = true;
        stopAt = Math.min(exp, createdAt + LIFETIME);
        stopT = setTimeout(function () { stop('視訊直播已滿 2 小時,已自動結束', 'err'); }, Math.min(stopAt - Date.now(), MAX_TIMEOUT));
        tick = setInterval(updStatus, 1000);
        scr.classList.add('running');
        updStatus(); keepAwake(); listen();
      }).catch(function (e) {
        var msg = e && e.name === 'NotAllowedError' ? '請允許使用相機後再試一次' : ('無法開始直播:' + (e && e.message || e));
        stop(msg, 'err');
      });
    });
    document.getElementById('camStop').addEventListener('click', function () { stop('已停止直播'); });
    document.getElementById('camShare').addEventListener('click', function () {
      if (link) shareLink(link); else say('缺少觀眾連結,請從計分裝置複製');
    });
    // 關掉頁面時盡量刪除雲端節點,觀眾端會立刻知道攝影機離線
    window.addEventListener('pagehide', function () {
      if (running && auth) fetch(authUrl(vid, auth), { method: 'DELETE', keepalive: true }).catch(noop);
    });
  }

  // ---------- 觀眾端 ----------
  function startViewer(vid, vexp) {
    document.body.classList.add('videoview');
    if (!new URLSearchParams(location.search).get('live')) { document.body.classList.add('liveview'); showScreen('tournament'); }
    var vEl = document.getElementById('tVideoEl');
    var st = document.getElementById('tVideoStatus');
    var snd = document.getElementById('tVideoSound');
    snd.addEventListener('click', function () { vEl.muted = false; vEl.play().catch(noop); snd.classList.add('hide'); });
    if (!configured()) { setStatus(st, '此網站尚未設定直播功能', 'err'); return; }
    if (!supported()) { setStatus(st, '這個瀏覽器不支援視訊直播', 'err'); return; }

    var me = null, pc = null, es = null, retryT = null, waitT = null, expT = null;
    var answered = false, fails = 0, dead = false;
    function peerPath() { return vid + '/peers/' + me.uid; }
    function retry(ms) { clearTimeout(retryT); retryT = setTimeout(join, ms); }
    function teardown(removeNode) {
      if (es) { es.close(); es = null; }
      clearTimeout(waitT);
      if (pc) { pc.onconnectionstatechange = null; pc.ontrack = null; pc.close(); pc = null; }
      if (removeNode && me) send('DELETE', peerPath(), me).catch(noop);
    }
    function expire() {
      dead = true;
      teardown(true); clearTimeout(retryT); clearTimeout(expT);
      vEl.srcObject = null;
      setStatus(st, '視訊直播已超過 2 小時,連結已失效', 'err');
    }
    function armExpiry(at) {
      clearTimeout(expT);
      expT = setTimeout(expire, Math.min(at - Date.now(), MAX_TIMEOUT));
    }
    function reconnect(msg) {
      if (dead) return;
      if (answered && pc && pc.connectionState !== 'connected') fails++; // 有回應但連不上 = 網路擋點對點
      teardown(true);
      setStatus(st, fails >= 3 ? '無法連線到攝影機,行動網路可能不支援,請改用 Wi-Fi' : (msg || '重新連線中…'), 'err');
      retry(3000);
    }
    function onPeer(e) {
      var ev = parseEvent(e); if (!ev) return;
      var ans = null, full = false, gone = false;
      if (!ev.path.length) { if (ev.data) { ans = ev.data.answer; full = ev.data.full; } else gone = !ev.patch; }
      else if (ev.path[0] === 'answer') ans = ev.data;
      else if (ev.path[0] === 'full') full = ev.data;
      if (full) {
        teardown(true);
        setStatus(st, '觀看人數已滿(最多 ' + MAX_VIEWERS + ' 人),稍後自動重試…', 'err');
        retry(10000); return;
      }
      if (gone) { reconnect(); return; } // 攝影機關掉了這條連線
      if (ans && !answered && pc) {
        answered = true;
        setStatus(st, '連線中…');
        pc.setRemoteDescription({ type: 'answer', sdp: ans }).catch(function () { reconnect(); });
      }
    }
    function connect() {
      teardown(false);
      answered = false;
      var thisPc = pc = new RTCPeerConnection({ iceServers: ICE });
      var ms = new MediaStream();
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.ontrack = function (e) {
        ms.addTrack(e.track);
        if (vEl.srcObject !== ms) vEl.srcObject = ms;
        vEl.play().catch(noop);
      };
      pc.onconnectionstatechange = function () {
        if (pc !== thisPc) return;
        var s = pc.connectionState;
        if (s === 'connected') { fails = 0; clearTimeout(waitT); setStatus(st, '● 視訊直播中', 'on'); }
        else if (s === 'failed' || s === 'closed') reconnect();
        else if (s === 'disconnected') {
          setStatus(st, '訊號不穩,重新連線中…', 'err');
          clearTimeout(waitT); waitT = setTimeout(function () { reconnect(); }, 6000);
        }
      };
      setStatus(st, '連線中…');
      return pc.createOffer()
        .then(function (o) { return thisPc.setLocalDescription(o); })
        .then(function () { return waitIce(thisPc); })
        .then(function () {
          if (pc !== thisPc) return null;
          return send('PUT', peerPath(), me, { offer: thisPc.localDescription.sdp });
        })
        .then(function (r) {
          if (!r || pc !== thisPc) return;
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var thisEs = es = new EventSource(nodeUrl(peerPath()));
          var guard = function (fn) { return function (e) { if (es === thisEs) fn(e); }; };
          es.addEventListener('put', guard(onPeer));
          es.addEventListener('patch', guard(onPeer));
          es.addEventListener('cancel', guard(function () { reconnect(); })); // 節點被刪(攝影機停止)→ 讀取權限消失
          es.onerror = guard(function () { if (thisEs.readyState === 2) reconnect(); });
          waitT = setTimeout(function () { if (pc === thisPc && !answered) reconnect('攝影機沒有回應,重試中…'); }, 15000);
        });
    }
    function join() {
      if (dead) return;
      if (vexp && Date.now() >= vexp) { expire(); return; }
      fetch(nodeUrl(vid) + '?shallow=true').then(function (r) { return r.ok ? r.json() : null; }).then(function (node) {
        if (dead) return;
        if (!node || !node.createdAt) {
          teardown(false); vEl.srcObject = null;
          setStatus(st, '等待攝影機開始直播…'); retry(4000); return;
        }
        var at = node.createdAt + LIFETIME;
        if (vexp) at = Math.min(at, vexp);
        if (Date.now() >= at) { expire(); return; }
        armExpiry(at);
        return BBLive.getAuth().then(function (a) { me = a; return connect(); });
      }).catch(function () { reconnect('連線中斷,重新連線中…'); });
    }
    // 關掉頁面時釋放名額,不用等攝影機端偵測到斷線
    window.addEventListener('pagehide', function () {
      if (me && !dead) fetch(authUrl(peerPath(), me), { method: 'DELETE', keepalive: true }).catch(noop);
    });
    if (vexp) armExpiry(vexp);
    join();
  }

  window.BBVideo = { openHost: openHost };

  var q = new URLSearchParams(location.search);
  if (q.get('cam')) startCamera(q.get('cam'), q.get('s'), +q.get('exp'));
  else if (q.get('video')) startViewer(q.get('video'), +q.get('vexp'));
})();
