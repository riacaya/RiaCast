package com.riacast.app

import android.content.Context
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Jembatan dipanggil dari injected.js di dalam WebView (window.RiaCastAndroid).
 * Metode jaringan berjalan di thread bridge Javascript, bukan thread UI.
 */
class Bridge(private val context: Context) {

    private var chatExportTemp: File? = null
    private var chatExportStream: FileOutputStream? = null

    companion object {
        private const val TAG = "RiaCastBridge"
    }

    @JavascriptInterface
    fun notify(title: String, body: String, peer: String?) {
        try {
            Notify.show(context, title, body, peer ?: "")
        } catch (error: Exception) {
            Log.w(TAG, "notify gagal", error)
        }
    }

    @JavascriptInterface
    fun incomingCall(from: String, video: Boolean) {
        try {
            // Panggilan P2P tidak pernah membuat notifikasi sistem. Notifikasi
            // Jawab/Tolak hanya dibuat oleh MyFirebaseMessagingService untuk FCM.
            // Notifikasi itu hanya dibatalkan bila aplikasi TAMPIL (panel dering
            // halaman sudah menggantikannya) atau pengguna sudah menekan Jawab.
            // Saat latar belakang notifikasi adalah satu-satunya UI — membuangnya
            // membuat panggilan membangunkan layar lalu hilang begitu saja.
            if (MainActivity.visible || MainActivity.pendingAnswer) Notify.dismissIncomingCall(context)
            if (MainActivity.pendingAnswer) return
            if (MainActivity.visible) Notify.playCallTone(context)
        } catch (error: Exception) {
            Log.w(TAG, "incomingCall gagal", error)
        }
    }

    @JavascriptInterface
    fun cancelCall() {
        try {
            Notify.cancelIncomingCall(context)
        } catch (error: Exception) {
            Log.w(TAG, "cancelCall gagal", error)
        }
    }

    /** Konfirmasi panel dering in-app menangani push call → batal fallback notif. */
    @JavascriptInterface
    fun pushCallShown() {
        try {
            MainActivity.markPushCallUiShown()
        } catch (error: Exception) {
            Log.w(TAG, "pushCallShown gagal", error)
        }
    }

