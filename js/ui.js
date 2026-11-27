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
  if (els.overlayTitle) els.overlayTitle.textContent = title;
  if (els.overlaySub) els.overlaySub.textContent = sub;
  if (els.videoOverlay) els.videoOverlay.classList.toggle('hidden', !show);
  els.videoStage?.classList.toggle('no-video', !!show);
}

function setInfo(key, value) {
  qsa(`[data-info="${key}"]`).forEach((el) => { el.textContent = value; });
}

function updateCounts() {
  const count = isAdmin() ? [...state.viewers.values()].filter((v) => !v.disconnectedAt).length : (state.adminCall ? 1 : 0);
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
  if (els.stageTitle) els.stageTitle.textContent = admin ? 'Mode penyiar' : 'Menunggu siaran';
  if (admin) {
    state.spotlightId = null;
    if (els.mainVideo) { els.mainVideo.srcObject = null; els.mainVideo.muted = true; }
    setOverlay('RiaCast', 'Pilih penonton atau mulai rekam layar untuk menampilkan di panggung.', true);
    renderViewerPanel();
  } else {
    state.spotlightId = null;
    if (els.mainVideo) { els.mainVideo.srcObject = null; els.mainVideo.muted = false; }
    state.settings.videoSource = 'camera';
    state.settings.audioSource = 'mic';
  }
  // Device menu only for admin
  qsa('.settings-shortcuts .admin-only').forEach((el) => { el.style.display = admin ? '' : 'none'; });
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

function setMainToAdminDefault() {
  if (!els.mainVideo) { setOverlay('RiaCast', 'Pilih penonton atau mulai rekam layar untuk menampilkan di panggung.', true); return; }
  if (state.playlistStream && state.playlistEl) {
    els.mainVideo.muted = true;
    if (els.mainVideo.srcObject !== state.playlistStream) els.mainVideo.srcObject = state.playlistStream;
    els.mainVideo.play().catch(() => {});
    setOverlay('', '', false);
    return;
  }
  if (state.screenSharing && state.localStream) {
    els.mainVideo.muted = true;
    if (els.mainVideo.srcObject !== state.localStream) els.mainVideo.srcObject = state.localStream;
    els.mainVideo.play().catch(() => {});
    setOverlay('', '', false);
    return;
  }
  els.mainVideo.muted = true;
  els.mainVideo.srcObject = null;
  setOverlay('RiaCast', 'Pilih penonton atau mulai rekam layar untuk menampilkan di panggung.', true);
}

function setSpotlight(peerId) {
  if (!isAdmin()) return;
  state.spotlightId = peerId || null;
  if (!state.spotlightId) {
    setMainToAdminDefault();
  } else {
    const v = state.viewers.get(state.spotlightId);
    if (v?.stream) { setMainToStream(v.stream, false); setOverlay('', '', false); }
    else setMainToAdminDefault();
  }
  renderViewerPanel();
}

async function detectConnType(viewer) {
  try {
    const pc = viewer?.call?.peerConnection;
    if (!pc) return null;
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') pair = r; });
    if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded') pair = r; });
    if (!pair) return null;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    return relay ? 'TURN' : 'WebRTC';
  } catch { return null; }
}

function refreshViewerConnTypes() {
  if (!isAdmin()) return;
  for (const [peerId, v] of state.viewers) {
    detectConnType(v).then((type) => {
      if (type) v.connType = type;
      const timeEl = els.viewerList?.querySelector(`[data-peer="${cssEsc(peerId)}"] .viewer-item-time`);
      if (timeEl) timeEl.textContent = `terhubung via ${v.connType || '...'}`;
    }).catch(() => {});
  }
}

function updateViewerStatusUI() {
  if (!isAdmin()) return;
  for (const [peerId, v] of state.viewers) {
    const timeEl = els.viewerList?.querySelector(`[data-peer="${cssEsc(peerId)}"] .viewer-item-time`);
    if (timeEl) timeEl.textContent = `terhubung via ${v.connType || '...'}`;
  }
  const selfTime = els.viewerList?.querySelector('[data-peer="__self__"] .viewer-item-time');
  if (selfTime) selfTime.textContent = 'Penyiar';
}

function ensureViewerListItem(peerId, viewer) {
  if (!els.viewerList) return null;
  let item = els.viewerList.querySelector(`[data-peer="${cssEsc(peerId)}"]`);
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
  const name = isSelf ? ((state.settings.displayName || 'Kamu') + ' (Penyiar)') : (viewer?.name || peerId);
  if (nameEl) nameEl.textContent = name;
  if (timeEl) timeEl.textContent = isSelf ? 'Penyiar' : `terhubung via ${viewer?.connType || '...'}`;
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

function renderViewerPresence() {
  if (!els.viewerList) return;
  if (isAdmin()) { syncViewerSidebar(); return; }
  const list = Array.isArray(state.viewerPresence) ? state.viewerPresence : [];
  els.viewerList.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'viewer-empty';
  head.textContent = list.length ? `${list.length} penonton online` : 'Belum ada penonton.';
  els.viewerList.appendChild(head);
  for (const v of list) {
    const item = document.createElement('div');
    item.className = 'viewer-item viewer-item-compact';
    const dot = document.createElement('span');
    dot.className = 'viewer-dot';
    const name = document.createElement('div');
    name.className = 'viewer-item-name';
    name.textContent = v.name || v.id || 'User';
    item.appendChild(dot);
    item.appendChild(name);
    els.viewerList.appendChild(item);
  }
}

function syncViewerSidebar() {
  if (!els.viewerList) return;
  if (!isAdmin()) { renderViewerPresence(); return; }
  ensureViewerListItem('__self__', null);
  [...els.viewerList.querySelectorAll('.viewer-item[data-peer]')].forEach((el) => {
    const id = el.dataset.peer;
    if (id !== '__self__' && !state.viewers.has(id)) el.remove();
  });
  for (const [peerId, viewer] of state.viewers) ensureViewerListItem(peerId, viewer);
  let empty = els.viewerList.querySelector('.viewer-empty');
  if ([...state.viewers.values()].filter((v) => !v.disconnectedAt).length === 0) {
    if (!empty) { empty = document.createElement('div'); empty.className = 'viewer-empty'; empty.textContent = 'Belum ada penonton.'; els.viewerList.appendChild(empty); }
  } else if (empty) empty.remove();
}

function renderViewerPanel() {
  if (!isAdmin()) { syncViewerSidebar(); return; }
  if (!els.viewerPanel || !els.viewerStrip) return;
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
    label.textContent = (state.settings.displayName || 'Kamu') + ' (Penyiar)';
    selfThumb.appendChild(v);
    selfThumb.appendChild(label);
    selfThumb.addEventListener('click', () => setSpotlight(null));
    els.viewerStrip.prepend(selfThumb);
  }
  const selfVid = selfThumb.querySelector('video');
  if (selfVid && selfVid.srcObject !== state.localStream) selfVid.srcObject = state.localStream || null;
  const selfLabel = selfThumb.querySelector('.thumb-label');
  if (selfLabel) selfLabel.textContent = (state.settings.displayName || 'Kamu') + ' (Penyiar)';
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
  if (!viewer || !isAdmin() || !els.viewerStrip) return;
  let thumb = els.viewerStrip.querySelector(`[data-peer="${cssEsc(peerId)}"]`);
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
  refreshViewerConnTypes();
}

function removeViewerThumb(peerId) {
  const v = state.viewers.get(peerId);
  if (v?.thumb) { v.thumb.remove(); v.thumb = null; v.video = null; }
  if (v?.listItem) { v.listItem.remove(); v.listItem = null; v.listVideo = null; }
  const el = els.viewerStrip.querySelector(`[data-peer="${cssEsc(peerId)}"]`);
  if (el) el.remove();
  const listEl = els.viewerList?.querySelector(`[data-peer="${cssEsc(peerId)}"]`);
  if (listEl) listEl.remove();
  if (state.spotlightId === peerId) setSpotlight(null);
  renderViewerPanel();
}


function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function syncPlayUI() {
  const paused = !!els.mainVideo?.paused;
  els.iconPlay?.classList.toggle('hidden', !paused);
  els.iconPause?.classList.toggle('hidden', paused);
  if (els.btnPlay) {
    els.btnPlay.setAttribute('aria-label', paused ? 'Putar' : 'Jeda');
    els.btnPlay.setAttribute('title', paused ? 'Putar' : 'Jeda');
  }
}

function syncVolumeUI() {
  const v = els.mainVideo;
  if (!v) return;
  const muted = v.muted || v.volume === 0;
  els.iconVol?.classList.toggle('hidden', muted);
  els.iconMuted?.classList.toggle('hidden', !muted);
  if (els.volRange) els.volRange.value = String(Math.round((v.muted ? 0 : v.volume) * 100));
  if (els.btnMute) {
    els.btnMute.setAttribute('aria-label', muted ? 'Bunyikan' : 'Bisu');
    els.btnMute.setAttribute('title', muted ? 'Bunyikan' : 'Bisu');
  }
}

function syncShareUI() {
  const active = !!state.screenSharing;
  els.btnSharePause?.classList.toggle('hidden', !active);
  els.btnShareStop?.classList.toggle('hidden', !active);
  const paused = !!state.screenPaused;
  els.iconSharePause?.classList.toggle('hidden', paused);
  els.iconShareResume?.classList.toggle('hidden', !paused);
  if (els.btnSharePause) {
    els.btnSharePause.setAttribute('aria-label', paused ? 'Lanjut Share' : 'Jeda Share');
    els.btnSharePause.setAttribute('title', paused ? 'Lanjut Share' : 'Jeda Share');
  }
}

function updateOnlineTime() {
  if (els.timeDisplay) els.timeDisplay.textContent = formatClock(Date.now() - (state.onlineSince || Date.now()));
}
function appendChatMessage(msg) {
  if (!els.chatMessages) return;
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg' + (msg.self ? ' mine' : '');
  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';
  const name = document.createElement('span');
  name.className = 'chat-msg-name';
  name.textContent = msg.self ? (state.settings.displayName || 'Kamu') : (msg.name || msg.peerId || 'User');
  const time = document.createElement('span');
  time.className = 'chat-msg-time';
  const d = new Date(msg.ts || Date.now());
  time.textContent = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit' });
  meta.appendChild(name);
  meta.appendChild(time);
  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  body.textContent = String(msg.text || '');
  wrap.appendChild(meta);
  wrap.appendChild(body);
  els.chatMessages.appendChild(wrap);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function addChatMessage(msg) {
  state.chatMessages.push(msg);
  if (state.chatMessages.length > 200) state.chatMessages.shift();
  appendChatMessage(msg);
}
function syncCamUI() {
  const on = !!state.camEnabled;
  els.iconCamOn?.classList.toggle('hidden', !on);
  els.iconCamOff?.classList.toggle('hidden', on);
  if (els.btnCamToggle) {
    els.btnCamToggle.setAttribute('aria-label', on ? 'Matikan Kamera' : 'Nyalakan Kamera');
    els.btnCamToggle.setAttribute('title', on ? 'Matikan Kamera' : 'Nyalakan Kamera');
  }
}

function syncMicUI() {
  const on = !!state.micEnabled;
  els.iconMicOn?.classList.toggle('hidden', !on);
  els.iconMicOff?.classList.toggle('hidden', on);
  if (els.btnMicToggle) {
    els.btnMicToggle.setAttribute('aria-label', on ? 'Matikan Mic' : 'Nyalakan Mic');
    els.btnMicToggle.setAttribute('title', on ? 'Matikan Mic' : 'Nyalakan Mic');
  }
}

function renderPlaylist() {
  const list = $('playlist-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.playlist.length) {
    const empty = document.createElement('div');
    empty.className = 'viewer-empty';
    empty.textContent = 'Belum ada file. Tambah MP3/video untuk disiarkan.';
    list.appendChild(empty);
  } else {
    state.playlist.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'playlist-item' + (idx === state.playlistIndex ? ' active' : '');
      const name = document.createElement('div');
      name.className = 'playlist-item-name';
      name.textContent = item.name || `Item ${idx + 1}`;
      name.title = item.name || '';
      const meta = document.createElement('div');
      meta.className = 'playlist-item-meta';
      meta.textContent = item.type.startsWith('audio') ? 'Audio' : 'Video';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'playlist-item-remove';
      rm.textContent = '×';
      rm.title = 'Hapus';
      rm.addEventListener('click', (e) => { e.stopPropagation(); removePlaylistItem(idx); });
      row.addEventListener('click', () => playPlaylistIndex(idx));
      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(rm);
      list.appendChild(row);
    });
  }
  const now = $('playlist-now');
  const cur = state.playlist[state.playlistIndex];
  if (now) now.textContent = cur ? `Sekarang: ${cur.name}` : 'Belum ada media diputar.';
  const playIcon = $('playlist-play-icon');
  const pauseIcon = $('playlist-pause-icon');
  if (playIcon) playIcon.classList.toggle('hidden', !!state.playlistPlaying);
  if (pauseIcon) pauseIcon.classList.toggle('hidden', !state.playlistPlaying);
  const playBtn = $('playlist-play');
  if (playBtn) { playBtn.setAttribute('aria-label', state.playlistPlaying ? 'Jeda' : 'Putar'); playBtn.setAttribute('title', state.playlistPlaying ? 'Jeda' : 'Putar'); }
  const loopBtn = $('playlist-loop');
  if (loopBtn) loopBtn.classList.toggle('active', !!state.playlistLoop);
}
