package com.orokichi.renkei

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.StatFs
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Telephony
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.util.Base64
import android.util.Size
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap

/** Device-side features exposed to the web app. */
@SuppressLint("StaticFieldLeak")
object Phone {
    lateinit var ctx: Context
    private val main = Handler(Looper.getMainLooper())

    fun init(c: Context) {
        ctx = c.applicationContext
        KeepAliveService.channels(ctx)
    }

    fun has(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    /* ------------------------------------------------------------ info */

    fun info(): JSONObject {
        val bm = ctx.getSystemService(BatteryManager::class.java)
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val net = when {
            caps == null -> "オフライン"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "モバイル"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "有線"
            else -> "その他"
        }
        val st = StatFs(Environment.getDataDirectory().path)
        val o = JSONObject()
            .put("model", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".replace("Google Pixel", "Pixel").let { if (it.startsWith("Google ")) it.removePrefix("Google ") else it })
            .put("android", Build.VERSION.RELEASE)
            .put("battery", level)
            .put("charging", charging)
            .put("network", net)
            .put("storageFree", st.availableBytes)
            .put("storageTotal", st.totalBytes)
        if (Build.VERSION.SDK_INT >= 31) {
            val c = ctx.resources.getColor(android.R.color.system_accent1_500, ctx.theme)
            o.put("accent", String.format("#%06X", 0xFFFFFF and c))
        }
        return o
    }

    /* ------------------------------------------------------- clipboard */

    fun getClipboard(): String {
        val cm = ctx.getSystemService(android.content.ClipboardManager::class.java)
        return runCatching { cm.primaryClip?.getItemAt(0)?.coerceToText(ctx)?.toString() }.getOrNull() ?: ""
    }

    fun setClipboard(text: String) {
        main.post {
            val cm = ctx.getSystemService(android.content.ClipboardManager::class.java)
            cm.setPrimaryClip(android.content.ClipData.newPlainText("スマートフォン連携", text))
        }
    }

    /* ----------------------------------------------------------- files */

    data class Src(val uri: Uri, val name: String, val size: Long, val mime: String) {
        var stream: InputStream? = null
        var pos: Long = 0
    }

    private val sources = ConcurrentHashMap<String, Src>()
    private var fidSeq = 0

    fun register(uri: Uri): JSONObject {
        var name = "file"; var size = -1L
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        }
        if (size < 0) size = runCatching { ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull() ?: 0L
        val mime = ctx.contentResolver.getType(uri)
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        val fid = "f${++fidSeq}_${System.nanoTime()}"
        sources[fid] = Src(uri, name, size, mime)
        return JSONObject().put("fid", fid).put("name", name).put("size", size).put("mime", mime)
    }

    @Synchronized
    fun readChunk(fid: String, offset: Long, len: Int): String {
        val s = sources[fid] ?: return ""
        if (s.stream == null || s.pos != offset) {
            runCatching { s.stream?.close() }
            s.stream = ctx.contentResolver.openInputStream(s.uri)
            var skip = offset
            while (skip > 0) { val k = s.stream!!.skip(skip); if (k <= 0) break; skip -= k }
            s.pos = offset - skip
        }
        val buf = ByteArray(len)
        var read = 0
        while (read < len) {
            val r = s.stream!!.read(buf, read, len - read)
            if (r < 0) break
            read += r
        }
        s.pos += read
        if (s.pos >= s.size || read < len) { runCatching { s.stream?.close() }; s.stream = null; if (s.pos >= s.size) sources.remove(fid) }
        return Base64.encodeToString(buf, 0, read, Base64.NO_WRAP)
    }

    private class Sink(val uri: Uri, val out: OutputStream, val name: String, val mime: String)
    private val sinks = ConcurrentHashMap<String, Sink>()
    private val saved = ConcurrentHashMap<String, Pair<Uri, String>>()

    fun saveStart(id: String, name: String, mime: String) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/スマートフォン連携")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return
        val out = ctx.contentResolver.openOutputStream(uri) ?: return
        sinks[id] = Sink(uri, out.buffered(256 * 1024), name, mime)
    }

    fun saveChunk(id: String, b64: String) {
        sinks[id]?.out?.write(Base64.decode(b64, Base64.DEFAULT))
    }

    fun saveEnd(id: String): String {
        val s = sinks.remove(id) ?: return ""
        runCatching { s.out.flush(); s.out.close() }
        ctx.contentResolver.update(s.uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        saved[id] = s.uri to s.mime
        return s.uri.toString()
    }

    fun openSaved(id: String) {
        val (uri, mime) = saved[id] ?: return
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(Intent.createChooser(i, "開く").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /* ---------------------------------------------------------- contacts */

    private val nameCache = ConcurrentHashMap<String, String>()
    fun contactName(number: String?): String? {
        if (number.isNullOrBlank() || !has(Manifest.permission.READ_CONTACTS)) return null
        nameCache[number]?.let { return it.ifEmpty { null } }
        val n = runCatching {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull()
        nameCache[number] = n ?: ""
        return n
    }

    /* --------------------------------------------------------------- SMS */

    fun smsThreads(): String {
        if (!has(Manifest.permission.READ_SMS)) throw SecurityException("SMSの権限がありません")
        val seen = LinkedHashMap<Long, JSONObject>()
        ctx.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.THREAD_ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.READ),
            null, null, "${Telephony.Sms.DATE} DESC LIMIT 1500"
        )?.use { c ->
            while (c.moveToNext() && seen.size < 80) {
                val tid = c.getLong(0)
                if (seen.containsKey(tid)) continue
                val addr = c.getString(1) ?: continue
                seen[tid] = JSONObject().put("address", addr).put("name", contactName(addr) ?: JSONObject.NULL)
                    .put("snippet", c.getString(2) ?: "").put("date", c.getLong(3)).put("read", c.getInt(4) == 1)
            }
        }
        return JSONArray(seen.values).toString()
    }

    fun smsMessages(address: String): String {
        if (!has(Manifest.permission.READ_SMS)) throw SecurityException("SMSの権限がありません")
        var tid: Long? = null
        ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms.THREAD_ID), "${Telephony.Sms.ADDRESS} = ?", arrayOf(address), "${Telephony.Sms.DATE} DESC LIMIT 1")
            ?.use { if (it.moveToFirst()) tid = it.getLong(0) }
        val arr = ArrayList<JSONObject>()
        val sel = if (tid != null) "${Telephony.Sms.THREAD_ID} = ?" else "${Telephony.Sms.ADDRESS} = ?"
        val args = arrayOf(tid?.toString() ?: address)
        ctx.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms._ID, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE),
            sel, args, "${Telephony.Sms.DATE} DESC LIMIT 300"
        )?.use { c ->
            while (c.moveToNext()) arr += JSONObject().put("id", c.getString(0)).put("body", c.getString(1) ?: "").put("date", c.getLong(2)).put("type", c.getInt(3))
        }
        arr.reverse()
        return JSONArray(arr).toString()
    }

    fun sendSms(address: String, text: String): JSONObject {
        if (!has(Manifest.permission.SEND_SMS)) return JSONObject().put("ok", false).put("error", "SMS送信の権限がありません")
        return runCatching {
            val sm = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            val parts = sm.divideMessage(text)
            if (parts.size > 1) sm.sendMultipartTextMessage(address, null, parts, null, null)
            else sm.sendTextMessage(address, null, text, null, null)
            JSONObject().put("ok", true)
        }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "送信に失敗しました") }
    }

    private var smsObserver: ContentObserver? = null
    private var lastSmsId = -1L
    fun watchSms() {
        if (smsObserver != null || !has(Manifest.permission.READ_SMS)) return
        lastSmsId = latestInbox()?.first ?: -1L
        smsObserver = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean) {
                val l = latestInbox() ?: return
                if (l.first > lastSmsId) { lastSmsId = l.first; Hub.emit("sms", l.second) }
            }
        }
        ctx.contentResolver.registerContentObserver(Uri.parse("content://sms"), true, smsObserver!!)
    }

    private fun latestInbox(): Pair<Long, JSONObject>? = runCatching {
        ctx.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            null, null, "${Telephony.Sms.DATE} DESC LIMIT 1"
        )?.use { c ->
            if (!c.moveToFirst()) null else {
                val addr = c.getString(1) ?: ""
                c.getLong(0) to JSONObject().put("address", addr).put("name", contactName(addr) ?: JSONObject.NULL)
                    .put("body", c.getString(2) ?: "").put("date", c.getLong(3))
            }
        }
    }.getOrNull()

    /* ------------------------------------------------------------- calls */

    fun callLog(): String {
        if (!has(Manifest.permission.READ_CALL_LOG)) throw SecurityException("通話履歴の権限がありません")
        val arr = JSONArray()
        ctx.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE),
            null, null, "${CallLog.Calls.DATE} DESC LIMIT 100"
        )?.use { c ->
            while (c.moveToNext()) {
                val num = c.getString(0) ?: ""
                arr.put(JSONObject().put("number", num).put("name", c.getString(1) ?: contactName(num) ?: JSONObject.NULL)
                    .put("date", c.getLong(2)).put("duration", c.getLong(3)).put("type", c.getInt(4)))
            }
        }
        return arr.toString()
    }

    @SuppressLint("MissingPermission")
    fun dial(number: String): JSONObject {
        if (!has(Manifest.permission.CALL_PHONE)) return JSONObject().put("ok", false).put("error", "発信の権限がありません")
        return runCatching {
            val tm = ctx.getSystemService(TelecomManager::class.java)
            tm.placeCall(Uri.fromParts("tel", number, null), null)
            JSONObject().put("ok", true)
        }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "発信できませんでした") }
    }

    /* ------------------------------------------------------------ photos */

    private fun photoPermission() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE

    fun photos(limit: Int): String {
        if (!has(photoPermission())) throw SecurityException("写真の権限がありません")
        val arr = JSONArray()
        val proj = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.SIZE)
        val args = android.os.Bundle().apply {
            putStringArray(android.content.ContentResolver.QUERY_ARG_SORT_COLUMNS, arrayOf(MediaStore.Images.Media.DATE_ADDED))
            putInt(android.content.ContentResolver.QUERY_ARG_SORT_DIRECTION, android.content.ContentResolver.QUERY_SORT_DIRECTION_DESCENDING)
            putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, limit.coerceIn(1, 500))
        }
        ctx.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj, args, null)?.use { c ->
            while (c.moveToNext()) {
                val taken = c.getLong(2).takeIf { it > 0 } ?: (c.getLong(3) * 1000)
                arr.put(JSONObject().put("id", c.getString(0)).put("name", c.getString(1) ?: "photo.jpg").put("date", taken).put("size", c.getLong(4)))
            }
        }
        return arr.toString()
    }

    fun thumb(id: String): String = runCatching {
        val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toLong())
        val bmp = ctx.contentResolver.loadThumbnail(uri, Size(320, 320), null)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 78, out)
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }.getOrDefault("")

    fun openMedia(id: String): String = runCatching {
        register(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toLong())).toString()
    }.getOrDefault("null")

    /* --------------------------------------------------- ring / vibrate */

    private var player: MediaPlayer? = null
    private var prevVolume = -1
    private val stopRing = Runnable { ring(false) }

    fun ring(on: Boolean) = main.post {
        val am = ctx.getSystemService(AudioManager::class.java)
        if (on) {
            if (player != null) return@post
            prevVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
            runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = runCatching {
                MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    setDataSource(ctx, uri)
                    isLooping = true
                    prepare(); start()
                }
            }.getOrNull()
            vibrate(longArrayOf(0, 600, 300, 600, 300, 600), 0)
            main.postDelayed(stopRing, 45_000)
        } else {
            main.removeCallbacks(stopRing)
            runCatching { player?.stop(); player?.release() }
            player = null
            if (prevVolume >= 0) runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, prevVolume, 0) }
            prevVolume = -1
            ctx.getSystemService(Vibrator::class.java)?.cancel()
        }
    }

    fun vibrate(pattern: LongArray, repeat: Int = -1) {
        ctx.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(pattern, repeat))
    }

    /* ------------------------------------------------------------- links */

    fun openUrl(url: String) {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Hub.activityResumed) { runCatching { ctx.startActivity(i) }; return }
        // App is in background: show a heads-up notification instead (background starts are blocked).
        val pi = PendingIntent.getActivity(ctx, url.hashCode(), i, PendingIntent.FLAG_IMMUTABLE)
        val n = android.app.Notification.Builder(ctx, KeepAliveService.CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("PCからリンクが届きました")
            .setContentText(url)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        runCatching { ctx.getSystemService(NotificationManager::class.java).notify(url.hashCode(), n) }
    }

    /* ------------------------------------------------------- permissions */

    fun permissions(): JSONObject {
        val pm = ctx.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("notificationListener", NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName))
            .put("sms", has(Manifest.permission.READ_SMS) && has(Manifest.permission.SEND_SMS))
            .put("contacts", has(Manifest.permission.READ_CONTACTS))
            .put("callLog", has(Manifest.permission.READ_CALL_LOG) && has(Manifest.permission.CALL_PHONE))
            .put("photos", has(photoPermission()))
            .put("postNotifications", Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS))
            .put("battery", pm.isIgnoringBatteryOptimizations(ctx.packageName))
    }

    fun runtimeFor(key: String): Array<String> = when (key) {
        "sms" -> arrayOf(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS)
        "contacts" -> arrayOf(Manifest.permission.READ_CONTACTS)
        "callLog" -> arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE)
        "photos" -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO) else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        "postNotifications" -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
        else -> emptyArray()
    }
}