    /** Versi APK untuk banner pembaruan & panel diagnostik halaman web. */
    @JavascriptInterface
    fun appVersion(): String {
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            JSONObject()
                .put("versionName", info.versionName ?: "")
                .put("versionCode", info.longVersionCode)
                .toString()
        } catch (error: Exception) {
            Log.w(TAG, "appVersion gagal", error)
            ""
        }
    }

    /** Jawab panggilan push-only dari panel in-app: kirim call-accepted lewat relay. */
    @JavascriptInterface
    fun acceptCall(peer: String, callId: String) {
        try {
            MainActivity.sendCallAccepted(context, peer, callId)
        } catch (error: Exception) {
            Log.w(TAG, "acceptCall gagal", error)
        }
    }

    @JavascriptInterface
    fun answeredCall() {
        MainActivity.resetPendingAnswer()
        Notify.dismissAnsweredCall(context)
    }

    @JavascriptInterface
    fun declinedCall() {
        Notify.stopOutgoingCallTone()
    }

    @JavascriptInterface
    fun declinedCall(peer: String, callId: String) {
        try {
            Notify.stopOutgoingCallTone()
            if (peer.isNotBlank()) {
                Thread {
                    Relay.notify(peer, "call-declined", Relay.storedPeer(context), "Panggilan ditolak", callId)
                }.start()
            }
        } catch (error: Exception) {
            Log.w(TAG, "declinedCall(peer) gagal", error)
        }
    }

    @JavascriptInterface
    fun peerStatus(status: String) {
        try {
            val answer = MainActivity.peerStatus(status) ?: return
            // Kirim segera agar pemanggil (termasuk Windows app) tidak menunggu;
            // retry dikirim ulang untuk kasus bangun dari tidur.
            Thread {
                MainActivity.sendCallAccepted(context, answer.first, answer.second)
                try { Thread.sleep(1200) } catch (_: Exception) {}
                MainActivity.sendCallAccepted(context, answer.first, answer.second)
            }.start()
        } catch (error: Exception) {
            Log.w(TAG, "peerStatus gagal", error)
        }
    }

    @JavascriptInterface
    fun hasPendingAnswer(): Boolean = MainActivity.pendingAnswer

    @JavascriptInterface
    fun getPendingAnswerPeer(): String = MainActivity.getPendingAnswerPeer()

    @JavascriptInterface
    fun getPendingAnswerCallId(): String = MainActivity.getPendingAnswerCallId()

    @JavascriptInterface
    fun openExternal(url: String) {
        try {
            val intent = android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse(url),
            ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (error: Exception) {
            Log.w(TAG, "openExternal gagal: $url", error)
        }
    }

    @JavascriptInterface
    fun postJson(url: String, body: String): String {
        return try {
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..399) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            conn.disconnect()
            text
        } catch (error: Exception) {
            ""
        }
    }

    @JavascriptInterface
    fun takeDeclinedCall(): String = Relay.takeDeclinedCall(context)

    /**
     * Tarik target deep-link notifikasi (peer chat yang harus dibuka) lalu
     * kosongkan. injected.js mempoll tiap 500 ms — model pull tidak bisa
     * hilang seperti event suntikan satu kali yang bisa tiba sebelum
     * listener halaman terdaftar (atau ke WebView yang sedang dimuat ulang).
     */
    @JavascriptInterface
    fun takeOpenPeer(): String {
        return try {
            MainActivity.takeOpenPeer()
        } catch (error: Exception) {
            ""
        }
    }

    @JavascriptInterface
    fun registerPeer(peerId: String) {
        try {
            Relay.savePeer(context, peerId)
        } catch (error: Exception) {
            Log.w(TAG, "registerPeer gagal", error)
        }
    }

    @JavascriptInterface
    fun setSpeakerphone(enabled: Boolean) {
        try {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
            am.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val devices = am.availableCommunicationDevices
                val target = devices.firstOrNull {
                    it.type == if (enabled) android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    else android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                }
                if (target != null) {
                    if (enabled) am.setCommunicationDevice(target) else am.clearCommunicationDevice()
                } else {
                    @Suppress("DEPRECATION")
                    am.isSpeakerphoneOn = enabled
                }
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = enabled
            }
        } catch (error: Exception) {
            Log.w(TAG, "setSpeakerphone gagal", error)
        }
    }

    @JavascriptInterface
    fun setSpeaker(enabled: Boolean) { setSpeakerphone(enabled) }

    @JavascriptInterface
    fun log(message: String) {
        Log.d(TAG, message)
    }

    /** Start a local ZIP export stream from the Settings panel. */
    @Synchronized
    @JavascriptInterface
    fun beginChatExport(fileName: String): Boolean {
        return try {
            abortChatExportLocked()
            val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
                .ifBlank { "RiaCast-chat.zip" }
            val temp = File(context.cacheDir, "chat-export-$safeName.tmp")
            chatExportTemp = temp
            chatExportStream = FileOutputStream(temp, false)
            true
        } catch (error: Exception) {
            Log.w(TAG, "beginChatExport gagal", error)
            false
        }
    }

    @Synchronized
    @JavascriptInterface
    fun appendChatExportChunk(base64: String): Boolean {
        return try {
            val stream = chatExportStream ?: return false
            stream.write(Base64.decode(base64, Base64.DEFAULT))
            true
        } catch (error: Exception) {
            Log.w(TAG, "appendChatExportChunk gagal", error)
            false
        }
    }

    @Synchronized
    @JavascriptInterface
    fun finishChatExport(): String {
        val temp = chatExportTemp ?: return "error:no_export"
        return try {
            chatExportStream?.flush()
            chatExportStream?.close()
            chatExportStream = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, temp.name.removePrefix("chat-export-").removeSuffix(".tmp"))
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("Tidak dapat membuat file di Download")
                context.contentResolver.openOutputStream(uri, "w")?.use { output ->
                    temp.inputStream().use { input -> input.copyTo(output) }
                } ?: throw IllegalStateException("Tidak dapat menulis file di Download")
                context.contentResolver.update(uri, ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }, null, null)
                "ok:Downloads"
            } else {
                val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: throw IllegalStateException("Folder unduhan aplikasi tidak tersedia")
                if (!directory.exists() && !directory.mkdirs())
                    throw IllegalStateException("Folder unduhan aplikasi gagal dibuat")
                val name = temp.name.removePrefix("chat-export-").removeSuffix(".tmp")
                val target = File(directory, name)
                temp.copyTo(target, overwrite = true)
                "ok:${target.absolutePath}"
            }
        } catch (error: Exception) {
            Log.w(TAG, "finishChatExport gagal", error)
            "error:${error.message ?: "write_failed"}"
        } finally {
            temp.delete()
            chatExportTemp = null
            chatExportStream = null
        }
    }

    @Synchronized
    @JavascriptInterface
    fun cancelChatExport() {
        abortChatExportLocked()
    }

    private fun abortChatExportLocked() {
        runCatching { chatExportStream?.close() }
        chatExportStream = null
        chatExportTemp?.delete()
        chatExportTemp = null
    }
    @JavascriptInterface
    fun cacheProfilePhoto(peerId: String?, dataUrl: String?) {
        try {
            Notify.cachePeerAvatar(context, peerId ?: "", dataUrl)
        } catch (error: Exception) {
            Log.w(TAG, "cacheProfilePhoto gagal", error)
        }
    }
}
