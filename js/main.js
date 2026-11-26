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
