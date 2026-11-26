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


function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return ${String(h).padStart(2,'0')}::;
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

function updateOnlineTime() {
  if (els.timeDisplay) els.timeDisplay.textContent = formatClock(Date.now() - (state.onlineSince || Date.now()));
}
