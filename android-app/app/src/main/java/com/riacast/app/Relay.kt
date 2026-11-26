package com.riacast.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Klien relai push. Berbicara dengan deployment "push" Apps Script
 * (action push-register / push-notify, lihat
 * integrations/google-apps-script/Push.gs + id.txt baris "push"),
 * terpisah dari endpoint API utama versi web.
 *
 * Semua metode jaringan sinkron — panggil dari thread bukan UI
 * (thread bridge Javascript, thread FCM, atau Thread {}).
 */
object Relay {
    const val ENDPOINT =
        "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec"

    private const val PREFS = "riacast_apk"
    private const val TAG = "RiaCastRelay"
    private const val KEY_PEER = "peerId"
    private const val KEY_TOKEN = "fcmToken"

    private const val KEY_DECLINED = "pending_declined_call"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun storedPeer(context: Context): String = prefs(context).getString(KEY_PEER, "") ?: ""

    fun saveDeclinedCall(context: Context, peer: String, callLogId: String, video: Boolean) {
        prefs(context).edit().putString(KEY_DECLINED, JSONObject().apply {
            put("peer", peer); put("callLogId", callLogId); put("video", video)
        }.toString()).apply()
    }

    fun takeDeclinedCall(context: Context): String {
        val value = prefs(context).getString(KEY_DECLINED, "") ?: ""
        prefs(context).edit().remove(KEY_DECLINED).apply()
        return value
    }

    fun savePeer(context: Context, peerId: String) {
        if (peerId.isBlank()) return
        val old = storedPeer(context)
        prefs(context).edit().putString(KEY_PEER, peerId).apply()
        // Peer berganti → daftarkan ulang token ke relai.
        val token = prefs(context).getString(KEY_TOKEN, "") ?: ""
        if (old != peerId && token.isNotEmpty()) {
            Thread { register(context, peerId, token) }.start()
        }
    }

    fun saveToken(context: Context, token: String) {
        if (token.isBlank()) return
        prefs(context).edit().putString(KEY_TOKEN, token).apply()
        val peer = storedPeer(context)
        if (peer.isNotEmpty()) Thread { register(context, peer, token) }.start()
    }

    fun register(context: Context, peerId: String, token: String) {
        // Register harus tahan banting: kegagalan jaringan sesaat (DNS, sinyal)
        // jangan sampai meninggalkan APK tanpa token terdaftar — tanpa itu
        // push panggilan tidak pernah sampai saat APK tidur.
        var res = ""
        for (attempt in 1..3) {
            res = post(
                """{"action":"push-register","peerId":${jsonStr(peerId)},"token":${jsonStr(token)}}""",
            )
            if (res.isNotBlank()) break
            try { Thread.sleep(2000L * attempt) } catch (_: InterruptedException) { break }
        }
        Log.i(TAG, "push-register($peerId): ${if (res.isBlank()) "gagal jaringan (kosong)" else res.take(200)}")
    }

    fun notify(to: String, kind: String, title: String, body: String, callId: String = "") {
        val res = post(
            """{"action":"push-notify","to":${jsonStr(to)},"kind":${jsonStr(kind)},"title":${jsonStr(title)},"body":${jsonStr(body)},"id":${jsonStr(callId)}}""",
        )
        Log.i(TAG, "push-notify($to,$kind): ${if (res.isBlank()) "gagal jaringan (kosong)" else res.take(200)}")
    }

    /** POST JSON; jawaban server (boleh kosong) sebagai String. Aman dari UI thread. */
    fun post(json: String): String {
        return try {
            val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 10000
            conn.readTimeout = 15000
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..399) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            conn.disconnect()
            text
        } catch (error: Exception) {
            ""
        }
    }

    private fun jsonStr(value: String): String =
        buildString {
            append('"')
            for (ch in value) {
                when (ch) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (ch < ' ') append("\\u%04x".format(ch.code)) else append(ch)
                }
            }
            append('"')
        }
}

