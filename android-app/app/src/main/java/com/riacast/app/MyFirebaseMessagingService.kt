package com.riacast.app

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Menerima FCM untuk membangunkan aplikasi dan menampilkan panggilan masuk.
 */
class MyFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "RiaCastFcm"

        /** Dipanggil dari MainActivity bila Firebase sudah terkonfigurasi. */
        fun fetchToken(context: android.content.Context) {
            try {
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { token ->
                        if (!token.isNullOrBlank()) Relay.saveToken(context, token)
                    }
                    .addOnFailureListener { error ->
                        Log.w(TAG, "token gagal", error)
                    }
            } catch (error: Exception) {
                // FirebaseApp belum diinisialisasi (google-services.json belum ada).
                Log.d(TAG, "Firebase belum dikonfigurasi: ${error.message}")
            }
        }
    }

    override fun onNewToken(token: String) {
        Relay.saveToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = data["kind"] ?: "message"
        val title = data["title"] ?: "RiaCast"
        val body = data["body"] ?: message.notification?.body ?: ""
        try {
            when (kind) {
                "call" -> {
                    val video = body.contains("video", ignoreCase = true)
                    // Push "call" hanya dikirim ketika pengirim tidak punya
                    // koneksi data P2P siap. Jadi walau APK sedang terlihat,
                    // panel panggilan P2P belum tentu datang; jangan buang
                    // fallback ini. Tap Jawab akan mengirim call-accepted,
                    // lalu panggilan media masuk melalui PeerJS seperti biasa.
                    val peerId = data["sender"] ?: title
                    if (MainActivity.dispatchIncomingCall(
                            applicationContext, peerId, data["id"].orEmpty(), video, title,
                        )
                    ) {
                        // APK terlihat & halaman siap → panel dering in-app
                        // menangani (notifikasi sistem tidak ditampilkan).
                        Log.d(TAG, "push call -> panel in-app (APK terlihat)")
                    } else {
                        Notify.showCallFromPush(this, peerId, title, video, data["id"].orEmpty())
                        Log.d(TAG, if (MainActivity.visible) "fallback call push saat APK aktif" else "fallback call push saat APK tidur")
                    }
                }
                "call-accepted", "call-declined" ->
                    MainActivity.dispatchCallResponse(kind, data["sender"] ?: title, data["id"].orEmpty())
                "call-cancelled", "call-canceled", "call-hangup", "call-ended", "call-missed", "missed" -> {
                    Notify.cancelIncomingCall(applicationContext)
                    MainActivity.dispatchCallResponse("call-cancelled", data["sender"] ?: title, data["id"].orEmpty())
                }
                "media" -> {
                    if (MainActivity.visible) {
                        Log.d(TAG, "push media hanya notifikasi: aplikasi terlihat")
                    } else {
                        val sender = data["sender"] ?: title
                        Notify.show(this, title, body, sender)
                    }
                }
                "message" -> {
                    if (MainActivity.visible) {
                        Log.d(TAG, "push message hanya notifikasi: aplikasi terlihat")
                    } else {
                        // peer pengirim ikut dibawa supaya tap notifikasi
                        // membuka chatroom yang bersangkutan, bukan daftar teman.
                        // Fallback title: payload lama (tanpa meta redeploy)
                        // memakai title = peer pengirim.
                        val sender = data["sender"]
                            ?: title.takeUnless { it == "RiaCast" }
                            ?: ""
                        Notify.show(this, title, body, sender)
                    }
                }
            }
        } catch (error: Exception) {
            Log.w(TAG, "notifikasi push gagal", error)
        }
    }
}
