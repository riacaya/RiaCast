function bindUI() {
  qsa('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id === 'viewers-overlay') moveViewerListBack();
      closeOverlay(id);
    });
  });
  window.addEventListener('resize', syncSidebarHeight);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { requestAnimationFrame(syncSidebarHeight); });
    const stageCard = document.querySelector('.stage-card');
    const stage = document.querySelector('.video-stage');
    if (stageCard) ro.observe(stageCard);
    if (stage) ro.observe(stage);
  }
  els.viewerScrollLeft?.addEventListener('click', () => {
    els.viewerStrip.scrollBy({ left: -240, behavior: 'smooth' });
  });
  els.viewerScrollRight?.addEventListener('click', () => {
    els.viewerStrip.scrollBy({ left: 240, behavior: 'smooth' });
  });
  const moveViewerListToOverlay = () => {
    const list = $('viewer-list');
    const body = $('viewers-overlay-body');
    if (list && body && list.parentElement !== body) body.appendChild(list);
  };
  const moveViewerListBack = () => {
    const list = $('viewer-list');
    const section = $('viewer-list-section');
    if (list && section && list.parentElement !== section) section.appendChild(list);
  };

  ['settings-overlay', 'admin-overlay', 'device-overlay', 'about-overlay', 'chat-overlay', 'viewers-overlay'].forEach((id) => {
    const ov = $(id);
    ov?.addEventListener('click', (e) => { if (e.target === ov) { if (id === 'viewers-overlay') moveViewerListBack(); ov.classList.add('hidden'); } });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('viewers-overlay')?.classList.contains('hidden')) moveViewerListBack();
      closeOverlay('settings-overlay');
      closeOverlay('admin-overlay');
      closeOverlay('device-overlay');
      closeOverlay('about-overlay');
      closeOverlay('chat-overlay');
      closeOverlay('viewers-overlay');
    }
  });
  els.btnFullscreen?.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenUI);
  document.addEventListener('webkitfullscreenchange', syncFullscreenUI);

  els.btnPlay?.addEventListener('click', () => {
    const v = els.mainVideo; if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  });
  els.btnMute?.addEventListener('click', () => {
    const v = els.mainVideo; if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 1;
    syncVolumeUI();
  });
  els.volRange?.addEventListener('input', (e) => {
    const v = els.mainVideo; if (!v) return;
    const val = Math.max(0, Math.min(100, Number(e.target.value || 0)));
    v.volume = val / 100;
    v.muted = val === 0;
    syncVolumeUI();
  });
  els.mainVideo?.addEventListener('play', syncPlayUI);
  els.mainVideo?.addEventListener('pause', syncPlayUI);
  els.mainVideo?.addEventListener('volumechange', syncVolumeUI);

  els.btnSharePause?.addEventListener('click', () => {
    const s = state.localStream; if (!s) return;
    const videoTracks = s.getVideoTracks();
    if (!videoTracks.length) return;
    state.screenPaused = !state.screenPaused;
    videoTracks.forEach((t) => { t.enabled = !state.screenPaused; });
    syncShareUI();
    log(state.screenPaused ? 'Screen share dijeda.' : 'Screen share dilanjutkan.');
  });
  els.btnShareStop?.addEventListener('click', async () => {
    log('Stop share diminta.');
    state.screenPaused = false;
    state.screenSharing = false;
    syncShareUI();
    if (state.settings.videoSource === 'screen') {
      state.settings.videoSource = 'camera';
      if (els.prefVideo) els.prefVideo.value = 'camera';
      saveSettings();
    }
    stopLocalStream();
    try { await ensureLocalStream(); } catch {}
  });

  els.chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChatFromUI();
    $('chat-emoji-picker')?.classList.add('hidden');
  });

  const emojiPicker = $('chat-emoji-picker');
  const emojiBtn = $('chat-emoji-btn');
  const emojis = ['😀','😃','😄','😁','😅','😂','🤣','😊','😍','😘','😎','🤔','😮','😢','😭','😡','👍','👎','👏','🙏','💪','🔥','❤️','🎉','✅','❌','⭐','💡','📌','👀','💬','🚀','🙂','😉','😴','🤝','👌','✨','🎶','☕'];
  if (emojiPicker) {
    emojiPicker.innerHTML = emojis.map((e) => `<button type="button" class="chat-emoji">${e}</button>`).join('');
    emojiPicker.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chat-emoji');
      if (!btn || !els.chatInput) return;
      const start = els.chatInput.selectionStart ?? els.chatInput.value.length;
      const end = els.chatInput.selectionEnd ?? els.chatInput.value.length;
      const v = els.chatInput.value;
      const next = (v.slice(0, start) + btn.textContent + v.slice(end)).slice(0, 500);
      els.chatInput.value = next;
      const pos = Math.min(start + btn.textContent.length, next.length);
      els.chatInput.focus();
      els.chatInput.setSelectionRange(pos, pos);
    });
  }
  emojiBtn?.addEventListener('click', () => {
    emojiPicker?.classList.toggle('hidden');
  });

  els.btnSettings.addEventListener('click', () => {
    openOverlay('settings-overlay');
  });
  $('open-device-panel')?.addEventListener('click', () => {
    els.displayName.value = state.settings.displayName || '';
    els.prefVideo.value = state.settings.videoSource || 'camera';
    els.prefAudio.value = state.settings.audioSource || 'mic';
    setDeviceTab('device');
    openOverlay('device-overlay');
  });
  $('open-about-panel')?.addEventListener('click', () => openOverlay('about-overlay'));
  $('open-chat-panel')?.addEventListener('click', () => {
    closeOverlay('settings-overlay');
    openOverlay('chat-overlay');
    setTimeout(() => els.chatInput?.focus(), 50);
  });
  $('open-viewers-panel')?.addEventListener('click', () => {
    closeOverlay('settings-overlay');
    moveViewerListToOverlay();
    openOverlay('viewers-overlay');
  });
  qsa('.tab-btn[data-tab]').forEach((btn) => btn.addEventListener('click', () => setDeviceTab(btn.dataset.tab)));
  qsa('.theme-btn[data-theme]').forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

  els.saveSettings.addEventListener('click', async () => {
    state.settings.displayName = els.displayName.value.trim().slice(0, 32);
    state.settings.videoSource = els.prefVideo.value || 'camera';
    state.settings.audioSource = els.prefAudio.value || 'mic';
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
  setInterval(refreshViewerConnTypes, 5000);
  setInterval(updateOnlineTime, 1000);
  updateOnlineTime();
  syncPlayUI();
  syncVolumeUI();
  syncShareUI();
  els.displayName.value = state.settings.displayName || '';
  els.prefVideo.value = state.settings.videoSource || 'camera';
  els.prefAudio.value = state.settings.audioSource || 'mic';

  if (!window.Peer) {
    setStatus('PeerJS tidak tersedia', 'err');
    setOverlay('PeerJS gagal dimuat', 'File vendor/peerjs.min.js tidak ditemukan.', true);
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
