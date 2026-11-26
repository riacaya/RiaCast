var ADMIN_PEER_ID = 'riacast-99';
var ADMIN_PASSWORD_HASH = '5d85f33c7ae322a3e50a7113d8ac16dee6aaa8e4f680697c234d05c0003bfb10';
var ADMIN_FLAG_KEY = 'riacast-admin';
var SETTINGS_KEY = 'riacast-settings';
var VIEWER_ID_KEY = 'riacast-viewer-id';
var THEME_KEY = 'riacast-theme';

var $ = (id) => document.getElementById(id);
var qs = (sel, root = document) => root.querySelector(sel);
var qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

var els = {
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

var state = {
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


