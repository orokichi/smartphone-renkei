package com.orokichi.renkei

import android.app.Notification
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import androidx.core.graphics.drawable.toBitmap
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class NotifService : NotificationListenerService() {

    override fun onListenerConnected() { instance = this }
    override fun onListenerDisconnected() { if (instance === this) instance = null }
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!relevant(sbn)) return
        Hub.emit("notification", toJson(sbn))
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        Hub.emit("notificationRemoved", JSONObject().put("key", sbn.key))
    }

    private fun relevant(sbn: StatusBarNotification): Boolean {
        if (sbn.packageName == packageName) return false
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return false
        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)
        val text = ex.getCharSequence(Notification.EXTRA_TEXT)
        return !(title.isNullOrBlank() && text.isNullOrBlank())
    }

    private fun toJson(sbn: StatusBarNotification): JSONObject {
        val n = sbn.notification
        val ex = n.extras
        val big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
        return JSONObject()
            .put("key", sbn.key)
            .put("pkg", sbn.packageName)
            .put("app", label(sbn.packageName))
            .put("title", ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "")
            .put("text", (big ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: "")
            .put("time", sbn.postTime)
            .put("ongoing", sbn.isOngoing)
            .put("icon", icon(sbn.packageName))
            .put("actions", JSONArray().apply { n.actions?.forEach { put(it.title?.toString() ?: "") } })
    }

    private fun label(pkg: String): String = labels.getOrPut(pkg) {
        try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }
        catch (e: PackageManager.NameNotFoundException) { pkg }
    }

    private fun icon(pkg: String): String = icons.getOrPut(pkg) {
        runCatching {
            val bmp = packageManager.getApplicationIcon(pkg).toBitmap(72, 72, Bitmap.Config.ARGB_8888)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
            "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }.getOrDefault("")
    }

    fun listJson(): String {
        val arr = JSONArray()
        runCatching { activeNotifications }.getOrNull()?.filter { relevant(it) }?.sortedByDescending { it.postTime }?.take(100)
            ?.forEach { arr.put(toJson(it)) }
        return arr.toString()
    }

    companion object {
        @Volatile var instance: NotifService? = null
        private val labels = HashMap<String, String>()
        private val icons = HashMap<String, String>()
    }
}
