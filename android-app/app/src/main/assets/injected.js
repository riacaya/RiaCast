/**
 * injected.js — dijalankan Android (MainActivity) setelah halaman RiaCast
 * dimuat. Berkas web tidak diubah oleh berkas ini; hanya:
 *  1. meneruskan event aplikasi ke notifikasi native (window.RiaCastAndroid),
 *  2. mendaftarkan peer penerima ke relai push (token FCM, tahap 2),
 *  3. mengalihkan window.open ke browser perangkat.
 * Push pesan dan panggilan ditangani oleh scripts/core/push.js.
 */
(function () {
  "use strict";
  var A = window.RiaCastAndroid;
  if (!A || window.__RiaCastAndroidInjected) return;
  window.__RiaCastAndroidInjected = true;
  try { A.log("injected.js aktif — jembatan notifikasi siap"); } catch (e) {}

  function localId() {
    try {
      return (
        sessionStorage.getItem("riacast-v2-session-user") ||
        localStorage.getItem("riacast-v2-user") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function bare(peer) {
    return String(peer || "").replace(/^cm-/i, "").toLowerCase();
  }

  function register() {
    try {
      A.registerPeer(localId());
    } catch (e) {}
  }

  register();
  setInterval(register, 15000);
  try {
    var declinedRaw = A.takeDeclinedCall ? String(A.takeDeclinedCall() || "") : "";
    if (declinedRaw) {
      window.__riacastDeclinedCall = JSON.parse(declinedRaw);
      window.dispatchEvent(new CustomEvent("riacast:fcm-call-declined-local", { detail: window.__riacastDeclinedCall }));
    }
  } catch (e) {}

  // Tautan dibuka di browser perangkat, bukan di dalam WebView.
  window.open = function (url) {
    try {
      A.openExternal(String(url));
    } catch (e) {}
    return null;
  };

  // Panggilan P2P hanya meneruskan status ke app; notifikasi Jawab/Tolak
  // berasal dari FCM, bukan dari event P2P.
  window.addEventListener("riacast:incoming-call", function (event) {
    var detail = (event && event.detail) || {};
    var peer = detail.peer || detail.peerId || "";
    var meta = detail.metadata || {};
    var video =
      meta.video === true ||
      meta.video === "true" ||
      (meta.metadata && meta.metadata.video === true);
    try {
      A.incomingCall(bare(peer) || localId(), Boolean(video));
    } catch (e) {}
  });
  window.addEventListener("riacast:peer-server-status", function (event) {
    try { A.peerStatus(String(event?.detail?.status || "offline")); } catch (e) {}
  });
  // Panggilan ditutup lawan (control hangup) → matikan mode panggilan.
  window.addEventListener("riacast:p2p-message", function (event) {
    var detail = (event && event.detail) || {};
    try {
      if (detail.kind === "call-hangup") {
        A.cancelCall();
      }
      // Pesan teks masuk saat halaman tersembunyi → notifikasi native.
      // Pesan hasil drain antrean FCM (fromPush) tidak perlu dinotifikasi
      // lagi — notifikasi FCM aslinya sudah tampil saat aplikasi mati.
      if (detail.kind === "text" && detail.text && document.hidden && !detail.fromPush) {
        A.notify(
          String(detail.senderName || bare(detail.senderPeerId) || "RiaCast"),
          String(detail.text).slice(0, 160),
          bare(detail.senderPeerId)
        );
      }
    } catch (e) {}
  });

  // ---- Deep-link notifikasi (model pull) ----
  // Nilai peer dari extra notifikasi disimpan native (MainActivity) lalu
  // DITARIK lewat Bridge.takeOpenPeer() tiap 500 ms dan baru dikosongkan saat
  // ditarik.
  // Room yang sedang dituju deep-link notifikasi. Baris antrean FCM untuk
  // room ini ditahan sampai chatroom benar-benar aktif, agar pesannya
  // dirender langsung (storeAndRender) alih-alih dilempar ke friends.js yang
  // baru menyimpannya setelah room selesai dimuat — tanpa ini pesan tersimpan
  // terlambat dan baru tampil setelah keluar-masuk chatroom.
  var pendingOpenRoom = "";
  var pendingRoomTimer = null;

  function roomKeyFor(peer) {
    try {
      return window.RiaCastChatUtils?.roomKey?.(bare(peer)) || "";
    } catch (e) {
      return "";
    }
  }

  function openPeerRoom(peer) {
    peer = bare(peer);
    if (!peer) return;
    pendingOpenRoom = roomKeyFor(peer);
    // Batas aman: bila deep-link gagal terbuka, jangan tahan antrean selamanya.
    clearTimeout(pendingRoomTimer);
    pendingRoomTimer = setTimeout(function () { pendingOpenRoom = ""; }, 20000);
    try { A.log("deep-link: menargetkan chatroom " + peer); } catch (e) {}
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      // Belum login → jangan menyerah; restore sesi bisa terlambat dari
      // event pertama, jadi coba terus sampai sesi ada atau 60 detik lewat.
      var loggedIn = false;
      try { loggedIn = !!localId(); } catch (e) {}
      var ready =
        loggedIn &&
        window.RiaCastChat &&
        typeof window.RiaCastChat.open === "function" &&
        window.RiaCastStorage &&
        window.RiaCastApp;
      if (!ready && attempts > 120) {
        clearInterval(timer);
        return;
      }
      if (!ready) return;
      clearInterval(timer);
      // Panggilan berlangsung/berdering → panel panggilan tidak boleh ditimpa.
      try {
        var panel = window.RiaCastApp.current?.();
        if (panel === "voice-call" || panel === "video-call") return;
      } catch (e) {}
      window.RiaCastStorage.all("contacts")
        .then(function (rows) {
          // Cek ulang: panel panggilan bisa muncul selama kontak dibaca.
          try {
            var p = window.RiaCastApp.current?.();
            if (p === "voice-call" || p === "video-call") return;
          } catch (e) {}
          var found = null;
          (rows || []).forEach(function (row) {
            if (!found && bare(row.peerId) === peer) found = row;
          });
          return window.RiaCastChat.open(
            found || { peerId: peer, display_name: "" }
          );
        })
        .then(function () {
          pendingOpenRoom = "";
        })
        .catch(function () {
          pendingOpenRoom = "";
          window.RiaCastChat.open({ peerId: peer, display_name: "" });
        });
    }, 500);
  }

  function pullOpenPeer() {
    try {
      if (typeof A.takeOpenPeer !== "function") return;
      var peer = String(A.takeOpenPeer() || "");
      if (peer) openPeerRoom(peer);
    } catch (e) {}
  }
  pullOpenPeer();
  setInterval(pullOpenPeer, 500);

  // ---- Antrean pesan FCM (aplikasi mati) ----
  // MyFirebaseMessagingService menyimpan pesan yang tiba lewat push saat
  // aplikasi mati; di sini antrean dikuras menjadi event riacast:p2p-message
  // sintetis sehingga friends.js menyimpan + menaikkan unread dan chat.js
  // merender bila room-nya sedang terbuka (dedupe oleh id di kedua handler).

})();

  // Jaga flag auto-jawab saat ada jawaban notifikasi yang tertunda (app
  // bangun dari tidur/push) agar panggilan masuk P2P yang datang setelah
  // web siap tetap otomatis diterima.
  setInterval(function () {
    try {
      if (A && typeof A.hasPendingAnswer === "function" && A.hasPendingAnswer()) {
        window.__riacastAutoAnswerPending = true;
      }
    } catch (e) {}
  }, 1000);
  // Pastikan P2P dimulai saat ada jawaban tertunda (app bangun dari notifikasi).
  setInterval(function () {
    try {
      if (!(A && typeof A.hasPendingAnswer === "function" && A.hasPendingAnswer())) return;
      var user = "";
      try { user = sessionStorage.getItem("riacast-v2-session-user") || localStorage.getItem("riacast-v2-user") || ""; } catch (e) {}
      if (user && window.RiaCastP2P && typeof window.RiaCastP2P.start === "function") {
        window.RiaCastP2P.start(user);
      }
    } catch (e) {}
  }, 2000);
  // Kirim sinyal call-accepted ke pemanggil via P2P data channel (cadangan
  // selain Relay/FCM) saat jawaban tertunda dan P2P siap, agar pemanggil yang
  // menunggu jawaban dapat mulai panggilan meski push call-accepted tidak sampai.
  (function () {
    var lastSent = 0;
    setInterval(function () {
      try {
        if (!(A && typeof A.hasPendingAnswer === "function" && A.hasPendingAnswer())) return;
        if (!window.RiaCastP2P || typeof window.RiaCastP2P.isPeerReady !== "function" || !window.RiaCastP2P.isPeerReady()) return;
        var peer = "";
        var callId = "";
        try { peer = String(A.getPendingAnswerPeer ? A.getPendingAnswerPeer() : ""); } catch (e) {}
        try { callId = String(A.getPendingAnswerCallId ? A.getPendingAnswerCallId() : ""); } catch (e) {}
        if (!peer) return;
        var now = Date.now();
        if (now - lastSent < 2000) return;
        lastSent = now;
        try {
          if (typeof window.RiaCastP2P.connect === "function") window.RiaCastP2P.connect(peer, true);
        } catch (e) {}
        try {
          if (typeof window.RiaCastP2P.send === "function") {
            window.RiaCastP2P.send({ kind: "call-accepted", id: callId || "", callLogId: callId || "" }, peer);
          }
        } catch (e) {}
      } catch (e) {}
    }, 1500);
  })();