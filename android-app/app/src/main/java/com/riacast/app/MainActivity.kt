package com.riacast.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.lang.ref.WeakReference

/**
 * Wadah WebView untuk RiaCast (single HTML dari assets/riacast.html).
 * Seluruh perubahan perilaku Android (izin kamera/mikrofon WebView,
 * geolocation, file picker, jembatan notifikasi) berada di sini sehingga
 * file web RiaCast tidak perlu diubah.
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "RiaCastMain"

        /** Aplikasi sedang terlihat, dipakai untuk menghindari notifikasi ganda. */
        @Volatile
        var visible = false

        /** WebView sudah hidup. */
        @Volatile
        private var webViewRef: WeakReference<WebView>? = null

        /** Simpan respons FCM sampai listener panggilan di halaman siap. */
        @Volatile
        private var pendingCallResponse: Triple<String, String, String>? = null

        @Volatile
        private var pageReady = false

        fun flushPendingCallResponse() {
            val response = pendingCallResponse ?: return
            val view = webViewRef?.get() ?: return
            if (!pageReady) return
            pendingCallResponse = null
            val event = if (response.first == "call-accepted") "riacast:fcm-call-accepted" else "riacast:fcm-call-declined"
            val script = "window.dispatchEvent(new CustomEvent('$event',{detail:{peerId:${JSONObject.quote(response.second)},callId:${JSONObject.quote(response.third)}}}))"
            view.post { view.evaluateJavascript(script, null) }
        }

        fun dispatchCallResponse(kind: String, peerId: String, callId: String = "") {
            val view = webViewRef?.get()
            if (view == null || !pageReady) {
                pendingCallResponse = Triple(kind, peerId, callId)
                return
            }
            val event = when (kind) {
                "call-accepted" -> "riacast:fcm-call-accepted"
                "call-declined" -> "riacast:fcm-call-declined"
                else -> "riacast:fcm-call-cancelled"
            }
            val script = "window.dispatchEvent(new CustomEvent('$event',{detail:{peerId:${JSONObject.quote(peerId)},callId:${JSONObject.quote(callId)}}}))"
            view.post { view.evaluateJavascript(script, null) }
        }

        /** Halaman mengonfirmasi panel dering in-app sudah menangani push call. */
        @Volatile
        private var pushCallUiShown = false

        fun markPushCallUiShown() {
            pushCallUiShown = true
        }

        /**
         * Push panggilan saat APK terlihat → panel dering in-app, tanpa
         * notifikasi sistem (sama seperti shell Windows yang melewatkan popup).
         * Halaman harus konfirmasi lewat Bridge.pushCallShown; bila dalam 4 dtk
         * tidak dikonfirmasi (halaman versi lama/belum siap), notifikasi
         * Jawab/Tolak ditampilkan seperti biasa agar panggilan tak hilang.
         */
        fun dispatchIncomingCall(
            context: android.content.Context,
            peerId: String,
            callId: String,
            video: Boolean,
            displayName: String,
        ): Boolean {
            val view = webViewRef?.get() ?: return false
            if (!pageReady || !visible) return false
            pushCallUiShown = false
            val script = "window.dispatchEvent(new CustomEvent('riacast:fcm-call-incoming',{detail:{peerId:${JSONObject.quote(peerId)},callId:${JSONObject.quote(callId)},video:$video}}))"
            view.post { view.evaluateJavascript(script, null) }
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (!pushCallUiShown) {
                    Notify.showCallFromPush(context.applicationContext, peerId, displayName, video, callId)
                }
            }, 4000L)
            return true
        }

        /**
         * "Jawab" ditekan pada notifikasi — bila WebView belum siap (aplikasi
         * baru dibuka dari push FCM), klik terima otomatis begitu panel
         * berdering muncul. Sesi berhenti jika dijawab atau ditolak.
         */
        @Volatile
        var pendingAnswer = false

        @Volatile
        private var peerReady = false

        @Volatile
        private var pendingAnswerPeer = ""
        @Volatile
        private var pendingAnswerCallId = ""

        fun peerStatus(status: String): Pair<String, String>? {
            peerReady = status.equals("online", ignoreCase = true)
            if (!peerReady) return null
            if (pendingAnswer && pendingAnswerPeer.isNotBlank()) {
                val response = pendingAnswerPeer to pendingAnswerCallId
                pendingAnswerPeer = ""
                pendingAnswerCallId = ""
                return response
            }
            flushPendingCallResponse()
            return null
        }

        fun takeAnswerIfPeerReady(): Pair<String, String>? {
            if (!pendingAnswer || !peerReady || pendingAnswerPeer.isBlank()) return null
            val response = pendingAnswerPeer to pendingAnswerCallId
            // Simpan salinan untuk pengiriman ulang sinyal (P2P/relay) sampai
            // panggilan benar-benar terhubung; peer/callId tetap tersedia.
            return response
        }

        fun getPendingAnswerPeer(): String = pendingAnswerPeer
        fun getPendingAnswerCallId(): String = pendingAnswerCallId

        fun sendCallAccepted(context: android.content.Context, peer: String, callId: String = "") {
            if (peer.isBlank()) return
            val caller = Relay.storedPeer(context)
            Thread {
                // Coba beberapa kali: saat bangun dari tidur jaringan/endpoint
                // bisa belum siap, dan pemanggil menunggu sinyal ini untuk mulai P2P.
                for (attempt in 0 until 5) {
                    Relay.notify(peer, "call-accepted", caller, "Jawaban diterima", callId)
                    try { Thread.sleep(2000) } catch (_: Exception) {}
                }
            }.start()
        }

        /** Target chat dari isi notifikasi pesan. */
        @Volatile
        private var pendingOpenPeer: String? = null

        /** Ambil + kosongkan target deep-link (dipanggil Bridge, thread JS). */
        fun takeOpenPeer(): String {
            val peer = pendingOpenPeer ?: return ""
            pendingOpenPeer = null
            return peer
        }

        private val mainHandler = Handler(Looper.getMainLooper())
        private var answerExpiry: Runnable? = null

        private fun startAnswerExpiry() {
            answerExpiry?.let { mainHandler.removeCallbacks(it) }
            answerExpiry = Runnable { resetPendingAnswer() }
            mainHandler.postDelayed(answerExpiry!!, 60_000L)
        }

        fun resetPendingAnswer() {
            pendingAnswer = false
            pendingAnswerPeer = ""
            pendingAnswerCallId = ""
            answerExpiry?.let { mainHandler.removeCallbacks(it) }
            answerExpiry = null
            webViewRef?.get()?.let { view ->
                view.post { view.evaluateJavascript("window.__riacastAutoAnswerPending=false", null) }
            }
        }

        private const val REMOTE_APP_URL = "https://riacaya.github.io/RiaCast/"
        private const val REQ_PERMS = 11
        private const val REQ_CAPTURE = 12
        private const val REQ_PICK = 13
        private val REQUIRED = arrayOf(
            Manifest.permission.POST_NOTIFICATIONS,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
    }

    private lateinit var webView: WebView
    private var fileChooser: ValueCallback<Array<Uri>>? = null
    private var captureUri: Uri? = null
    private var injectedJs: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Inspeksi WebView (chrome://inspect) hanya saat build debug — dipakai
        // untuk pengujian dua perangkat. Build rilis tidak pernah membukanya,
        // sehingga halaman aplikasi tetap tertutup dari debugger luar.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        if (Build.VERSION.SDK_INT >= 28) setTurnScreenOn(true)
        setContentView(R.layout.activity_main)
        applyEdgeToEdgeInsets()
        Notify.ensureChannels(this)
        requestMissingPermissions()
        injectedJs = runCatching {
            assets.open("injected.js").bufferedReader().use { it.readText() }
        }.getOrNull()
        webView = findViewById(R.id.webview)
        webViewRef = WeakReference(webView)
        setupWebView()
        webView.loadUrl(REMOTE_APP_URL)
        MyFirebaseMessagingService.fetchToken(this)
        handleCallIntent(intent)
        ensureFullScreenIntentPermission()
    }

    /**
     * Android 14+ dengan targetSdk 35: izin USE_FULL_SCREEN_INTENT tidak lagi
     * otomatis untuk aplikasi non-dialer. Tanpa izin ini panggilan hanya
     * memunculkan heads-up — panel tidak tampil saat layar mati. Arahkan ke
     * pengaturan satu kali; dilewati saat app dibuka oleh panggilan supaya
     * dialog tidak menutupi layar dering.
     */
    private fun ensureFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < 34) return
        val notifier = getSystemService(NotificationManager::class.java) ?: return
        if (notifier.canUseFullScreenIntent()) return
        if (intent?.getStringExtra(Notify.EXTRA_CALL_ACTION) != null) return
        val prefs = getSharedPreferences("riacast-setup", MODE_PRIVATE)
        if (prefs.getBoolean("fsei-asked", false)) return
        prefs.edit().putBoolean("fsei-asked", true).apply()
        AlertDialog.Builder(this)
            .setTitle("Izin tampil layar penuh")
            .setMessage("Agar panel panggilan muncul saat layar mati/terkunci, izinkan \"Full-screen intents\" untuk RiaCast pada pengaturan berikut.")
            .setPositiveButton("Buka Pengaturan") { _, _ ->
                runCatching {
                    startActivity(
                        Intent(
                            Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                            Uri.parse("package:$packageName"),
                        ),
                    )
                }
            }
            .setNegativeButton("Nanti", null)
            .show()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) setIntent(intent)
        handleCallIntent(intent)
    }

    /**
     * Notifikasi dibuka (tap isi pesan → peer chat, tap panggilan → "incoming"
     * / "answer"): simpan target chat untuk ditarik halaman (pull) + batalkan
     * notifikasi.
     *
     * Tombol Jawab di notifikasi membuka app; auto-terima menunggu panggilan P2P
     * biasa muncul di halaman.
     */
    private fun handleCallIntent(intent: Intent?) {
        if (intent == null) return
        val peer = intent.getStringExtra(Notify.EXTRA_OPEN_PEER)
        val callId = intent.getStringExtra(Notify.EXTRA_CALL_ID).orEmpty()
        val action = intent.getStringExtra(Notify.EXTRA_CALL_ACTION)
        // FCM hanya membawa identitas lawan dan aksi tombol; panggilan media
        // tetap datang melalui jalur PeerJS normal setelah app bangun.
        val callAction = action == "answer"
        if (action == "answer" || action == "show") {
            if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
            if (Build.VERSION.SDK_INT >= 28) setTurnScreenOn(true)
        }
        if (!peer.isNullOrBlank()) {
            // Hanya disimpan — injected.js menariknya setelah halaman siap,
            // jadi tidak peduli kapan activity dibuka. Konsumsi sekali:
            // pembukaan ulang (rotasi/recycle) tidak mengulang deep-link.
            if (!callAction) {
                pendingOpenPeer = peer
            }
            intent.removeExtra(Notify.EXTRA_OPEN_PEER)
        }
        if (action == null) return
        if (action == "show") {
            // Full-screen intent (layar mati/terkunci): cukup buka aplikasi —
            // panel dering tampil dari sesi P2P di halaman. Tanpa auto-jawab
            // tanpa izin pengguna; notifikasi dibatalkan saat onResume.
            return
        }
        if (action != "answer") {
            Notify.cancelIncomingCall(this)
        }
        if (action == "answer") {
            // Tombol "Jawab" di panel notifikasi: pengguna memang ingin
            // terima - klik terima otomatis begitu panel dering asli muncul
            // (dering menyusul dari pemanggil setelah aplikasi bangun).
            // Pastikan WebView memuat UI RiaCast (penting saat cold/wake) tanpa
            // memaksa reload jika sudah berada di URL aplikasi.
            val currentUrl = webView.url.orEmpty()
            if (!currentUrl.startsWith(REMOTE_APP_URL)) {
                webView.loadUrl(REMOTE_APP_URL)
            }
            pendingAnswer = true
            startAnswerExpiry()
            armAutoAnswer()
            if (!peer.isNullOrBlank()) {
                pendingAnswerPeer = peer
                pendingAnswerCallId = callId
                // Kirim segera (jika peer sudah siap) dan andalkan retry/p2p fallback.
                takeAnswerIfPeerReady()?.let { answer ->
                    sendCallAccepted(this, answer.first, answer.second)
                }
            }
        }
    }

    private fun armAutoAnswer() {
        webView.evaluateJavascript("window.__riacastAutoAnswerPending=true", null)
    }

    /**
     * Android 11+ (dan wajib di Android 15) konten mengalir ke belakang bar
     * status & navigasi. Gulung isi ke dalam area bar (warna navy root)
     * supaya halaman tidak menabrak bar atas/bawah.
     */
    private fun applyEdgeToEdgeInsets() {
        if (Build.VERSION.SDK_INT < 30) return // Android 10 ke bawah: dekorasi sudah pas.
        window.setDecorFitsSystemWindows(false)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun requestMissingPermissions() {
        val missing = REQUIRED.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQ_PERMS)
        }
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setGeolocationEnabled(true)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString RiaCastApp/1.0"
        }
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                if (request == null) return null
                return assetLoader.shouldInterceptRequest(request.url)
            }

            // Suntik injected.js setiap halaman selesai dimuat — jembatan
            // notifikasi native (window.RiaCastAndroid) aktif sejak awal.
            override fun onPageStarted(
                view: WebView?,
                url: String?,
                favicon: android.graphics.Bitmap?,
            ) {
                super.onPageStarted(view, url, favicon)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageReady = true
                val js = injectedJs
                if (!js.isNullOrBlank()) {
                    view?.evaluateJavascript(js, null)
                }
                if (pendingAnswer) view?.evaluateJavascript("window.__riacastAutoAnswerPending=true", null)
                view?.evaluateJavascript(peerLifecycleScript(visible), null)
                flushPendingCallResponse()
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("https://appassets.androidplatform.net/")) return false
                if (url.startsWith(REMOTE_APP_URL)) return false
                openExternal(url)
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // getUserMedia (voice/video call, foto & video kamera) di dalam WebView:
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wanted = request.resources.filter {
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
                            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                    }
                    val granted = wanted.filter { resource ->
                        val permission =
                            if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                                Manifest.permission.RECORD_AUDIO
                            else
                                Manifest.permission.CAMERA
                        checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
                    }
                    if (granted.isNotEmpty()) {
                        request.grant(granted.toTypedArray())
                    } else {
                        request.deny()
                        requestMissingPermissions()
                    }
                }
            }

            // Geolocation panel Lokasi:
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                val granted =
                    checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
                        PackageManager.PERMISSION_GRANTED
                callback?.invoke(origin ?: "", granted, false)
                if (!granted) requestMissingPermissions()
            }

            // Pilih file lampiran (menu File / Memory):
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?,
            ): Boolean {
                fileChooser?.onReceiveValue(null)
                fileChooser = callback
                if (params?.isCaptureEnabled == true) {
                    val video = params.acceptTypes.any { it.contains("video", true) }
                    if (launchCapture(video)) return true
                }
                val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    val types = params?.acceptTypes?.filter { it.isNotEmpty() }?.toTypedArray()
                    if (!types.isNullOrEmpty()) {
                        putExtra(Intent.EXTRA_MIME_TYPES, types)
                    }
                }
                return try {
                    startActivityForResult(pick, REQ_PICK)
                    true
                } catch (error: Exception) {
                    Log.w(TAG, "pembuka file gagal", error)
                    finishFileChooser(null)
                    false
                }
            }

            override fun onConsoleMessage(message: ConsoleMessage?): Boolean {
                Log.d(TAG, "web: ${message?.message()} (${message?.sourceId()}:${message?.lineNumber()})")
                return true
            }
        }
        // Jembatan ke injected.js — semua notifikasi & relai push lewat sini.
        webView.addJavascriptInterface(Bridge(applicationContext), "RiaCastAndroid")
    }

    private fun launchCapture(video: Boolean): Boolean {
        return try {
            val dir = File(cacheDir, "captures").apply { mkdirs() }
            val file = File(
                dir,
                "cap_${System.currentTimeMillis()}" + if (video) ".mp4" else ".jpg",
            )
            captureUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = if (video) {
                Intent(MediaStore.ACTION_VIDEO_CAPTURE)
            } else {
                Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            }
            intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri)
            intent.addFlags(
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
            startActivityForResult(intent, REQ_CAPTURE)
            true
        } catch (error: Exception) {
            Log.w(TAG, "kamera sistem gagal", error)
            false
        }
    }

    @Deprecated("Compat Activity API — tetap dipakai untuk hasil kamera/pilihan file.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_CAPTURE -> {
                val uri = if (resultCode == RESULT_OK) captureUri else null
                captureUri = null
                finishFileChooser(uri?.let { arrayOf(it) })
            }
            REQ_PICK -> {
                val uri = if (resultCode == RESULT_OK) data?.data else null
                finishFileChooser(uri?.let { arrayOf(it) })
            }
        }
    }

    private fun finishFileChooser(uris: Array<Uri>?) {
        fileChooser?.onReceiveValue(uris)
        fileChooser = null
    }

    private fun openExternal(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (error: Exception) {
            Log.w(TAG, "buka browser gagal: $url", error)
        }
    }

    @Deprecated("Back klasik Activity.")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        visible = true
        webView.onResume()
        webView.evaluateJavascript(peerLifecycleScript(true), null)
        // Selalu di depan: panggilan masuk membatalkan notifikasi layar kunci.
        intent?.getStringExtra(Notify.EXTRA_CALL_ACTION)?.let {
            Notify.dismissIncomingCall(this)
        }
    }

    override fun onPause() {
        visible = false
        peerReady = false
        webView.evaluateJavascript(peerLifecycleScript(false), null)
        super.onPause()
    }

    private fun peerLifecycleScript(active: Boolean): String = if (active) {
        "(function(){try{var p=window.RiaCastP2P;var id=sessionStorage.getItem('riacast-v2-session-user')||'';if(id)p?.start(id);else p?.stop?.();if(p?.isPeerReady?.())window.RiaCastAndroid?.peerStatus('online')}catch(e){}})()"
    } else {
        "window.RiaCastP2P?.stop?.()"
    }

    override fun onDestroy() {
        webViewRef = null
        webView.destroy()
        super.onDestroy()
    }
}
