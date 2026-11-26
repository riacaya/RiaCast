(() => {
  'use strict';

  const ADMIN_PEER_ID = 'riacast-99';
  const ADMIN_PASSWORD_HASH = '5d85f33c7ae322a3e50a7113d8ac16dee6aaa8e4f680697c234d05c0003bfb10';
  const ADMIN_FLAG_KEY = 'riacast-admin';
  const SETTINGS_KEY = 'riacast-settings';
  const VIEWER_ID_KEY = 'riacast-viewer-id';
  const THEME_KEY = 'riacast-theme';

  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    roleBadge: $('role-badge'),
    stageTitle: $('stage-title'),
    statusPill: $('status-pill'),
    statusDot: $('status-dot'),
    statusText: $('status-text'),
    mainVideo: $('main-video'),
    viewerPanel: $('viewer-panel'),
    viewerStrip: $('viewer-strip'),
    viewerList: $('viewer-list'),
    viewerScrollLeft: $('viewer-scroll-left'),
    viewerScrollRight: $('viewer-scroll-right'),
    videoOverlay: $('video-overlay'),
    overlayTitle: $('overlay-title'),
    overlaySub: $('overlay-sub'),
    localVideo: $('local-video'),
    localPip: $('local-pip'),
    localLabel: $('local-label'),
    myId: $('my-id'),
    targetId: $('target-id'),
    connCount: $('conn-count'),
    infoMode: $('info-mode'),
    infoPeer: $('info-peer'),
    infoAdmin: $('info-admin'),
    infoMedia: $('info-media'),
    logList: $('log-list'),
    btnSettings: $('btn-settings'),
    btnAdmin: $('btn-admin'),
    btnFullscreen: $('btn-fullscreen'),
    videoStage: $('video-stage'),
    settingsOverlay: $('settings-overlay'),
    adminOverlay: $('admin-overlay'),
    displayName: $('display-name'),
    prefCamera: $('pref-camera'),
    prefMic: $('pref-mic'),
    saveSettings: $('save-settings'),
    adminPassword: $('admin-password'),
    adminLogin: $('admin-login'),
    adminError: $('admin-error'),
    toggleAdminPassword: $('toggle-admin-password'),
  };

  const state = {
    mode: localStorage.getItem(ADMIN_FLAG_KEY) === '1' ? 'admin' : 'viewer',
    peer: null,
    peerOpen: false,
    localStream: null,
    displayName: '',
    settings: loadSettings(),
    viewerId: '',
    adminConn: null,
    adminCall: null,
    adminCallConnected: false,
    adminDetected: false,
    viewers: new Map(), // peerId -> { conn, call, thumb, video, name, stream }
    spotlightId: null, // admin: null=self, else viewer peerId
    detectTimer: null,
    reconnectTimer: null,
    destroyed: false,
  };

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        displayName: typeof raw.displayName === 'string' ? raw.displayName.slice(0, 32) : '',
        camera: raw.camera !== false,
        mic: raw.mic !== false,
      };
    } catch {
      return { displayName: '', camera: true, mic: true };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function applyTheme(theme) {
    const t = ['dark', 'senja', 'elegan'].includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
    qsa('.theme-btn[data-theme]').forEach((btn) => btn.classList.toggle('active', btn.dataset.theme === t));
  }

  function isAdmin() { return state.mode === 'admin'; }

  function log(msg) {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    const line = `[${time}] ${msg}`;
    if (els.logList) {
      const lines = els.logList.value ? els.logList.value.split('\n') : [];
      lines.unshift(line);
      if (lines.length > 80) lines.length = 80;
      els.logList.value = lines.join('\n');
    }
    console.log('[RiaCast]', msg);
  }

  function setStatus(text, kind = '') {
    if (els.statusText) els.statusText.textContent = text;
    if (els.statusPill) {
      els.statusPill.classList.remove('ok', 'err');
      if (kind) els.statusPill.classList.add(kind);
    }
  }

  function setOverlay(title, sub, show = true) {
    els.overlayTitle.textContent = title;
    els.overlaySub.textContent = sub;
    els.videoOverlay.classList.toggle('hidden', !show);
  }

  function setInfo(key, value) {
    qsa(`[data-info="${key}"]`).forEach((el) => { el.textContent = value; });
  }

  function updateCounts() {
    const count = isAdmin() ? state.viewers.size : (state.adminCall ? 1 : 0);
    setInfo('connCount', String(count));
    setInfo('admin', isAdmin() ? 'Kamu adalah admin' : (state.adminDetected ? 'Aktif' : 'Tidak terdeteksi'));
  }

  function setModeUI() {
    const admin = isAdmin();
    document.body.classList.toggle('mode-admin', admin);
    document.body.classList.toggle('mode-viewer', !admin);
    if (els.roleBadge) {
      els.roleBadge.textContent = admin ? 'PENYIAR' : 'PENONTON';
      els.roleBadge.classList.toggle('admin', admin);
      els.roleBadge.classList.toggle('viewer', !admin);
    }
    setInfo('mode', admin ? 'Penyiar (Admin)' : 'Penonton');
    setInfo('targetId', admin ? 'Menunggu penonton' : ADMIN_PEER_ID);
    els.btnAdmin?.classList.toggle('active-admin', admin);
    els.localLabel.textContent = 'Kamu';
    els.localPip.classList.toggle('hidden', admin);
    els.viewerPanel.classList.toggle('hidden', !admin);
    if (els.stageTitle) els.stageTitle.textContent = admin ? 'Menyiapkan siaran' : 'Menunggu siaran';
    if (admin) {
      state.spotlightId = null;
      setMainToSelf();
      if (state.localStream) setOverlay('', '', false);
      else setOverlay('Mode Penyiar', 'Menyiapkan kamera...', true);
      renderViewerPanel();
    } else {
      state.spotlightId = null;
      els.mainVideo.srcObject = null;
      els.mainVideo.muted = false;
    }
  }

  function setMainToSelf() {
    if (!els.mainVideo) return;
    els.mainVideo.muted = true;
    els.mainVideo.srcObject = state.localStream || null;
    els.mainVideo.play().catch(() => {});
  }

  function setMainToStream(stream, muted = false) {
    if (!els.mainVideo) return;
    els.mainVideo.muted = muted;
    if (els.mainVideo.srcObject !== stream) els.mainVideo.srcObject = stream || null;
    els.mainVideo.play().catch(() => {});
  }

  function setSpotlight(peerId) {
    if (!isAdmin()) return;
    state.spotlightId = peerId || null;
    if (!state.spotlightId) {
      setMainToSelf();
    } else {
      const v = state.viewers.get(state.spotlightId);
      if (v?.stream) setMainToStream(v.stream, false);
      else setMainToSelf();
    }
    renderViewerPanel();
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateViewerDurations() {
    if (!isAdmin()) return;
    for (const [peerId, v] of state.viewers) {
      const text = `${peerId} • ${formatDuration(Date.now() - (v.connectedAt || Date.now()))} tersambung`;
      const timeEl = els.viewerList?.querySelector(`[data-peer="${CSS.escape(peerId)}"] .viewer-item-time`);
      if (timeEl) timeEl.textContent = text;
    }
    const selfTime = els.viewerList?.querySelector('[data-peer="__self__"] .viewer-item-time');
    if (selfTime) selfTime.textContent = 'Penyiar';
  }

  function ensureViewerListItem(peerId, viewer) {
    if (!els.viewerList) return null;
    let item = els.viewerList.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
    const isSelf = peerId === '__self__';
    if (!item) {
      item = document.createElement('button');
      item.type = 'button';
      item.className = 'viewer-item';
      item.dataset.peer = peerId;
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'viewer-item-thumb';
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = isSelf;
      thumbWrap.appendChild(video);
      const meta = document.createElement('div');
      meta.className = 'viewer-item-meta';
      const name = document.createElement('div');
      name.className = 'viewer-item-name';
      const time = document.createElement('div');
      time.className = 'viewer-item-time';
      meta.appendChild(name);
      meta.appendChild(time);
      item.appendChild(thumbWrap);
      item.appendChild(meta);
      item.addEventListener('click', () => setSpotlight(isSelf ? null : (state.spotlightId === peerId ? null : peerId)));
      if (isSelf) els.viewerList.prepend(item);
      else els.viewerList.appendChild(item);
    }
    const video = item.querySelector('video');
    const nameEl = item.querySelector('.viewer-item-name');
    const timeEl = item.querySelector('.viewer-item-time');
    const name = isSelf ? 'Kamu (Penyiar)' : (viewer?.name || peerId);
    if (nameEl) nameEl.textContent = name;
    if (timeEl) timeEl.textContent = isSelf ? 'Penyiar' : `${peerId} • ${formatDuration(Date.now() - (viewer?.connectedAt || Date.now()))} tersambung`;
    if (isSelf) {
      if (video && video.srcObject !== state.localStream) video.srcObject = state.localStream || null;
    } else if (viewer) {
      viewer.listItem = item;
      viewer.listVideo = video;
      if (video && viewer.stream && video.srcObject !== viewer.stream) video.srcObject = viewer.stream;
    }
    item.classList.toggle('active', isSelf ? !state.spotlightId : state.spotlightId === peerId);
    return item;
  }

  function syncViewerSidebar() {
    if (!els.viewerList) return;
    if (!isAdmin()) { els.viewerList.innerHTML = ''; return; }
    ensureViewerListItem('__self__', null);
    [...els.viewerList.querySelectorAll('.viewer-item[data-peer]')].forEach((el) => {
      const id = el.dataset.peer;
      if (id !== '__self__' && !state.viewers.has(id)) el.remove();
    });
    for (const [peerId, viewer] of state.viewers) ensureViewerListItem(peerId, viewer);
    let empty = els.viewerList.querySelector('.viewer-empty');
    if (state.viewers.size === 0) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'viewer-empty'; empty.textContent = 'Belum ada penonton.'; els.viewerList.appendChild(empty); }
    } else if (empty) empty.remove();
  }

  function renderViewerPanel() {
    if (!isAdmin()) { syncViewerSidebar(); return; }
    els.viewerPanel.classList.remove('hidden');

    // Ensure self thumb
    let selfThumb = els.viewerStrip.querySelector('[data-peer="__self__"]');
    if (!selfThumb) {
      selfThumb = document.createElement('button');
      selfThumb.type = 'button';
      selfThumb.className = 'viewer-thumb';
      selfThumb.dataset.peer = '__self__';
      const v = document.createElement('video');
      v.autoplay = true; v.playsInline = true; v.muted = true;
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = 'Kamu (Penyiar)';
      selfThumb.appendChild(v);
      selfThumb.appendChild(label);
      selfThumb.addEventListener('click', () => setSpotlight(null));
      els.viewerStrip.prepend(selfThumb);
    }
    const selfVid = selfThumb.querySelector('video');
    if (selfVid && selfVid.srcObject !== state.localStream) selfVid.srcObject = state.localStream || null;
    selfThumb.classList.toggle('active', !state.spotlightId);

    // Remove thumbs for gone viewers
    [...els.viewerStrip.querySelectorAll('.viewer-thumb[data-peer]')].forEach((el) => {
      const id = el.dataset.peer;
      if (id !== '__self__' && !state.viewers.has(id)) el.remove();
    });
    syncViewerSidebar();
  }

  function upsertViewerThumb(peerId) {
    const viewer = state.viewers.get(peerId);
    if (!viewer || !isAdmin()) return;
    let thumb = els.viewerStrip.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
    if (!thumb) {
      thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'viewer-thumb';
      thumb.dataset.peer = peerId;
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true;
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = viewer.name || peerId;
      thumb.appendChild(video);
      thumb.appendChild(label);
      thumb.addEventListener('click', () => setSpotlight(state.spotlightId === peerId ? null : peerId));
      els.viewerStrip.appendChild(thumb);
      viewer.thumb = thumb;
      viewer.video = video;
    } else {
      viewer.thumb = thumb;
      viewer.video = thumb.querySelector('video');
      const label = thumb.querySelector('.thumb-label');
      if (label) label.textContent = viewer.name || peerId;
    }
    if (viewer.video && viewer.stream && viewer.video.srcObject !== viewer.stream) {
      viewer.video.srcObject = viewer.stream;
    }
    thumb.classList.toggle('active', state.spotlightId === peerId);
    ensureViewerListItem(peerId, viewer);
  }

  function removeViewerThumb(peerId) {
    const v = state.viewers.get(peerId);
    if (v?.thumb) { v.thumb.remove(); v.thumb = null; v.video = null; }
    if (v?.listItem) { v.listItem.remove(); v.listItem = null; v.listVideo = null; }
    const el = els.viewerStrip.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
    if (el) el.remove();
    const listEl = els.viewerList?.querySelector(`[data-peer="${CSS.escape(peerId)}"]`);
    if (listEl) listEl.remove();
    if (state.spotlightId === peerId) setSpotlight(null);
    renderViewerPanel();
  }

  function getViewerId() {
    const existing = sessionStorage.getItem(VIEWER_ID_KEY);
    if (existing && /^rc-\d+$/.test(existing)) return existing;
    const id = `rc-${Date.now()}`;
    sessionStorage.setItem(VIEWER_ID_KEY, id);
    return id;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function createFallbackStream() {
    const stream = new MediaStream();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#141922'; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#ff6a3d'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('RiaCast', 320, 170);
      ctx.fillStyle = '#9aa5b5'; ctx.font = '20px sans-serif';
      ctx.fillText(isAdmin() ? 'Penyiar' : 'Penonton', 320, 210);
      const vTrack = canvas.captureStream(5).getVideoTracks()[0];
      if (vTrack) stream.addTrack(vTrack);
    } catch {}
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const dst = ac.createMediaStreamDestination();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0; osc.connect(gain); gain.connect(dst); osc.start();
      const aTrack = dst.stream.getAudioTracks()[0];
      if (aTrack) stream.addTrack(aTrack);
      stream.__riacastAudioCtx = ac;
    } catch {}
    return stream;
  }

  async function ensureLocalStream() {
    if (state.localStream) return state.localStream;
    const wantVideo = state.settings.camera !== false;
    const wantAudio = state.settings.mic !== false;
    if (!wantVideo && !wantAudio) {
      setInfo('media', 'Mati (pengaturan)');
      const fallback = createFallbackStream();
      state.localStream = fallback;
      els.localVideo.srcObject = fallback;
      els.localPip.classList.toggle('hidden', isAdmin());
      return fallback;
    }
    const attempts = [];
    if (wantVideo && wantAudio) attempts.push({ video: true, audio: true, label: 'Kamera / Mic' });
    if (wantVideo) attempts.push({ video: true, audio: false, label: 'Kamera saja' });
    if (wantAudio) attempts.push({ video: false, audio: true, label: 'Mic saja' });

    for (const a of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: a.video, audio: a.audio });
        state.localStream = stream;
        els.localVideo.srcObject = stream;
        els.localPip.classList.toggle('hidden', isAdmin());
        setInfo('media', a.label);
        log('Media lokal siap: ' + a.label);
        if (isAdmin() && !state.spotlightId) setMainToSelf();
        if (isAdmin()) renderViewerPanel();
        if (isAdmin() && state.viewers.size === 0) setOverlay('', '', false);
        return stream;
      } catch (err) {
        log('Gagal media (' + a.label + '): ' + (err?.name || err?.message || err));
      }
    }

    setInfo('media', 'Media fallback');
    log('Semua percobaan media gagal, pakai fallback.');
    const fallback = createFallbackStream();
    state.localStream = fallback;
    els.localVideo.srcObject = fallback;
    els.localPip.classList.toggle('hidden', isAdmin());
    if (isAdmin() && !state.spotlightId) setMainToSelf();
    if (isAdmin()) renderViewerPanel();
    setOverlay('Izin media terbatas', 'Kamera/mic tidak dapat diakses. Periksa izin browser lalu refresh.', true);
    setTimeout(() => {
      if (isAdmin()) { setOverlay('', '', false); }
      else if (!state.adminCall) setOverlay('Mencari admin', 'Mendeteksi penyiar riacast-99...', true);
    }, 3000);
    return state.localStream;
  }

  function stopLocalStream() {
    if (!state.localStream) return;
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
    els.localVideo.srcObject = null;
  }

  function destroyPeer() {
    state.destroyed = true;
    clearTimeout(state.detectTimer);
    clearTimeout(state.reconnectTimer);
    try { state.adminConn?.close(); } catch {}
    try { state.adminCall?.close(); } catch {}
    for (const v of state.viewers.values()) {
      try { v.call?.close(); } catch {}
      try { v.conn?.close(); } catch {}
      v.thumb?.remove();
    }
    state.viewers.clear();
    try { state.peer?.destroy(); } catch {}
    state.peer = null;
    state.peerOpen = false;
  }

  function send(conn, payload) {
    try {
      if (conn && conn.open) { conn.send(payload); return true; }
    } catch (e) { console.warn('send failed', e); }
    return false;
  }

  function peerConfig() {
    return {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    };
  }

  function createPeer(id) {
    state.destroyed = false;
    const peer = new Peer(id, peerConfig());
    state.peer = peer;

    peer.on('open', (openId) => {
      state.peerOpen = true;
      setInfo('myId', openId);
      setInfo('peer', 'Terhubung');
      setStatus('PeerJS terhubung', 'ok');
      log(`PeerJS siap: ${openId}`);
      if (isAdmin()) onAdminPeerOpen();
      else onViewerPeerOpen();
    });

    peer.on('disconnected', () => {
      if (state.destroyed) return;
      state.peerOpen = false;
      setInfo('peer', 'Terputus');
      setStatus('PeerJS terputus, mencoba menyambung...', 'err');
      log('PeerJS terputus, mencoba reconnect...');
      try { peer.reconnect(); } catch { schedulePeerRestart(); }
    });

    peer.on('close', () => {
      if (state.destroyed) return;
      state.peerOpen = false;
      setInfo('peer', 'Tertutup');
      setStatus('Koneksi PeerJS tertutup', 'err');
      log('PeerJS tertutup.');
      schedulePeerRestart();
    });

    peer.on('error', (err) => {
      if (state.destroyed) return;
      const type = err?.type || '';
      console.warn('Peer error', type, err);
      if (type === 'unavailable-id') {
        if (isAdmin()) {
          setInfo('peer', 'ID bentrok');
          setStatus('ID admin sedang dipakai', 'err');
          setOverlay('Admin sudah aktif', 'ID riacast-99 sedang digunakan di sesi lain. Tutup sesi admin lain atau coba lagi.', true);
          log('ID admin riacast-99 bentrok.');
        } else {
          sessionStorage.removeItem(VIEWER_ID_KEY);
          state.viewerId = getViewerId();
          log('ID viewer bentrok, membuat ID baru...');
          schedulePeerRestart(300);
        }
        return;
      }
      if (type === 'peer-unavailable') {
        // target not online; handled by detection flow
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        setInfo('peer', 'Gangguan jaringan');
        setStatus('Gangguan jaringan PeerJS', 'err');
        schedulePeerRestart(1500);
        return;
      }
      log(`Peer error: ${type || err?.message || 'unknown'}`);
    });

    peer.on('connection', (conn) => {
      if (isAdmin()) handleAdminIncomingData(conn);
      else handleViewerIncomingData(conn);
    });

    peer.on('call', async (call) => {
      if (isAdmin()) await handleAdminIncomingCall(call);
      else await handleViewerIncomingCall(call);
    });
  }

  function schedulePeerRestart(delay = 2000) {
    if (state.destroyed) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      if (state.destroyed) return;
      try { state.peer?.destroy(); } catch {}
      state.peer = null;
      state.peerOpen = false;
      bootPeer();
    }, delay);
  }

  function bootPeer() {
    if (state.destroyed) return;
    const id = isAdmin() ? ADMIN_PEER_ID : state.viewerId;
    setInfo('myId', id);
    setInfo('peer', 'Menghubungkan...');
    setStatus('Menghubungkan ke PeerJS...', '');
    createPeer(id);
  }

  // ---------------- ADMIN ----------------
  function onAdminPeerOpen() {
    if (state.localStream) setOverlay('', '', false);
    else setOverlay('Mode Penyiar', 'Menyiapkan kamera...', true);
    if (els.stageTitle) els.stageTitle.textContent = 'Siaran aktif';
    setInfo('admin', 'Kamu adalah admin');
    log('Admin siap menerima penonton.');
  }

  function handleAdminIncomingData(conn) {
    conn.on('open', () => {
      log(`Data terhubung: ${conn.peer}`);
      const viewer = getOrCreateViewer(conn.peer);
      viewer.conn = conn;
      bindViewerConn(conn);
      // Auto greet; viewer will request call or we can initiate
      send(conn, { type: 'admin-welcome', adminId: ADMIN_PEER_ID });
    });
    bindViewerConn(conn);
  }

  function getOrCreateViewer(peerId) {
    let v = state.viewers.get(peerId);
    if (!v) {
      v = { peerId, conn: null, call: null, tile: null, thumb: null, video: null, listItem: null, listVideo: null, name: peerId, lastCallAt: 0, callConnected: false, connectedAt: Date.now() };
      state.viewers.set(peerId, v);
    }
    return v;
  }

  function bindViewerConn(conn) {
    if (conn.__riacastBound) return;
    conn.__riacastBound = true;
    conn.on('data', (data) => handleAdminData(conn.peer, data));
    conn.on('close', () => removeViewer(conn.peer, 'data-close'));
    conn.on('error', (err) => { console.warn('viewer conn error', err); removeViewer(conn.peer, 'data-error'); });
  }

  async function handleAdminData(peerId, data) {
    if (!data || typeof data !== 'object') return;
    const viewer = getOrCreateViewer(peerId);
    if (data.type === 'viewer-hello') {
      viewer.name = String(data.name || peerId).slice(0, 32);
      log(`Penonton hadir: ${viewer.name} (${peerId})`);
      send(viewer.conn, { type: 'admin-ready', adminId: ADMIN_PEER_ID });
      await autoApproveViewer(peerId);
    }
    if (data.type === 'request-call') {
      viewer.name = String(data.name || viewer.name || peerId).slice(0, 32);
      log(`Permintaan sambungan dari ${viewer.name} (${peerId}) - auto approve`);
      await autoApproveViewer(peerId);
    }
  }

  async function autoApproveViewer(peerId) {
    const viewer = state.viewers.get(peerId);
    if (!viewer) return;
    try {
      await ensureLocalStream();
    } catch {
      send(viewer.conn, { type: 'admin-error', message: 'Admin belum memberi izin kamera/mic.' });
      return;
    }
    send(viewer.conn, { type: 'call-approved' });

    if (viewer.callConnected && viewer.call && viewer.call.open) return;
    const now = Date.now();
    if (viewer.call && !viewer.callConnected && (now - (viewer.lastCallAt || 0)) < 12000) {
      return; // call sedang nego, jangan spam
    }

    if (viewer.call) {
      try { viewer.call.close(); } catch {}
      viewer.call = null;
      viewer.callConnected = false;
    }

    try {
      const call = state.peer.call(peerId, state.localStream, { metadata: { from: ADMIN_PEER_ID, type: 'broadcast' } });
      if (!call) { log(`Gagal memanggil ${peerId}`); return; }
      viewer.lastCallAt = now;
      viewer.callConnected = false;
      bindAdminCall(peerId, call);
      log(`Memanggil penonton: ${viewer.name}`);
    } catch (e) {
      log(`Gagal call ke ${peerId}: ${e?.message || e}`);
    }
  }

  function bindAdminCall(peerId, call) {
    const viewer = getOrCreateViewer(peerId);
    if (viewer.call && viewer.call !== call) {
      try { viewer.call.close(); } catch {}
    }
    viewer.call = call;
    viewer.callConnected = false;

    call.on('stream', (remoteStream) => {
      if (viewer.call !== call) return;
      viewer.callConnected = true;
      viewer.stream = remoteStream;
      upsertViewerThumb(peerId);
      if (state.spotlightId === peerId) setMainToStream(remoteStream, false);
      setStatus(`Terhubung ke ${state.viewers.size} penonton`, 'ok');
      setOverlay('', '', false);
      updateCounts();
      renderViewerPanel();
    });

    call.on('close', () => {
      log(`Call tertutup: ${peerId}`);
      if (viewer.call === call) {
        viewer.call = null;
        viewer.callConnected = false;
        viewer.stream = null;
      }
      removeViewerThumb(peerId);
      updateCounts();
      if (state.viewers.size === 0 && isAdmin()) {
        setOverlay('', '', false);
      }
      if (viewer.conn && viewer.conn.open && !state.destroyed) {
        setTimeout(() => { if (state.viewers.has(peerId)) autoApproveViewer(peerId); }, 1500);
      }
    });

    call.on('error', (err) => {
      console.warn('admin call error', peerId, err);
      log(`Call error ${peerId}: ${err?.type || err?.message || err}`);
      if (viewer.call === call) viewer.callConnected = false;
    });
  }

  async function handleAdminIncomingCall(call) {
    const peerId = call.peer;
    log(`Panggilan masuk dari ${peerId} - auto answer`);
    getOrCreateViewer(peerId);
    try { await ensureLocalStream(); } catch { return; }
    try {
      call.answer(state.localStream);
      bindAdminCall(peerId, call);
      const viewer = state.viewers.get(peerId);
      if (viewer?.conn) send(viewer.conn, { type: 'call-approved' });
    } catch (e) {
      log(`Gagal menjawab panggilan ${peerId}: ${e?.message || e}`);
    }
  }

  function removeViewer(peerId, reason) {
    const v = state.viewers.get(peerId);
    if (!v) return;
    try { v.call?.close(); } catch {}
    try { v.conn?.close(); } catch {}
    removeViewerThumb(peerId);
    state.viewers.delete(peerId);
    log(`Penonton keluar: ${peerId} (${reason || 'unknown'})`);
    updateCounts();
    if (isAdmin() && state.viewers.size === 0) {
      setStatus('Siaran aktif, menunggu penonton', 'ok');
      setOverlay('', '', false);
    }
  }

  // ---------------- VIEWER ----------------
  function onViewerPeerOpen() {
    setOverlay('Mencari admin', 'Mendeteksi penyiar riacast-99...', true);
    setInfo('admin', 'Memeriksa...');
    startAdminDetection();
  }

  function startAdminDetection() {
    clearTimeout(state.detectTimer);
    const attempt = async () => {
      if (state.destroyed || isAdmin()) return;
      if (!state.peerOpen) { state.detectTimer = setTimeout(attempt, 1500); return; }
      if (state.adminConn && state.adminConn.open) { state.detectTimer = setTimeout(attempt, 5000); return; }
      tryDetectAdmin();
      state.detectTimer = setTimeout(attempt, 4000);
    };
    attempt();
  }

  function tryDetectAdmin() {
    if (state.destroyed || isAdmin() || !state.peer || !state.peerOpen) return;
    // If already connected, just ensure hello
    if (state.adminConn && state.adminConn.open) return;
    log('Mendeteksi admin...');
    try {
      const conn = state.peer.connect(ADMIN_PEER_ID, { reliable: true, metadata: { role: 'viewer', name: getDisplayName() } });
      if (!conn) return;
      bindAdminConn(conn);
    } catch (e) {
      console.warn('detect admin failed', e);
    }
  }

  function bindAdminConn(conn) {
    if (state.adminConn && state.adminConn !== conn) {
      try { state.adminConn.close(); } catch {}
    }
    state.adminConn = conn;

    conn.on('open', () => {
      if (state.adminConn !== conn) return;
      state.adminDetected = true;
      setInfo('admin', 'Aktif');
      setStatus('Admin terdeteksi', 'ok');
      setOverlay('Admin terdeteksi', 'Meminta sambungan otomatis...', true);
      log('Terhubung ke admin, mengirim hello...');
      updateCounts();
      send(conn, { type: 'viewer-hello', name: getDisplayName(), viewerId: state.viewerId });
      // Auto request call (no click)
      send(conn, { type: 'request-call', name: getDisplayName(), viewerId: state.viewerId });
    });

    conn.on('data', (data) => handleViewerData(data));
    conn.on('close', () => {
      if (state.adminConn !== conn) return;
      state.adminConn = null;
      state.adminDetected = false;
      setInfo('admin', 'Tidak terdeteksi');
      updateCounts();
      if (!state.adminCall) {
        setStatus('Admin terputus, mencari...', '');
        setOverlay('Mencari admin', 'Mendeteksi penyiar riacast-99...', true);
      }
      log('Koneksi data admin tertutup.');
    });
    conn.on('error', (err) => {
      console.warn('admin conn error', err);
    });
  }

  function handleViewerIncomingData(conn) {
    // viewer shouldn't normally receive other data connections; ignore or handle admin responses
    if (conn.peer === ADMIN_PEER_ID) bindAdminConn(conn);
  }

  async function handleViewerData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'admin-welcome' || data.type === 'admin-ready') {
      state.adminDetected = true;
      setInfo('admin', 'Aktif');
      updateCounts();
      // Ensure request sent
      if (!state.adminCall) {
        send(state.adminConn, { type: 'request-call', name: getDisplayName(), viewerId: state.viewerId });
        setOverlay('Admin terdeteksi', 'Meminta sambungan otomatis...', true);
      }
    }
    if (data.type === 'call-approved') {
      log('Sambungan disetujui admin, menunggu media...');
      setOverlay('Disetujui', 'Menunggu stream media dari admin...', true);
    }
    if (data.type === 'admin-error') {
      setOverlay('Info admin', String(data.message || 'Terjadi kendala di sisi admin.'), true);
    }
  }

  async function handleViewerIncomingCall(call) {
    if (call.peer !== ADMIN_PEER_ID) {
      log(`Panggilan ditolak dari peer tidak dikenal: ${call.peer}`);
      try { call.close(); } catch {}
      return;
    }
    if (state.adminCall && state.adminCallConnected && state.adminCall.open) {
      log('Panggilan duplikat dari admin diabaikan.');
      try { call.close(); } catch {}
      return;
    }
    log('Panggilan masuk dari admin - auto answer');
    try { await ensureLocalStream(); } catch { return; }
    try {
      call.answer(state.localStream);
    } catch (e) {
      log('Gagal menjawab call admin: ' + (e?.message || e));
      return;
    }
    bindViewerCall(call);
  }

  function bindViewerCall(call) {
    if (state.adminCall && state.adminCall !== call) {
      try { state.adminCall.close(); } catch {}
    }
    state.adminCall = call;
    state.adminCallConnected = false;
    call.on('stream', (remoteStream) => {
      if (state.adminCall !== call) return;
      state.adminCallConnected = true;
      setMainToStream(remoteStream, false);
      setOverlay('', '', false);
      setStatus('Terhubung ke siaran', 'ok');
      if (els.stageTitle) els.stageTitle.textContent = 'Siaran langsung';
      log('Stream admin diterima.');
      updateCounts();
    });
    call.on('close', () => {
      if (state.adminCall !== call) return;
      state.adminCall = null;
      state.adminCallConnected = false;
      if (els.mainVideo) els.mainVideo.srcObject = null;
      setStatus('Siaran terputus', '');
      if (els.stageTitle) els.stageTitle.textContent = 'Menunggu siaran';
      setOverlay('Siaran terputus', 'Menunggu admin kembali online...', true);
      log('Call admin tertutup.');
      updateCounts();
      if (state.adminConn && state.adminConn.open) {
        setTimeout(() => {
          if (state.adminConn && state.adminConn.open && !state.adminCall) {
            send(state.adminConn, { type: 'request-call', name: getDisplayName(), viewerId: state.viewerId });
          }
        }, 1200);
      }
    });
    call.on('error', (err) => {
      log('Call error: ' + (err?.type || err?.message || err));
      if (state.adminCall === call) state.adminCallConnected = false;
    });
  }

  function getDisplayName() {
    return (state.settings.displayName || '').trim() || (isAdmin() ? 'Admin' : state.viewerId);
  }

  // ---------------- UI ----------------
  function openOverlay(id) { $(id)?.classList.remove('hidden'); }
  function closeOverlay(id) { $(id)?.classList.add('hidden'); }
  function setDeviceTab(tab) {
    qsa('.tab-btn[data-tab]').forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    qsa('.tab-pane[data-tab-pane]').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.tabPane === tab);
    });
  }

  function syncSidebarHeight() {
    const stageCard = document.querySelector('.stage-card');
    const side = document.querySelector('.side-card');
    if (!stageCard || !side) return;
    if (window.innerWidth <= 980) {
      side.style.height = '';
      side.style.marginTop = '';
      return;
    }
    // Break circular sizing: let stage-card settle to natural height first
    side.style.height = '0px';
    const cardH = stageCard.getBoundingClientRect().height;
    side.style.marginTop = '0px';
    side.style.height = cardH + 'px';
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  async function toggleFullscreen() {
    const stage = els.videoStage || $('video-stage');
    if (!stage) return;
    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (stage.requestFullscreen) await stage.requestFullscreen();
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
      else if (els.mainVideo?.webkitEnterFullscreen) { els.mainVideo.webkitEnterFullscreen(); return; }
      else return;
      if (screen.orientation && screen.orientation.lock) {
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
        if (isMobile) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }
    } catch (e) {
      log('Fullscreen gagal: ' + (e?.message || e));
    }
  }

  function syncFullscreenUI() {
    const active = !!getFullscreenElement();
    const expand = $('fs-icon-expand');
    const compress = $('fs-icon-compress');
    if (expand) expand.classList.toggle('hidden', active);
    if (compress) compress.classList.toggle('hidden', !active);
    if (els.btnFullscreen) {
      els.btnFullscreen.setAttribute('aria-label', active ? 'Keluar layar penuh' : 'Layar penuh');
      els.btnFullscreen.setAttribute('title', active ? 'Keluar layar penuh' : 'Layar penuh');
    }
    if (!active && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch {}
    }
  }

  function bindUI() {
    qsa('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeOverlay(btn.getAttribute('data-close')));
    });
    window.addEventListener('resize', syncSidebarHeight);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(syncSidebarHeight);
      const stageCard = document.querySelector('.stage-card');
      const stage = document.querySelector('.video-stage');
      const side = document.querySelector('.side-card');
      if (stageCard) ro.observe(stageCard);
      if (stage) ro.observe(stage);
      if (side) ro.observe(side);
    }
    els.viewerScrollLeft?.addEventListener('click', () => {
      els.viewerStrip.scrollBy({ left: -240, behavior: 'smooth' });
    });
    els.viewerScrollRight?.addEventListener('click', () => {
      els.viewerStrip.scrollBy({ left: 240, behavior: 'smooth' });
    });
    ['settings-overlay', 'admin-overlay', 'device-overlay', 'about-overlay'].forEach((id) => {
      const ov = $(id);
      ov?.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeOverlay('settings-overlay');
        closeOverlay('admin-overlay');
        closeOverlay('device-overlay');
        closeOverlay('about-overlay');
      }
    });
    els.btnFullscreen?.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', syncFullscreenUI);
    document.addEventListener('webkitfullscreenchange', syncFullscreenUI);

    els.btnSettings.addEventListener('click', () => {
      openOverlay('settings-overlay');
    });
    $('open-device-panel')?.addEventListener('click', () => {
      els.displayName.value = state.settings.displayName || '';
      els.prefCamera.checked = state.settings.camera !== false;
      els.prefMic.checked = state.settings.mic !== false;
      setDeviceTab('device');
      openOverlay('device-overlay');
    });
    $('open-about-panel')?.addEventListener('click', () => openOverlay('about-overlay'));
    qsa('.tab-btn[data-tab]').forEach((btn) => btn.addEventListener('click', () => setDeviceTab(btn.dataset.tab)));
    qsa('.theme-btn[data-theme]').forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

    els.saveSettings.addEventListener('click', async () => {
      state.settings.displayName = els.displayName.value.trim().slice(0, 32);
      state.settings.camera = els.prefCamera.checked;
      state.settings.mic = els.prefMic.checked;
      saveSettings();
      closeOverlay('device-overlay');
      log('Pengaturan device disimpan.');
      // Apply media changes: restart stream if needed
      const hadStream = !!state.localStream;
      stopLocalStream();
      if (hadStream || isAdmin()) {
        try { await ensureLocalStream(); } catch {}
      }
    });

    $('open-admin-panel')?.addEventListener('click', () => {
      els.adminPassword.value = '';
      els.adminError.textContent = '';
      els.adminError.style.color = '';
      closeOverlay('settings-overlay');
      openOverlay('admin-overlay');
      if (isAdmin()) {
        els.adminError.style.color = '#8fd19e';
        els.adminError.textContent = 'Anda sudah masuk sebagai penyiar (admin).';
        els.adminPassword.disabled = true;
        els.adminLogin.disabled = true;
        return;
      }
      els.adminPassword.disabled = false;
      els.adminLogin.disabled = false;
      setTimeout(() => els.adminPassword.focus(), 50);
    });

    els.toggleAdminPassword.addEventListener('click', () => {
      const show = els.adminPassword.type === 'password';
      els.adminPassword.type = show ? 'text' : 'password';
      els.toggleAdminPassword.textContent = show ? '🙈' : '👁';
    });

    els.adminLogin.addEventListener('click', handleAdminLogin);
    els.adminPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdminLogin(); });
  }

  async function handleAdminLogin() {
    const password = els.adminPassword.value || '';
    if (!password) { els.adminError.textContent = 'Password wajib diisi.'; return; }
    els.adminLogin.disabled = true;
    els.adminError.textContent = '';
    try {
      const hash = await sha256Hex(password);
      if (hash !== ADMIN_PASSWORD_HASH) {
        els.adminError.textContent = 'Password salah.';
        return;
      }
      log('Password admin benar. Beralih ke mode penyiar...');
      localStorage.setItem(ADMIN_FLAG_KEY, '1');
      sessionStorage.removeItem(VIEWER_ID_KEY);
      destroyPeer();
      stopLocalStream();
      // Refresh then enter as broadcaster (ADMIN) as specified
      location.reload();
    } catch (e) {
      els.adminError.textContent = 'Gagal memverifikasi password.';
    } finally {
      els.adminLogin.disabled = false;
    }
  }

  // ---------------- BOOT ----------------
  async function boot() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    setModeUI();
    bindUI();
    setInterval(updateViewerDurations, 1000);
    els.displayName.value = state.settings.displayName || '';
    els.prefCamera.checked = state.settings.camera !== false;
    els.prefMic.checked = state.settings.mic !== false;

    if (!window.Peer) {
      setStatus('PeerJS tidak tersedia', 'err');
      setOverlay('PeerJS gagal dimuat', 'File peerjs.min.js tidak ditemukan.', true);
      return;
    }

    if (isAdmin()) {
      state.viewerId = '';
      setInfo('myId', ADMIN_PEER_ID);
      log('Memulai mode penyiar (ADMIN).');
    } else {
      state.viewerId = getViewerId();
      setInfo('myId', state.viewerId);
      log(`Memulai mode penonton: ${state.viewerId}`);
    }

    bootPeer();
    ensureLocalStream().catch((e) => log('Media init error: ' + (e?.message || e)));
    syncSidebarHeight();
    setTimeout(syncSidebarHeight, 150);
    setTimeout(syncSidebarHeight, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
