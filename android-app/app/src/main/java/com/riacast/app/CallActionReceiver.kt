package com.riacast.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Aksi tombol Tolak/Jawab pada notifikasi panggilan. */
class CallActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_DECLINE = "com.riacast.app.DECLINE_CALL"
        const val ACTION_ANSWER = "com.riacast.app.ANSWER_CALL"
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_DECLINE -> handleDecline(context, intent)
            ACTION_ANSWER -> handleAnswer(context, intent)
        }
    }

    private fun handleDecline(context: Context, intent: Intent) {
        Notify.cancelIncomingCall(context)
        val peer = intent.getStringExtra(Notify.EXTRA_OPEN_PEER).orEmpty()
        val callId = intent.getStringExtra(Notify.EXTRA_CALL_ID).orEmpty()
        Relay.saveDeclinedCall(
            context,
            peer,
            callId,
            intent.getBooleanExtra(Notify.EXTRA_CALL_VIDEO, false),
        )
        if (peer.isNotBlank()) {
            val result = goAsync()
            Thread {
                try {
                    Relay.notify(peer, "call-declined", Relay.storedPeer(context), "Panggilan ditolak", callId)
                } finally {
                    result.finish()
                }
            }.start()
        }
    }

    private fun handleAnswer(context: Context, intent: Intent) {
        Notify.dismissAnsweredCall(context)
        // Buka MainActivity; MainActivity.handleCallIntent akan memproses auto-answer.
        val launch = Intent(context, MainActivity::class.java).apply {
            putExtra(Notify.EXTRA_CALL_ACTION, "answer")
            intent.getStringExtra(Notify.EXTRA_OPEN_PEER)?.let { putExtra(Notify.EXTRA_OPEN_PEER, it) }
            putExtra(Notify.EXTRA_CALL_VIDEO, intent.getBooleanExtra(Notify.EXTRA_CALL_VIDEO, false))
            intent.getStringExtra(Notify.EXTRA_CALL_ID)?.let { putExtra(Notify.EXTRA_CALL_ID, it) }
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        try {
            context.startActivity(launch)
        } catch (_: Exception) {
            // fallback: coba lagi tanpa flags ekstra yang mungkin bermasalah
            try {
                launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                context.startActivity(launch)
            } catch (_: Exception) {}
        }
    }
}
