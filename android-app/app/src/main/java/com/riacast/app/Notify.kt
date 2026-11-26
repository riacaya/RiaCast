package com.riacast.app

import android.content.Context

object Notify {
    const val CH_MESSAGES = "messages_v5"
    const val CH_CALLS = "calls_v5"
    const val ID_MESSAGE = 1002
    const val ID_CALL = 1003
    const val EXTRA_CALL_ACTION = "call_action"
    const val EXTRA_CALL_VIDEO = "call_video"
    const val EXTRA_CALL_ID = "call_id"
    const val EXTRA_OPEN_PEER = "open_peer"

    fun ensureChannels(context: Context) {}
    fun playCallTone(context: Context) {}
    fun stopCallTone() {}
    fun showCallFromPush(context: Context, peerId: String, displayName: String, video: Boolean, callId: String = "") {}
    fun show(context: Context, title: String, body: String, peer: String = "") {}
    fun cachePeerAvatar(context: Context, peerId: String, dataUrl: String?) {}
    fun showIncomingCall(context: Context, peerId: String, displayName: String, video: Boolean, callId: String = "") {}
    fun cancelIncomingCall(context: Context) {}
    fun dismissIncomingCall(context: Context) {}
    fun stopOutgoingCallTone() {}
    fun dismissAnsweredCall(context: Context) {}
}
