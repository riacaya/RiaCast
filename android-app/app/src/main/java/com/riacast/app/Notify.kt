package com.riacast.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.media.RingtoneManager
import android.media.Ringtone
import android.util.Base64
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/** Kanal + notifikasi pesan dan panggilan masuk. */
object Notify {
    // ID channel diganti generasi v3: Android tidak memperbarui nada/getar pada
    // channel yang sudah ada, jadi channel lama dibuang lalu dibuat ulang dengan
    // nada bawaan APK di ensureChannels() agar dering panggilan tetap benar.
    private const val TAG = "RiaCastNotify"
    const val CH_MESSAGES = "messages_v5"
    const val CH_CALLS = "calls_v5"
    private val OLD_CHANNELS = arrayOf("messages", "messages_v2", "messages_v3", "messages_v4", "calls", "calls_v2", "calls_v3", "calls_v4")
    const val ID_MESSAGE = 1002
    const val ID_CALL = 1003

    const val EXTRA_CALL_ACTION = "call_action"
    const val EXTRA_CALL_VIDEO = "call_video"
    const val EXTRA_CALL_ID = "call_id"

    /**
     * Peer yang harus dibuka oleh chatroom saat notifikasi di-tap — tanpa ini
     * notifikasi pesan/panggilan selalu membuka panel daftar teman (home),
     * bukan percakapan yang bersangkutan.
     */
    const val EXTRA_OPEN_PEER = "open_peer"

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Hapus kanal lama agar pengaturan suara/getar dibuat ulang bersih.
        OLD_CHANNELS.forEach { runCatching { manager.deleteNotificationChannel(it) } }

        // Buat kanal dengan nada yang disertakan di APK.
        val messages = NotificationChannel(
            CH_MESSAGES,
            context.getString(R.string.message_channel),
            NotificationManager.IMPORTANCE_HIGH,
        )
        messages.setSound(
            resourceUri(context, R.raw.riacast_notif),
            soundAttrs(AudioAttributes.USAGE_NOTIFICATION),
        )
        messages.enableVibration(true)
        messages.vibrationPattern = longArrayOf(0, 150, 100, 150)
        manager.createNotificationChannel(messages)

        val calls = NotificationChannel(
            CH_CALLS,
            context.getString(R.string.call_channel),
            NotificationManager.IMPORTANCE_HIGH,
        )
        calls.setBypassDnd(false)
        calls.enableVibration(true)
        calls.vibrationPattern = longArrayOf(0, 500, 500, 500, 500, 500)
        calls.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        calls.setSound(
            resourceUri(context, R.raw.riacast_ring),
            soundAttrs(AudioAttributes.USAGE_NOTIFICATION_RINGTONE),
        )
        manager.createNotificationChannel(calls)

