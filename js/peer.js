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
  if (state.localStreamPromise) {
    try { await state.localStreamPromise; } catch {}
  }
  if (state.localStreamPromise) return state.localStreamPromise;
  const p = _ensureLocalStreamImpl();
  state.localStreamPromise = p;
  try { return await p; }
  finally { if (state.localStreamPromise === p) state.localStreamPromise = null; }
}

async function _ensureLocalStreamImpl() {
  if (isAdmin()) {
    const wantCam = !!state.camEnabled;
    const wantMic = !!state.micEnabled;
    try { if (wantCam) await ensureCamDeviceStream(); } catch (e) { log('Kamera gagal: ' + (e?.name || e?.message || e)); }
    try { if (wantMic) await ensureMicDeviceStream(); } catch (e) { log('Mic gagal: ' + (e?.name || e?.message || e)); }

    const hasVisual = hasActiveMainSource();
    const hasAudio = (wantMic && state.micDeviceStream && state.micDeviceStream.getAudioTracks().some(t => t.readyState === 'live'))
      || (state.playlistPlaying && state.playlistStream && state.playlistStream.getAudioTracks().some(t => t.readyState === 'live'))
      || (state.mainSource === 'screen' && state.screenCaptureStream && state.screenCaptureStream.getAudioTracks().some(t => t.readyState === 'live'));

    if (hasVisual || hasAudio || state.mainSource === 'camera') {
      const mixed = await rebuildAdminMix().catch((e) => { log('Mix gagal: ' + (e?.message || e)); return false; });
      if (mixed) return state.localStream;
    }

    const fallback = createFallbackStream();
    state.localStream = fallback;
    els.localVideo.srcObject = fallback;
    els.localPip.classList.add('hidden');
    setInfo('media', 'Belum siap');
    if (!state.spotlightId) setMainToAdminDefault();
    renderViewerPanel();
    await replaceLocalTracks(state.localStream);
    return state.localStream;
  }

  // Viewer: kirim cam/mic sendiri
  const wantCam = !!state.camEnabled;
  const wantMic = !!state.micEnabled;
  let camStream = state.camDeviceStream;
  let micStream = state.micDeviceStream;

  if (wantCam) {
    try {
      if (!camStream || !camStream.getVideoTracks().some(t => t.readyState === 'live')) {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        state.camDeviceStream = camStream;
      }
    } catch (e) { log('Kamera gagal: ' + (e?.name || e?.message || e)); camStream = null; }
  }
  if (wantMic) {
    try {
      if (!micStream || !micStream.getAudioTracks().some(t => t.readyState === 'live')) {
        micStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        state.micDeviceStream = micStream;
      }
    } catch (e) { log('Mic gagal: ' + (e?.name || e?.message || e)); micStream = null; }
  }

  const out = new MediaStream();
  if (wantCam && camStream) camStream.getVideoTracks().forEach(t => out.addTrack(t));
  if (wantMic && micStream) micStream.getAudioTracks().forEach(t => out.addTrack(t));

  if (!out.getTracks().length) {
    const fallback = createFallbackStream();
    state.localStream = fallback;
    els.localVideo.srcObject = fallback;
    els.localPip.classList.remove('hidden');
    setInfo('media', 'Kamera mati');
    await replaceLocalTracks(state.localStream);
    return state.localStream;
  }

  state.localStream = out;
  els.localVideo.srcObject = out;
  els.localPip.classList.remove('hidden');
  setInfo('media', [wantCam ? 'Kamera' : null, wantMic ? 'Mic' : null].filter(Boolean).join(' + ') || 'Media');
  await replaceLocalTracks(state.localStream);
  return state.localStream;
}

function stopLocalStream() {
  if (state.playlistEl || state.playlistStream) stopPlaylistMedia();
  try { stopAdminMix(); } catch {}
  if (state.screenCaptureStream) { try { state.screenCaptureStream.getTracks().forEach(t => t.stop()); } catch {} state.screenCaptureStream = null; }
  if (state.camDeviceStream) { try { state.camDeviceStream.getTracks().forEach(t => t.stop()); } catch {} state.camDeviceStream = null; }
  if (state.micDeviceStream) { try { state.micDeviceStream.getTracks().forEach(t => t.stop()); } catch {} state.micDeviceStream = null; }
  if (state.localStream) {
    try { state.localStream.__riacastAudioCtx?.close?.(); } catch {}
    state.localStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
  }
  state.localStream = null;
  state.screenSharing = false;
  state.screenPaused = false;
  state.mainSource = 'camera';
  if (typeof syncShareUI === 'function') syncShareUI();
  if (els.localVideo) els.localVideo.srcObject = null;
}

