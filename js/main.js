function bindUI() {
  qsa('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id === 'viewers-overlay') moveViewerListBack();
      closeOverlay(id);
    });
  });
  window.addEventListener('resize', syncSidebarHeight);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) $('side-card')?.classList.remove('mobile-open');
  });
  document.addEventListener('click', (e) => {
    const side = $('side-card');
    if (!side || !side.classList.contains('mobile-open')) return;
    if (side.contains(e.target)) return;
    if (e.target.closest('#btn-header-viewers, #btn-header-device, #btn-header-playlist')) return;
    side.classList.remove('mobile-open');
  });
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

  ['settings-overlay', 'admin-overlay', 'status-overlay', 'about-overlay', 'chat-overlay', 'viewers-overlay'].forEach((id) => {
    const ov = $(id);
    ov?.addEventListener('click', (e) => { if (e.target === ov) { if (id === 'viewers-overlay') moveViewerListBack(); ov.classList.add('hidden'); } });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('viewers-overlay')?.classList.contains('hidden')) moveViewerListBack();
      closeOverlay('settings-overlay');
      closeOverlay('admin-overlay');
      closeOverlay('status-overlay');
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
    if (typeof stopScreenCapture === 'function') await stopScreenCapture();
    else { stopLocalStream(); try { await ensureLocalStream(); } catch {} }
  });

  els.btnCamToggle?.addEventListener('click', async () => {
    state.camEnabled = !state.camEnabled;
    await ensureLocalStream().catch(() => {});
    syncCamUI();
    log(state.camEnabled ? 'Kamera aktif.' : 'Kamera nonaktif.');
  });

  els.btnMicToggle?.addEventListener('click', async () => {
    state.micEnabled = !state.micEnabled;
    await ensureLocalStream().catch(() => {});
    syncMicUI();
    log(state.micEnabled ? 'Mic aktif.' : 'Mic nonaktif.');
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
  $('btn-header-viewers')?.addEventListener('click', () => { if (!isAdmin()) return; setSidebarPanel('viewers'); });
  $('btn-header-device')?.addEventListener('click', () => { if (!isAdmin()) return; setSidebarPanel('device'); });
  $('btn-header-playlist')?.addEventListener('click', () => { if (!isAdmin()) return; setSidebarPanel('playlist'); });
  $('open-status-panel')?.addEventListener('click', () => {
    if (els.displayName) els.displayName.value = state.settings.displayName || '';
    closeOverlay('settings-overlay');
    openOverlay('status-overlay');
  });
  $('playlist-file-input')?.addEventListener('change', handlePlaylistFiles);
  $('playlist-clear')?.addEventListener('click', clearPlaylist);
  $('playlist-prev')?.addEventListener('click', playPrevPlaylist);
  $('playlist-play')?.addEventListener('click', togglePlaylistPlayback);
  $('playlist-next')?.addEventListener('click', playNextPlaylist);
  $('playlist-loop')?.addEventListener('click', togglePlaylistLoop);
  $('playlist-save')?.addEventListener('click', savePlaylist);
  $('playlist-progress')?.addEventListener('input', (e) => {
    const el = state.playlistEl;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const ratio = Math.max(0, Math.min(1000, Number(e.target.value || 0))) / 1000;
    el.currentTime = ratio * el.duration;
    syncPlaylistProgress();
  });
  $('btn-copy-log')?.addEventListener('click', async () => {
    const text = els.logList?.value || '';
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      log('Log disalin.');
    } catch (e) {
      log('Gagal menyalin log: ' + (e?.message || e));
    }
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
  qsa('.theme-btn[data-theme]').forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

  els.btnScreenShare?.addEventListener('click', async () => {
    if (typeof toggleScreenCapture === 'function') await toggleScreenCapture();
    if (typeof syncStudioUI === 'function') syncStudioUI();
  });

  els.studioSource?.addEventListener('change', async () => {
    if (!isAdmin()) return;
    const val = els.studioSource.value;
    if (val === 'camera') {
      state.mainSource = 'camera';
      await ensureLocalStream().catch(() => {});
    } else if (val === 'screen') {
      if (state.screenCaptureStream) {
        state.mainSource = 'screen';
        await ensureLocalStream().catch(() => {});
      } else if (typeof toggleScreenCapture === 'function') {
        await toggleScreenCapture();
      }
    } else if (val === 'playlist') {
      state.mainSource = 'playlist';
      if (state.playlistStream && state.playlistEl) {
        await ensureLocalStream().catch(() => {});
      } else {
        setSidebarPanel('playlist');
        await ensureLocalStream().catch(() => {});
      }
    }
    if (typeof syncStudioUI === 'function') syncStudioUI();
  });

  els.studioOpenPlaylist?.addEventListener('click', () => { if (isAdmin()) setSidebarPanel('playlist'); });

  $('save-name')?.addEventListener('click', () => {
    if (!els.displayName) return;
    state.settings.displayName = els.displayName.value.trim().slice(0, 32);
    saveSettings();
    log('Nama tampilan disimpan.');
    if (typeof renderViewerPanel === 'function') renderViewerPanel();
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
  state.intervals.push(setInterval(updateViewerStatusUI, 1000));
  state.intervals.push(setInterval(refreshViewerConnTypes, 5000));
  state.intervals.push(setInterval(updateOnlineTime, 1000));
  state.intervals.push(setInterval(cleanupStaleViewers, 10000));
  state.intervals.push(setInterval(syncPlaylistProgress, 1000));
  updateOnlineTime();
  syncPlayUI();
  syncVolumeUI();
  syncShareUI();
  syncCamUI();
  syncMicUI();
  if (typeof setSidebarPanel === 'function') setSidebarPanel(state.sidebarPanel || 'viewers');
  els.displayName.value = state.settings.displayName || '';

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
