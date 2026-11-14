package com.orokichi.renkei

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/** window.Android — called from the web app on a background thread. */
class Bridge(private val activity: MainActivity) {

    private inline fun safe(block: () -> String): String =
        try { block() } catch (e: Exception) { JSONObject().put("error", e.message ?: e.toString()).toString() }

    @JavascriptInterface fun getInfo(): String = safe { Phone.info().toString() }
    @JavascriptInterface fun getClipboard(): String = Phone.getClipboard()
    @JavascriptInterface fun setClipboard(text: String) = Phone.setClipboard(text)

    @JavascriptInterface fun saveFileStart(id: String, name: String, mime: String) { runCatching { Phone.saveStart(id, name, mime) } }
    @JavascriptInterface fun saveFileChunk(id: String, b64: String) { runCatching { Phone.saveChunk(id, b64) } }
    @JavascriptInterface fun saveFileEnd(id: String): String = runCatching { Phone.saveEnd(id) }.getOrDefault("")
    @JavascriptInterface fun openSaved(id: String) = Phone.openSaved(id)

    @JavascriptInterface fun pickFiles() = activity.runOnUiThread { activity.pickFiles() }
    @JavascriptInterface fun readChunk(fid: String, offset: Double, len: Int): String = try { Phone.readChunk(fid, offset.toLong(), len) } catch (e: Exception) { "" }

    @JavascriptInterface fun getNotifications(): String = NotifService.instance?.listJson() ?: "[]"
    @JavascriptInterface fun dismissNotification(key: String) { runCatching { NotifService.instance?.cancelNotification(key) } }

    @JavascriptInterface fun smsThreads(): String = safe { Phone.smsThreads().also { Phone.watchSms() } }
    @JavascriptInterface fun smsMessages(address: String): String = safe { Phone.smsMessages(address) }
    @JavascriptInterface fun sendSms(address: String, text: String): String = Phone.sendSms(address, text).toString()
    @JavascriptInterface fun callLog(): String = safe { Phone.callLog() }
    @JavascriptInterface fun dial(number: String): String = Phone.dial(number).toString()

    @JavascriptInterface fun photos(limit: Int): String = safe { Phone.photos(limit) }
    @JavascriptInterface fun thumb(id: String): String = Phone.thumb(id)
    @JavascriptInterface fun openMedia(id: String): String = Phone.openMedia(id)

    @JavascriptInterface fun ring(on: Boolean) { Phone.ring(on) }
    @JavascriptInterface fun openUrl(url: String) = Phone.openUrl(url)
    @JavascriptInterface fun vibrate(ms: Int) = Phone.vibrate(longArrayOf(0, ms.toLong()))
    @JavascriptInterface fun share(text: String) = activity.runOnUiThread { activity.shareText(text) }

    @JavascriptInterface fun permissions(): String = Phone.permissions().toString()
    @JavascriptInterface fun requestPermission(name: String) = activity.runOnUiThread { activity.requestPerm(name) }

    @JavascriptInterface fun keepAlive(on: Boolean, label: String) {
        if (on) KeepAliveService.start(activity.applicationContext, label) else KeepAliveService.stop(activity.applicationContext)
        if (on) Phone.watchSms()
    }

    @JavascriptInterface fun scanQr() = activity.runOnUiThread { activity.scanQr() }
}