async function replaceLocalTracks(newStream) {
  const stream = newStream || state.localStream;
  if (!stream) return;
  const vTrack = stream.getVideoTracks()[0] || null;
  const aTrack = stream.getAudioTracks()[0] || null;
  const calls = [];
  if (isAdmin()) {
    for (const v of state.viewers.values()) if (v.call) calls.push(v.call);
  } else if (state.adminCall) {
    calls.push(state.adminCall);
  }
  for (const call of calls) {
    const pc = call?.peerConnection;
    if (!pc) continue;
    const senders = pc.getSenders ? pc.getSenders() : [];
    for (const s of senders) {
      if (s.track?.kind === 'video') { try { await s.replaceTrack(vTrack); } catch {} }
      if (s.track?.kind === 'audio') { try { await s.replaceTrack(aTrack); } catch {} }
    }
  }
}

function destroyPeer() {
  state.destroyed = true;
  clearTimeout(state.detectTimer);
  clearTimeout(state.reconnectTimer);
  if (Array.isArray(state.intervals)) {
    state.intervals.forEach((id) => clearInterval(id));
    state.intervals = [];
  }
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

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];
const TURN_SERVERS = [
  { urls: 'turn:global.relay.metered.ca:80', username: '466494188ac3580fb1c6df34', credential: 'f8Qc+SUXdyhuVIgB' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '466494188ac3580fb1c6df34', credential: 'f8Qc+SUXdyhuVIgB' },
  { urls: 'turn:global.relay.metered.ca:443', username: '466494188ac3580fb1c6df34', credential: 'f8Qc+SUXdyhuVIgB' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '466494188ac3580fb1c6df34', credential: 'f8Qc+SUXdyhuVIgB' },
];
let turnEscalated = false;
let directFailCount = 0;
const DIRECT_FAIL_LIMIT = 3;

function peerConfig() {
  return {
    debug: 0,
    config: {
      iceServers: turnEscalated ? [...STUN_SERVERS, ...TURN_SERVERS] : [...STUN_SERVERS],
      iceTransportPolicy: 'all',
    },
  };
}

function escalateToTurn(reason) {
  if (turnEscalated || state.destroyed) return false;
  directFailCount++;
  log(`Koneksi direct gagal (${directFailCount}/${DIRECT_FAIL_LIMIT})${reason ? ': ' + reason : ''}`);
  if (directFailCount < DIRECT_FAIL_LIMIT) return false;
  turnEscalated = true;
  log('Eskalasi ke TURN/relay setelah beberapa kegagalan direct.');
  setStatus('Mencoba koneksi TURN...', '');
  try { state.peer?.destroy(); } catch {}
  state.peer = null;
  state.peerOpen = false;
  bootPeer();
  return true;
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
      if (escalateToTurn(type)) return;
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
    viewer.disconnectedAt = null;
    viewer.lastSeenAt = Date.now();
    bindViewerConn(conn);
    // Auto greet; viewer will request call or we can initiate
    send(conn, { type: 'admin-welcome', adminId: ADMIN_PEER_ID });
  });
  bindViewerConn(conn);
}

function getOrCreateViewer(peerId) {
  let v = state.viewers.get(peerId);
  if (!v) {
    v = { peerId, conn: null, call: null, tile: null, thumb: null, video: null, listItem: null, listVideo: null, name: peerId, lastCallAt: 0, callConnected: false, connectedAt: Date.now(), disconnectedAt: null, lastSeenAt: Date.now() };
    state.viewers.set(peerId, v);
  }
  return v;
}

function markViewerDisconnected(peerId, reason) {
  const v = state.viewers.get(peerId);
  if (!v) return;
  try { v.call?.close(); } catch {}
  try { v.conn?.close(); } catch {}
  removeViewerThumb(peerId);
  state.viewers.delete(peerId);
  log(`Penonton terputus: ${peerId} (${reason || 'unknown'})`);
  updateCounts();
  broadcastPresence();
  renderViewerPanel();
  if (isAdmin() && state.viewers.size === 0) {
    setStatus('Siaran aktif, menunggu penonton', 'ok');
    if (typeof setMainToAdminDefault === 'function') setMainToAdminDefault();
  }
}

function bindViewerConn(conn) {
  if (conn.__riacastBound) return;
  conn.__riacastBound = true;
  conn.on('data', (data) => handleAdminData(conn.peer, data));
  conn.on('close', () => markViewerDisconnected(conn.peer, 'data-close'));
  conn.on('error', (err) => { console.warn('viewer conn error', err); markViewerDisconnected(conn.peer, 'data-error'); });
}

