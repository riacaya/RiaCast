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
  const videoSource = state.settings.videoSource || 'camera';
  const audioSource = state.settings.audioSource || 'mic';
  const wantVideo = videoSource !== 'off';
  const wantMic = audioSource === 'mic' || audioSource === 'both';
  const wantSystem = audioSource === 'system' || audioSource === 'both';

  if (!wantVideo && !wantMic && !wantSystem) {
    setInfo('media', 'Mati (pengaturan)');
    const fallback = createFallbackStream();
    state.localStream = fallback;
    els.localVideo.srcObject = fallback;
    els.localPip.classList.toggle('hidden', isAdmin());
    return fallback;
  }

  const out = new MediaStream();
  let screenStream = null;
  let camStream = null;
  let micStream = null;
  const labels = [];

  try {
    if (videoSource === 'screen') {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: wantSystem, systemAudio: wantSystem ? 'include' : 'exclude' });
        screenStream.getVideoTracks().forEach((t) => out.addTrack(t));
        labels.push('Layar');
        if (wantSystem) {
          const sysA = screenStream.getAudioTracks();
          if (sysA.length) { sysA.forEach((t) => out.addTrack(t)); labels.push('System'); }
        }
      } catch (err) {
        log('Gagal rekam layar: ' + (err?.name || err?.message || err));
      }
    } else if (videoSource === 'camera') {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        camStream.getVideoTracks().forEach((t) => out.addTrack(t));
        labels.push('Kamera');
      } catch (err) {
        log('Gagal kamera: ' + (err?.name || err?.message || err));
      }
    }

    if (wantMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        micStream.getAudioTracks().forEach((t) => out.addTrack(t));
        labels.push('Mic');
      } catch (err) {
        log('Gagal mic: ' + (err?.name || err?.message || err));
      }
    }

    if (wantSystem && !out.getAudioTracks().some((t) => t.label && !micStream?.getAudioTracks().includes(t))) {
      // Try to get system audio if not already captured from screen share
      const hasSystem = screenStream && screenStream.getAudioTracks().length > 0;
      if (!hasSystem) {
        try {
          const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' });
          sys.getAudioTracks().forEach((t) => out.addTrack(t));
          sys.getVideoTracks().forEach((t) => { if (out.getVideoTracks().length === 0) out.addTrack(t); else t.stop(); });
          if (sys.getAudioTracks().length) labels.push(out.getVideoTracks().length && videoSource === 'off' ? 'Layar+System' : 'System');
          else sys.getTracks().forEach((t) => { if (!out.getTracks().includes(t)) t.stop(); });
        } catch (err) {
          log('Gagal audio system: ' + (err?.name || err?.message || err));
        }
      }
    }
  } catch (err) {
    log('Gagal menyiapkan media: ' + (err?.name || err?.message || err));
  }

  // Mix multiple audio tracks into one
  const audioTracks = out.getAudioTracks();
  if (audioTracks.length > 1) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ac = new Ctx();
        if (ac.state === 'suspended') await ac.resume().catch(() => {});
        const dest = ac.createMediaStreamDestination();
        audioTracks.forEach((t) => {
          try { ac.createMediaStreamSource(new MediaStream([t])).connect(dest); } catch {}
        });
        const mixed = dest.stream.getAudioTracks()[0];
        if (mixed) {
          audioTracks.forEach((t) => { out.removeTrack(t); t.stop(); });
          out.addTrack(mixed);
          out.__riacastAudioCtx = ac;
        } else {
          ac.close().catch(() => {});
        }
      }
    } catch (err) {
      log('Gagal mix audio: ' + (err?.name || err?.message || err));
    }
  }

  // Stop unused helper streams' leftover tracks not in out
  [screenStream, camStream, micStream].forEach((s) => {
    if (!s) return;
    s.getTracks().forEach((t) => { if (!out.getTracks().includes(t)) t.stop(); });
  });

  const screenVideo = out.getVideoTracks().find((t) => t && screenStream?.getVideoTracks().includes(t));
  if (screenVideo) {
    screenVideo.addEventListener('ended', () => {
      log('Screen share dihentikan.');
      if (state.localStream === out) { stopLocalStream(); if (isAdmin()) ensureLocalStream().catch(() => {}); }
    });
  }

  if (out.getTracks().length === 0) {
    setInfo('media', 'Media fallback');
    log('Semua percobaan media gagal, pakai fallback.');
    const fallback = createFallbackStream();
    state.localStream = fallback;
    els.localVideo.srcObject = fallback;
    els.localPip.classList.toggle('hidden', isAdmin());
    if (isAdmin() && !state.spotlightId) setMainToSelf();
    if (isAdmin()) renderViewerPanel();
    setOverlay('Izin media terbatas', 'Kamera/mic/layar tidak dapat diakses. Periksa izin browser lalu refresh.', true);
    setTimeout(() => {
      if (isAdmin()) { setOverlay('', '', false); }
      else if (!state.adminCall) setOverlay('Mencari admin', 'Mendeteksi penyiar riacast-99...', true);
    }, 3000);
    return state.localStream;
  }

  state.localStream = out;
  els.localVideo.srcObject = out;
  els.localPip.classList.toggle('hidden', isAdmin());
  const label = labels.join(' + ') || 'Media';
  setInfo('media', label);
  log('Media lokal siap: ' + label);
  if (isAdmin() && !state.spotlightId) setMainToSelf();
  if (isAdmin()) renderViewerPanel();
  if (isAdmin() && state.viewers.size === 0) setOverlay('', '', false);
  return state.localStream;
}

function stopLocalStream() {
  if (!state.localStream) return;
  try { state.localStream.__riacastAudioCtx?.close?.(); } catch {}
  state.localStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
  state.localStream = null;
  if (els.localVideo) els.localVideo.srcObject = null;
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

var _syncSidebarH = 0;
function syncSidebarHeight() {
  const stageCard = document.querySelector('.stage-card');
  const side = document.querySelector('.side-card');
  if (!stageCard || !side) return;
  if (window.innerWidth <= 980) {
    if (side.style.height) side.style.height = '';
    if (side.style.marginTop) side.style.marginTop = '';
    return;
  }
  const cardH = Math.round(stageCard.getBoundingClientRect().height);
  if (!cardH) return;
  if (_syncSidebarH === cardH && side.style.height === cardH + 'px') return;
  _syncSidebarH = cardH;
  side.style.marginTop = '0px';
  if (side.style.height !== cardH + 'px') side.style.height = cardH + 'px';
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