        Log.d(TAG, "channel disiapkan: $CH_MESSAGES + $CH_CALLS (nada bawaan APK)")
    }

    private fun resourceUri(context: Context, resId: Int): Uri =
        Uri.parse("android.resource://${context.packageName}/$resId")

    private fun soundAttrs(usage: Int): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    @Volatile private var ringingTone: Ringtone? = null
    @Volatile private var ringingToneTask: Runnable? = null

    /** Nada panggilan berulang sampai panggilan berakhir. */
    fun playCallTone(context: Context) {
        stopCallTone()
        val ringtone = RingtoneManager.getRingtone(context.applicationContext, resourceUri(context, R.raw.riacast_ring))
        ringingTone = ringtone
        val task = object : Runnable {
            override fun run() {
                if (ringingTone !== ringtone) return
                runCatching { ringtone.play() }
                mainHandler.postDelayed(this, 1800L)
            }
        }
        ringingToneTask = task
        mainHandler.post(task)
    }

    fun stopCallTone() {
        ringingToneTask?.let { mainHandler.removeCallbacks(it) }
        ringingToneTask = null
        ringingTone?.let { runCatching { it.stop() } }
        ringingTone = null
    }

    /** Push FCM membuat notifikasi Jawab/Tolak untuk penerima tidur. */
    private val mainHandler = Handler(Looper.getMainLooper())

    fun showCallFromPush(context: Context, peerId: String, displayName: String, video: Boolean, callId: String = "") {
        showIncomingCall(context.applicationContext, peerId, displayName, video, callId)
    }

    @Volatile private var lastKey = ""
    @Volatile private var lastAt = 0L

    fun show(context: Context, title: String, body: String, peer: String = "") {
        // Push FCM & notifikasi lokal P2P bisa tiba hampir bersamaan saat
        // aplikasi di latar belakang — jangan berbunyi dua kali untuk isi sama.
        val key = "$title\u0000$body"
        val now = System.currentTimeMillis()
        if (key == lastKey && now - lastAt < 3000L) return
        lastKey = key
        lastAt = now
        ensureChannels(context)
        val intent = Intent(context, MainActivity::class.java).apply {
            if (peer.isNotBlank()) putExtra(EXTRA_OPEN_PEER, peer)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pending = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title.ifBlank { context.getString(R.string.app_name) })
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        manager(context).notify(ID_MESSAGE + ((System.currentTimeMillis() / 1000).toInt() % 100000), notification)
    }

    /**
     * Cadangan batal notifikasi dering: bila pemanggil menyerah lebih dulu
     * (halamannya mati, sesi timeout tanpa close), notifikasi tidak boleh
     * menempel selamanya di panel.
     */
    @Volatile private var callTimeoutTask: Runnable? = null

    private fun scheduleCallTimeout(context: Context) {
        clearCallTimeout()
        val app = context.applicationContext
        val task = Runnable {
            callTimeoutTask = null
            runCatching { manager(app).cancel(ID_CALL) }
            Log.d(TAG, "notifikasi dering kedaluwarsa tanpa jawaban")
        }
        callTimeoutTask = task
        mainHandler.postDelayed(task, 45_000L)
    }

    private fun clearCallTimeout() {
        callTimeoutTask?.let { mainHandler.removeCallbacks(it) }
        callTimeoutTask = null
    }

    private fun avatarFile(context: Context, peerId: String): File {
        val safe = peerId.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(80).ifBlank { "unknown" }
        return File(File(context.filesDir, "avatars").apply { mkdirs() }, "$safe.png")
    }

    fun cachePeerAvatar(context: Context, peerId: String, dataUrl: String?) {
        if (peerId.isBlank()) return
        val file = avatarFile(context, peerId)
        val raw = dataUrl?.trim().orEmpty()
        if (raw.isBlank()) { runCatching { file.delete() }; return }
        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            Thread {
                try {
                    val conn = java.net.URL(raw).openConnection() as java.net.HttpURLConnection
                    conn.connectTimeout = 5000
                    conn.readTimeout = 7000
                    conn.inputStream.use { input ->
                        val bytes = input.readBytes()
                        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@Thread
                        val size = 256
                        val scaled = Bitmap.createScaledBitmap(bmp, size, size, true)
                        FileOutputStream(file).use { out -> scaled.compress(Bitmap.CompressFormat.PNG, 90, out) }
                        if (scaled !== bmp) scaled.recycle()
                        bmp.recycle()
                    }
                    conn.disconnect()
                } catch (e: Exception) { Log.w(TAG, "cachePeerAvatar url gagal", e) }
            }.start()
            return
        }
        try {
            val base64 = raw.substringAfter("base64,", raw)
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
            val size = 256
            val scaled = Bitmap.createScaledBitmap(bmp, size, size, true)
            FileOutputStream(file).use { out -> scaled.compress(Bitmap.CompressFormat.PNG, 90, out) }
            if (scaled !== bmp) scaled.recycle()
            bmp.recycle()
        } catch (e: Exception) {
            Log.w(TAG, "cachePeerAvatar gagal", e)
        }
    }

    private fun circularBitmap(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = size / 2f
        canvas.drawCircle(r, r, r, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        val left = ((src.width - size) / 2f)
        val top = ((src.height - size) / 2f)
        canvas.drawBitmap(src, -left, -top, paint)
        return out
    }

    private fun initialsAvatar(name: String): Bitmap {
        val size = 256
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val palette = intArrayOf(
            Color.parseColor("#1E88E5"), Color.parseColor("#43A047"), Color.parseColor("#8E24AA"),
            Color.parseColor("#E53935"), Color.parseColor("#FB8C00"), Color.parseColor("#00897B")
        )
        val key = name.ifBlank { "?" }
        val bg = palette[(kotlin.math.abs(key.hashCode()) % palette.size)]
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg }
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, bgPaint)
        val initials = key.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.take(2)
            .map { it.first().uppercaseChar() }.joinToString("").ifBlank { "?" }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textSize = if (initials.length <= 1) 112f else 92f
        }
        val bounds = Rect()
        paint.getTextBounds(initials, 0, initials.length, bounds)
        canvas.drawText(initials, size / 2f, size / 2f - bounds.exactCenterY(), paint)
        return bmp
    }

    private fun peerAvatarIcon(context: Context, peerId: String, displayName: String): Icon {
        val file = avatarFile(context, peerId)
        val bmp = if (file.exists()) {
            runCatching { BitmapFactory.decodeFile(file.absolutePath) }.getOrNull()
        } else null
        val avatar = if (bmp != null) circularBitmap(bmp) else initialsAvatar(displayName)
        if (bmp != null && avatar !== bmp) bmp.recycle()
        return Icon.createWithBitmap(avatar)
    }

    /** Panggilan masuk: notifikasi kategori panggilan + full-screen di atas layar kunci. */
    fun showIncomingCall(context: Context, peerId: String, displayName: String, video: Boolean, callId: String = "") {
        ensureChannels(context)
        val decline = PendingIntent.getBroadcast(
            context, 2,
            Intent(context, CallActionReceiver::class.java)
                .setAction(CallActionReceiver.ACTION_DECLINE)
                .putExtra(EXTRA_OPEN_PEER, peerId)
                .putExtra(EXTRA_CALL_VIDEO, video)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CALL_ACTION, "decline"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val answer = PendingIntent.getActivity(
            context, 4,
            Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_CALL_ACTION, "answer")
                putExtra(EXTRA_OPEN_PEER, peerId)
                putExtra(EXTRA_CALL_VIDEO, video)
                putExtra(EXTRA_CALL_ID, callId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Full-screen intent: saat layar mati/terkunci, sistem membuka app
        // langsung (seperti telepon) sehingga panel dering tampil tanpa perlu
        // mengetuk notifikasi. Aksi "show" TIDAK auto-jawab — pengguna memilih
        // lewat tombol Jawab; tanpa EXTRA_OPEN_PEER agar tidak deep-link chat.
        val show = PendingIntent.getActivity(
            context, 5,
            Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_CALL_ACTION, "show")
                putExtra(EXTRA_CALL_VIDEO, video)
                putExtra(EXTRA_CALL_ID, callId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val label = if (video) "Panggilan video masuk" else "Panggilan suara masuk"
        val callerName = displayName.ifBlank { peerId.ifBlank { "RiaCast" } }
        val avatarIcon = peerAvatarIcon(context, peerId, callerName)
        val builder = Notification.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setLargeIcon(avatarIcon)
            .setContentTitle(callerName)
            .setContentText(label)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(answer)
            .setFullScreenIntent(show, true)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            val person = android.app.Person.Builder().setName(callerName).setImportant(true).setIcon(avatarIcon).build()
            builder.setStyle(Notification.CallStyle.forIncomingCall(person, decline, answer).setIsVideo(video))
        } else {
            builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_riacast_answer), "Jawab", answer).build())
            builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_riacast_decline), "Tolak", decline).build())
        }
        val notification = builder.build()
        scheduleCallTimeout(context)
        manager(context).notify(ID_CALL, notification)
    }

    fun cancelIncomingCall(context: Context) {
        stopCallTone()
        clearCallTimeout()
        MainActivity.resetPendingAnswer()
        manager(context).cancel(ID_CALL)
    }

    fun dismissIncomingCall(context: Context) {
        stopCallTone()
        clearCallTimeout()
        manager(context).cancel(ID_CALL)
    }

    /** Hentikan bunyi lokal pemanggil saat penerima menolak panggilan. */
    fun stopOutgoingCallTone() {
        stopCallTone()
    }

    fun dismissAnsweredCall(context: Context) {
        stopCallTone()
        clearCallTimeout()
        manager(context).cancel(ID_CALL)
    }

    private fun manager(context: Context): NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
}