async function handleAdminData(peerId, data) {
  if (!data || typeof data !== 'object') return;
  let viewer = state.viewers.get(peerId);
  if (!viewer && data.type === 'viewer-hello') viewer = getOrCreateViewer(peerId);
  if (!viewer) return;
  viewer.lastSeenAt = Date.now();
  if (data.type === 'pong') return;
  if (data.type === 'viewer-hello') {
    viewer.disconnectedAt = null;
    viewer.name = String(data.name || peerId).slice(0, 32);
    log(`Penonton hadir: ${viewer.name} (${peerId})`);
    send(viewer.conn, { type: 'admin-ready', adminId: ADMIN_PEER_ID });
    await autoApproveViewer(peerId);
    broadcastPresence();
  }
  if (data.type === 'request-call') {
    viewer.name = String(data.name || viewer.name || peerId).slice(0, 32);
    log(`Permintaan sambungan dari ${viewer.name} (${peerId}) - auto approve`);
    await autoApproveViewer(peerId);
    broadcastPresence();
  }
  if (data.type === 'chat') {
    const text = String(data.text || '').trim().slice(0, 500);
    if (!text) return;
    const msg = {
      id: String(data.id || makeChatId()),
      name: String(data.name || viewer.name || peerId).slice(0, 32),
      text,
      ts: Number(data.ts) || Date.now(),
      peerId,
    };
    addChatMessage({ ...msg, self: false });
    broadcastChat(msg, peerId);
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
  if (!state.localStream || !state.localStream.getTracks().length) {
    send(viewer.conn, { type: 'admin-error', message: 'Media lokal belum siap.' });
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
    if (!call) { log(`Gagal memanggil ${peerId}`); escalateToTurn('admin-call-null'); return; }
    viewer.lastCallAt = now;
    viewer.callConnected = false;
    bindAdminCall(peerId, call);
    log(`Memanggil penonton: ${viewer.name}`);
  } catch (e) {
    log(`Gagal call ke ${peerId}: ${e?.message || e}`);
    escalateToTurn('admin-call-ex');
  }
}

function bindAdminCall(peerId, call) {
  const viewer = state.viewers.get(peerId);
  if (!viewer) { try { call.close(); } catch {} return; }
  if (viewer.call && viewer.call !== call) {
    try { viewer.call.close(); } catch {}
  }
  viewer.call = call;
  viewer.callConnected = false;
  tuneMediaSenders(call);

  call.on('stream', (remoteStream) => {
    if (state.viewers.get(peerId) !== viewer || viewer.call !== call) return;
    directFailCount = 0;
    viewer.callConnected = true;
    viewer.lastSeenAt = Date.now();
    viewer.stream = remoteStream;
    upsertViewerThumb(peerId);
    if (state.spotlightId === peerId) setMainToStream(remoteStream, false);
    setStatus(`Terhubung ke ${state.viewers.size} penonton`, 'ok');
    setOverlay('', '', false);
    updateCounts();
    renderViewerPanel();
    if (typeof detectConnType === 'function') {
      const logRoute = async (n = 0) => { if (state.viewers.get(peerId) !== viewer) return; const type = await detectConnType(viewer).catch(() => null); if (type) { viewer.connType = type; log(`Koneksi ${peerId} tersambung via ${type}`); renderViewerPanel(); } else if (n < 3) setTimeout(() => logRoute(n + 1), 1500); };
      logRoute();
    }
  });

  call.on('close', () => {
    log(`Call tertutup: ${peerId}`);
    const wasConnected = viewer.callConnected;
    if (viewer.call === call) {
      viewer.call = null;
      viewer.callConnected = false;
      viewer.stream = null;
    }
    if (state.viewers.get(peerId) !== viewer) return;
    removeViewerThumb(peerId);
    updateCounts();
    if (isAdmin() && state.viewers.size === 0) {
      if (typeof setMainToAdminDefault === 'function') setMainToAdminDefault();
    }
    if (!wasConnected) escalateToTurn('admin-call-close');
    if (viewer.conn && viewer.conn.open && !state.destroyed) {
      setTimeout(() => { if (state.viewers.has(peerId)) autoApproveViewer(peerId); }, 1500);
    }
  });

  call.on('error', (err) => {
    console.warn('admin call error', peerId, err);
    log(`Call error ${peerId}: ${err?.type || err?.message || err}`);
    if (viewer.call === call) viewer.callConnected = false;
    if (state.viewers.get(peerId) !== viewer) return;
    if (!viewer.callConnected) escalateToTurn('admin-call-error');
  });
}

async function handleAdminIncomingCall(call) {
  const peerId = call.peer;
  log(`Panggilan masuk dari ${peerId} - auto answer`);
  let viewer = state.viewers.get(peerId);
  if (!viewer) {
    log(`Call dari ${peerId} diabaikan: viewer tidak aktif.`);
    try { call.close(); } catch {}
    return;
  }
  try { await ensureLocalStream(); } catch { return; }
  if (!state.localStream || !state.localStream.getTracks().length) { log(`Media lokal belum siap, abaikan call ${peerId}`); return; }
  if (state.viewers.get(peerId) !== viewer) { try { call.close(); } catch {} return; }
  try {
    call.answer(state.localStream);
    bindAdminCall(peerId, call);
    const v = state.viewers.get(peerId);
    if (v?.conn) send(v.conn, { type: 'call-approved' });
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
  broadcastPresence();
  renderViewerPanel();
  if (isAdmin() && state.viewers.size === 0) {
    setStatus('Siaran aktif, menunggu penonton', 'ok');
    if (typeof setMainToAdminDefault === 'function') setMainToAdminDefault();
  }
}

function cleanupStaleViewers() {
  if (!isAdmin()) return;
  const now = Date.now();
  for (const [peerId, v] of state.viewers) {
    const connOpen = !!(v.conn && v.conn.open);
    const callOpen = !!(v.call && v.call.open);
    const pcState = v.conn && v.conn.peerConnection ? v.conn.peerConnection.iceConnectionState : '';
    const badPc = pcState === 'failed' || pcState === 'closed' || pcState === 'disconnected';
    if (!connOpen && !callOpen) {
      removeViewer(peerId, 'connection-closed');
      continue;
    }
    if (badPc && !v.callConnected) {
      removeViewer(peerId, 'ice-' + pcState);
      continue;
    }
    const lastSeen = Number(v.lastSeenAt || v.connectedAt || 0);
    if (lastSeen && (now - lastSeen) > 25000) {
      removeViewer(peerId, 'heartbeat-timeout');
      continue;
    }
    if (connOpen) send(v.conn, { type: 'ping', ts: now });
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
  if (data.type === 'ping') {
    send(state.adminConn, { type: 'pong', ts: Date.now() });
    return;
  }
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
  if (data.type === 'chat') {
    const id = String(data.id || '');
    if (id && state.chatMessages.some((m) => m.id === id)) return;
    const text = String(data.text || '').trim().slice(0, 500);
    if (!text) return;
    addChatMessage({
      id: id || makeChatId(),
      name: String(data.name || data.peerId || 'User').slice(0, 32),
      text,
      ts: Number(data.ts) || Date.now(),
      peerId: String(data.peerId || ''),
      self: false,
    });
  }
  if (data.type === 'presence') {
    const list = Array.isArray(data.viewers) ? data.viewers : [];
    state.viewerPresence = list.map((v) => ({ id: String(v.id || ''), name: String(v.name || v.id || 'User').slice(0, 32) }));
    if (typeof renderViewerPresence === 'function') renderViewerPresence();
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
  if (!state.localStream || !state.localStream.getTracks().length) { log('Media lokal belum siap untuk menjawab call admin.'); return; }
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
  tuneMediaSenders(call);
  call.on('stream', (remoteStream) => {
    if (state.adminCall !== call) return;
    directFailCount = 0;
    state.adminCallConnected = true;
    setMainToStream(remoteStream, false);
    setOverlay('', '', false);
    setStatus('Terhubung ke siaran', 'ok');
    if (els.stageTitle) els.stageTitle.textContent = 'Siaran langsung';
    log('Stream admin diterima.');
    if (typeof detectConnType === 'function') {
      const logRoute = async (n = 0) => { const type = await detectConnType({ call }).catch(() => null); if (type) log(`Koneksi admin tersambung via ${type}`); else if (n < 3) setTimeout(() => logRoute(n + 1), 1500); };
      logRoute();
    }
    updateCounts();
  });
  call.on('close', () => {
    if (state.adminCall !== call) return;
    const wasConnected = state.adminCallConnected;
    state.adminCall = null;
    state.adminCallConnected = false;
    if (els.mainVideo) els.mainVideo.srcObject = null;
    setStatus('Siaran terputus', '');
    if (els.stageTitle) els.stageTitle.textContent = 'Menunggu siaran';
    setOverlay('Siaran terputus', 'Menunggu admin kembali online...', true);
    log('Call admin tertutup.');
    updateCounts();
    if (!wasConnected && escalateToTurn('viewer-call-close')) return;
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
    if (!state.adminCallConnected) escalateToTurn('viewer-call-error');
  });
}

function getDisplayName() {
  return (state.settings.displayName || '').trim() || (isAdmin() ? 'Admin' : state.viewerId);
}

// ---------------- CHAT ----------------
function makeChatId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

async function tuneMediaSenders(call) {
  try {
    const pc = call?.peerConnection;
    if (!pc) return;
    const senders = pc.getSenders ? pc.getSenders() : [];
    for (const s of senders) {
      if (!s.track) continue;
      const params = s.getParameters ? s.getParameters() : null;
      if (!params) continue;
      params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
      if (s.track.kind === 'audio') {
        params.encodings.forEach((e) => { e.maxBitrate = 128000; e.priority = 'high'; e.networkPriority = 'high'; });
      } else if (s.track.kind === 'video') {
        params.encodings.forEach((e) => { e.maxBitrate = 450000; e.maxFramerate = 24; e.scaleResolutionDownBy = 1; e.priority = 'high'; e.networkPriority = 'high'; });
      }
      await s.setParameters(params).catch(() => {});
    }
  } catch {}
}

function sendChatFromUI() {
  const text = (els.chatInput?.value || '').trim();
  if (!text) return;
  const msg = {
    id: makeChatId(),
    name: getDisplayName(),
    text: text.slice(0, 500),
    ts: Date.now(),
    peerId: isAdmin() ? ADMIN_PEER_ID : (state.viewerId || state.peer?.id || ''),
  };
  if (els.chatInput) els.chatInput.value = '';
  addChatMessage({ ...msg, self: true });
  if (isAdmin()) {
    broadcastChat(msg);
  } else {
    if (!state.adminConn || !state.adminConn.open) {
      log('Chat gagal dikirim: belum terhubung ke admin.');
      return;
    }
    send(state.adminConn, { type: 'chat', ...msg });
  }
}

function broadcastChat(msg, excludePeerId) {
  for (const [peerId, viewer] of state.viewers) {
    if (excludePeerId && peerId === excludePeerId) continue;
    if (viewer.conn) send(viewer.conn, { type: 'chat', ...msg });
  }
}

function broadcastPresence() {
  if (!isAdmin()) return;
  const viewers = [...state.viewers.values()]
    .filter((v) => !v.disconnectedAt)
    .map((v) => ({ id: v.peerId, name: (v.name || v.peerId).slice(0, 32) }));
  const payload = { type: 'presence', viewers, count: viewers.length };
  for (const v of state.viewers.values()) {
    if (!v.disconnectedAt && v.conn) send(v.conn, payload);
  }
  state.viewerPresence = viewers;
}

// ---------------- UI ----------------
function openOverlay(id) { $(id)?.classList.remove('hidden'); }
function closeOverlay(id) { $(id)?.classList.add('hidden'); }


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

// ---------------- ADMIN MIX ----------------
function ensureMixCanvas() {
  if (state.mixCanvas) return state.mixCanvas;
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  state.mixCanvas = c;
  return c;
}

async function ensureCamDeviceStream() {
  if (state.camDeviceStream && state.camDeviceStream.getVideoTracks().some(t => t.readyState === 'live')) return state.camDeviceStream;
  try { state.camDeviceStream?.getTracks().forEach(t => t.stop()); } catch {}
  state.camDeviceStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  return state.camDeviceStream;
}

async function ensureMicDeviceStream() {
  if (state.micDeviceStream && state.micDeviceStream.getAudioTracks().some(t => t.readyState === 'live')) return state.micDeviceStream;
  try { state.micDeviceStream?.getTracks().forEach(t => t.stop()); } catch {}
  state.micDeviceStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return state.micDeviceStream;
}

function getMainVideoSource() {
  if (state.mainSource === 'camera' && state.camDeviceStream) {
    if (!state._mixCamMainEl) { state._mixCamMainEl = document.createElement('video'); state._mixCamMainEl.muted = true; state._mixCamMainEl.playsInline = true; }
    if (state._mixCamMainEl.srcObject !== state.camDeviceStream) state._mixCamMainEl.srcObject = state.camDeviceStream;
    state._mixCamMainEl.play().catch(() => {});
    return state._mixCamMainEl;
  }
  if (state.mainSource === 'playlist' && state.playlistEl) return state.playlistEl;
  if (state.mainSource === 'screen' && state.screenCaptureStream) {
    if (!state._mixScreenEl) { state._mixScreenEl = document.createElement('video'); state._mixScreenEl.muted = true; state._mixScreenEl.playsInline = true; }
    if (state._mixScreenEl.srcObject !== state.screenCaptureStream) state._mixScreenEl.srcObject = state.screenCaptureStream;
    state._mixScreenEl.play().catch(() => {});
    return state._mixScreenEl;
  }
  return null;
}

function stopAdminMixLoop() {
  if (state.mixLoop) { cancelAnimationFrame(state.mixLoop); state.mixLoop = null; }
}

function stopAdminMix() {
  stopAdminMixLoop();
  if (state.mixOutputStream) {
    try { state.mixOutputStream.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}
  }
  state.mixOutputStream = null;
  state.mixVideoTrack = null;
  try { state.mixAudioCtx?.close?.(); } catch {}
  state.mixAudioCtx = null; state.mixAudioDest = null; state.mixMicSource = null; state.mixMainAudioSource = null;
}

function hasActiveMainSource() {
  if (state.mainSource === 'camera') return !!(state.camDeviceStream && state.camDeviceStream.getVideoTracks().some(t => t.readyState === 'live'));
  if (state.mainSource === 'playlist') return !!state.playlistEl;
  if (state.mainSource === 'screen') return !!state.screenCaptureStream;
  return false;
}

function shouldUseComposedStream() {
  if (!isAdmin()) return false;
  if (hasActiveMainSource()) return true;
  if (state.mainSource === 'camera' && state.micEnabled && state.micDeviceStream) return true;
  if (state.playlistPlaying && state.playlistStream) return true;
  return false;
}

async function rebuildAdminMix() {
  if (!isAdmin()) return false;

  const wantMic = !!state.micEnabled;
  const wantCam = !!state.camEnabled;
  try { if (wantCam) await ensureCamDeviceStream(); } catch (e) { log('Kamera gagal: ' + (e?.message || e)); }
  try { if (wantMic) await ensureMicDeviceStream(); } catch (e) { log('Mic gagal: ' + (e?.message || e)); }

  const canvas = ensureMixCanvas();
  const ctx = canvas.getContext('2d');
  stopAdminMixLoop();
  const mixLogo = new Image();
  mixLogo.src = 'assets/logo.svg';

  const drawAudioPlaceholder = (title) => {
    const w = canvas.width, h = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#121826');
    g.addColorStop(1, '#090b10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,106,61,0.08)';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, 220, 0, Math.PI * 2); ctx.fill();
    if (mixLogo.complete && mixLogo.naturalWidth) {
      const size = 240;
      ctx.drawImage(mixLogo, (w - size) / 2, h * 0.45 - size / 2, size, size);
    } else {
      ctx.fillStyle = '#ff6a3d'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('RiaCast', w / 2, h * 0.45);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.fillStyle = '#dce3ec'; ctx.font = '600 34px sans-serif'; ctx.textAlign = 'center';
    const t0 = String(title || 'Audio Playlist');
    let t = t0;
    const maxW = w - 160;
    while (ctx.measureText(t).width > maxW && t.length > 10) t = t.slice(0, -4) + '...';
    ctx.fillText(t, w / 2, h * 0.62);
    ctx.fillStyle = 'rgba(220,227,236,0.65)'; ctx.font = '24px sans-serif';
    ctx.fillText('MP3 / Audio', w / 2, h * 0.69);
  };

  const draw = () => {
    ctx.fillStyle = '#090b10'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const src = getMainVideoSource();
    const hasVideo = src && src.readyState >= 2 && (src.videoWidth || 0) > 0;
    if (hasVideo) {
      try {
        const vw = src.videoWidth || canvas.width;
        const vh = src.videoHeight || canvas.height;
        const scale = Math.min(canvas.width / vw, canvas.height / vh);
        const dw = vw * scale, dh = vh * scale;
        ctx.drawImage(src, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } catch {}
    } else if (state.mainSource === 'playlist') {
      const item = state.playlist[state.playlistIndex];
      drawAudioPlaceholder(item?.name || 'Audio Playlist');
    } else if (state.mainSource === 'screen') {
      ctx.fillStyle = '#dce3ec'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Rekam Layar', canvas.width / 2, canvas.height / 2);
    } else if (state.mainSource === 'camera') {
      ctx.fillStyle = '#dce3ec'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Kamera Mati', canvas.width / 2, canvas.height / 2);
    } else {
      ctx.fillStyle = '#dce3ec'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Siaran', canvas.width / 2, canvas.height / 2);
    }
    state.mixLoop = requestAnimationFrame(draw);
  };
  draw();

  if (!state.mixVideoTrack) state.mixVideoTrack = canvas.captureStream(30).getVideoTracks()[0];
  const out = new MediaStream();
  if (state.mixVideoTrack) out.addTrack(state.mixVideoTrack);

  // Audio mix: mic + playlist audio (if playing) + screen audio (if screen is main source)
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      try { state.mixAudioCtx?.close?.(); } catch {}
      state.mixAudioCtx = new AC();
      state.mixAudioDest = state.mixAudioCtx.createMediaStreamDestination();

      if (wantMic && state.micDeviceStream) {
        const ats = state.micDeviceStream.getAudioTracks().filter(t => t.readyState === 'live');
        if (ats.length) {
          const ms = state.mixAudioCtx.createMediaStreamSource(new MediaStream([ats[0]]));
          ms.connect(state.mixAudioDest);
        }
      }

      if (state.playlistPlaying && state.playlistStream) {
        const ats = state.playlistStream.getAudioTracks().filter(t => t.readyState === 'live');
        if (ats.length) {
          const src = state.mixAudioCtx.createMediaStreamSource(new MediaStream([ats[0]]));
          src.connect(state.mixAudioDest);
        }
      }

      if (state.mainSource === 'screen' && state.screenCaptureStream) {
        const ats = state.screenCaptureStream.getAudioTracks().filter(t => t.readyState === 'live');
        if (ats.length) {
          const src = state.mixAudioCtx.createMediaStreamSource(new MediaStream([ats[0]]));
          src.connect(state.mixAudioDest);
        }
      }

      const at = state.mixAudioDest.stream.getAudioTracks()[0];
      if (at) out.addTrack(at);
    }
  } catch (e) { log('Audio mix gagal: ' + (e?.message || e)); }

  state.mixOutputStream = out;
  state.localStream = out;
  els.localVideo.srcObject = out;
  els.localPip.classList.toggle('hidden', true);

  const parts = [];
  parts.push(state.mainSource === 'camera' ? 'Kamera' : (state.mainSource === 'screen' ? 'Screen' : 'Playlist'));
  if (wantMic) parts.push('Mic');
  if (state.playlistPlaying && state.mainSource !== 'playlist') parts.push('Audio Playlist');
  setInfo('media', parts.join(' + '));

  if (!state.spotlightId) {
    els.mainVideo.muted = true;
    if (els.mainVideo.srcObject !== out) els.mainVideo.srcObject = out;
    els.mainVideo.play().catch(() => {});
    const hasVisibleVideo = state.mainSource !== 'camera' || !!(state.camDeviceStream && state.camDeviceStream.getVideoTracks().some(t => t.enabled));
    if (hasVisibleVideo) setOverlay('', '', false);
    else setOverlay('Kamera Mati', 'Audio tetap aktif. Nyalakan kamera untuk menampilkan video.', true);
  }
  renderViewerPanel();
  await replaceLocalTracks(out);
  return true;
}

// ---------------- SCREEN CAPTURE ----------------
async function toggleScreenCapture() {
  if (!isAdmin()) return;
  if (state.screenCaptureStream) { await stopScreenCapture(); return; }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
    state.screenCaptureStream = stream;
    state.screenSharing = true;
    state.mainSource = 'screen';
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) vTrack.addEventListener('ended', () => { stopScreenCapture().catch(() => {}); });
    if (els.btnScreenShare) els.btnScreenShare.textContent = 'Hentikan Rekam Layar';
    syncShareUI();
    await ensureLocalStream();
    log('Rekam layar dimulai.');
  } catch (e) {
    log('Gagal rekam layar: ' + (e?.name || e?.message || e));
  }
}

async function stopScreenCapture() {
  if (state.screenCaptureStream) {
    try { state.screenCaptureStream.getTracks().forEach(t => t.stop()); } catch {}
  }
  state.screenCaptureStream = null;
  state.screenSharing = false;
  state.screenPaused = false;
  if (state.mainSource === 'screen') state.mainSource = 'camera';
  if (els.btnScreenShare) els.btnScreenShare.textContent = 'Mulai Rekam Layar';
  syncShareUI();
  stopAdminMix();
  await ensureLocalStream();
  log('Rekam layar dihentikan.');
}

// ---------------- PLAYLIST ----------------
function makePlaylistDummyVideoTrack(labelText) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  let running = true;
  const logo = new Image();
  logo.src = 'assets/logo.svg';
  const draw = () => {
    if (!running) return;
    const w = canvas.width, h = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#121826');
    g.addColorStop(1, '#090b10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,106,61,0.08)';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, 220, 0, Math.PI * 2); ctx.fill();
    if (logo.complete && logo.naturalWidth) {
      const size = 240;
      ctx.drawImage(logo, (w - size) / 2, h * 0.45 - size / 2, size, size);
    } else {
      ctx.fillStyle = '#ff6a3d'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('RiaCast', w / 2, h * 0.45);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.fillStyle = '#dce3ec'; ctx.font = '600 34px sans-serif'; ctx.textAlign = 'center';
    const title = String(labelText || 'Audio Playlist');
    const maxW = w - 160;
    let t = title;
    while (ctx.measureText(t).width > maxW && t.length > 10) t = t.slice(0, -4) + '...';
    ctx.fillText(t, w / 2, h * 0.62);
    ctx.fillStyle = 'rgba(220,227,236,0.65)'; ctx.font = '24px sans-serif';
    ctx.fillText('MP3 / Audio', w / 2, h * 0.69);
    requestAnimationFrame(draw);
  };
  draw();
  const track = canvas.captureStream(10).getVideoTracks()[0];
  if (track) track.__riacastStopDraw = () => { running = false; };
  return track;
}

function stopPlaylistMedia() {
  if (state.playlistEl) {
    try { state.playlistEl.pause(); } catch {}
    try { state.playlistEl.removeAttribute('src'); state.playlistEl.load(); } catch {}
    state.playlistEl = null;
  }
  if (state.playlistStream) {
    const s = state.playlistStream;
    if (state.localStream === s) state.localStream = null;
    try { s.getTracks().forEach((t) => { try { t.__riacastStopDraw?.(); } catch {} try { t.stop(); } catch {} }); } catch {}
    state.playlistStream = null;
  }
  state.playlistPlaying = false;
  if (state.mainSource === 'playlist') state.mainSource = state.screenCaptureStream ? 'screen' : 'camera';
  if (typeof syncStudioUI === 'function') syncStudioUI();
}


function handlePlaylistFiles(e) {
  if (!isAdmin()) return;
  const files = Array.from(e?.target?.files || []);
  for (const f of files) {
    const url = URL.createObjectURL(f);
    state.playlist.push({ id: makeChatId(), name: f.name, type: f.type || '', url, file: f });
  }
  if (e?.target) e.target.value = '';
  if (state.playlistIndex < 0 && state.playlist.length) state.playlistIndex = 0;
  renderPlaylist();
  log(`${files.length} file ditambahkan ke playlist.`);
}

function removePlaylistItem(idx) {
  if (idx < 0 || idx >= state.playlist.length) return;
  const [item] = state.playlist.splice(idx, 1);
  try { if (item?.url) URL.revokeObjectURL(item.url); } catch {}
  if (state.playlistIndex === idx) {
    stopPlaylistMedia();
    state.playlistIndex = -1;
    if (state.playlist.length) playPlaylistIndex(Math.min(idx, state.playlist.length - 1));
  } else if (state.playlistIndex > idx) {
    state.playlistIndex -= 1;
  }
  if (!state.playlist.length) {
    stopPlaylistMedia();
    state.playlistIndex = -1;
    if (isAdmin()) ensureLocalStream().catch(() => {});
  }
  renderPlaylist();
}

function clearPlaylist() {
  stopPlaylistMedia();
  state.playlist.forEach((it) => { try { URL.revokeObjectURL(it.url); } catch {} });
  state.playlist = [];
  state.playlistIndex = -1;
  renderPlaylist();
  if (isAdmin()) ensureLocalStream().catch(() => {});
  log('Playlist dibersihkan.');
}

function togglePlaylistLoop() {
  state.playlistLoop = !state.playlistLoop;
  if (state.playlistEl) state.playlistEl.loop = !!state.playlistLoop && state.playlist.length === 1;
  renderPlaylist();
}

async function playPlaylistIndex(idx) {
  if (!isAdmin()) return;
  if (idx < 0 || idx >= state.playlist.length) return;
  const item = state.playlist[idx];
  stopPlaylistMedia();
  state.playlistIndex = idx;
  const isAudio = (item.type || '').startsWith('audio');
  const el = document.createElement(isAudio ? 'audio' : 'video');
  el.src = item.url;
  el.preload = 'auto';
  el.playsInline = true;
  el.crossOrigin = 'anonymous';
  el.controls = false;
  state.playlistEl = el;
  el.onended = () => {
    if (state.playlistLoop) { playPlaylistIndex((idx + 1) % state.playlist.length); return; }
    if (idx + 1 < state.playlist.length) playPlaylistIndex(idx + 1);
    else {
      state.playlistPlaying = false;
      stopPlaylistMedia();
      renderPlaylist();
      log('Playlist selesai.');
      if (isAdmin()) ensureLocalStream().catch(() => {});
    }
  };
  el.onerror = () => { log('Gagal memutar: ' + (item.name || 'file')); state.playlistPlaying = false; renderPlaylist(); };
  try {
    await el.play();
  } catch (e) {
    log('Autoplay diblokir, klik Putar lagi: ' + (e?.message || e));
    state.playlistPlaying = false;
    renderPlaylist();
    return;
  }
  let stream = null;
  try { stream = el.captureStream ? el.captureStream() : (el.mozCaptureStream ? el.mozCaptureStream() : null); } catch {}
  if (!stream) { log('Browser tidak mendukung captureStream untuk file ini.'); state.playlistPlaying = false; renderPlaylist(); return; }
  if (!stream.getVideoTracks().length) {
    const vt = makePlaylistDummyVideoTrack(item.name);
    if (vt) stream.addTrack(vt);
  }
  if (!stream.getAudioTracks().length) {
    log('File tidak memiliki track audio yang bisa disiarkan: ' + item.name);
  }
  state.playlistStream = stream;
  state.playlistPlaying = true;
  state.mainSource = 'playlist';
  await ensureLocalStream().catch(() => {});
  renderPlaylist();
  if (typeof syncStudioUI === 'function') syncStudioUI();
  log('Memutar playlist: ' + item.name);
}

function togglePlaylistPlayback() {
  if (!isAdmin()) return;
  const el = state.playlistEl;
  if (!el) { if (state.playlist.length) playPlaylistIndex(state.playlistIndex >= 0 ? state.playlistIndex : 0); return; }
  if (el.paused) {
    el.play().then(() => { state.playlistPlaying = true; renderPlaylist(); }).catch((e) => log('Gagal putar: ' + (e?.message || e)));
  } else {
    el.pause();
    state.playlistPlaying = false;
    renderPlaylist();
  }
}

function playNextPlaylist() {
  if (!state.playlist.length) return;
  const next = state.playlistIndex + 1;
  if (next < state.playlist.length) playPlaylistIndex(next);
  else if (state.playlistLoop) playPlaylistIndex(0);
}

function playPrevPlaylist() {
  if (!state.playlist.length) return;
  const prev = state.playlistIndex - 1;
  if (prev >= 0) playPlaylistIndex(prev);
  else if (state.playlistLoop) playPlaylistIndex(state.playlist.length - 1);
}


