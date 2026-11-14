package com.orokichi.renkei

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pendingShare: JSONObject? = null
    private var pageReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val picker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            val arr = JSONArray()
            uris.forEach { arr.put(Phone.register(it)) }
            Hub.emit("files", arr.toString())
        }
    }

    private val webPicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray()); fileCallback = null
    }

    private val perms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        Hub.emit("permissions", Phone.permissions())
        Phone.watchSms()
    }

    private val scanner = registerForActivityResult(ScanContract()) { r ->
        r.contents?.let { Hub.emit("qr", it) }
    }

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener { Hub.emit("clipboard", "{}") }

    private val battery = object : BroadcastReceiver() {
        private var last = -1
        override fun onReceive(c: Context, i: Intent) {
            val lvl = i.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1)
            if (lvl != last) { last = lvl; Hub.emit("battery", "{}") }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(0)
        setContentView(web)
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            userAgentString = "$userAgentString SmartphoneRenkei/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(this), "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == Uri.parse(BuildConfig.WEB_URL).host) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pendingShare?.let { s -> view.postDelayed({ Hub.emit("shared", s) }, 2500); pendingShare = null }
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) {
                    view.loadDataWithBaseURL(
                        null,
                        """<html><body style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;gap:16px;color:#888">
                        <div style="font-size:48px">📶</div><div>接続できません。ネットワークを確認してください。</div>
                        <button onclick="location.href='${BuildConfig.WEB_URL}/?native=1'" style="padding:14px 28px;border-radius:99px;border:0;background:#1b6b4f;color:#fff;font-size:16px">再読み込み</button></body></html>""",
                        "text/html", "utf-8", null
                    )
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                webPicker.launch(arrayOf("*/*")); return true
            }
        }
        Hub.attach(web)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })

        getSystemService(ClipboardManager::class.java).addPrimaryClipChangedListener(clipListener)
        ContextCompat.registerReceiver(this, battery, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)

        val start = handleIntent(intent)
        web.loadUrl(start ?: "${BuildConfig.WEB_URL}/?native=1")
    }

    /** Returns a URL to load for VIEW intents; queues share payloads for the web app. */
    private fun handleIntent(i: Intent?): String? {
        i ?: return null
        when (i.action) {
            Intent.ACTION_VIEW -> {
                val u = i.data ?: return null
                val pair = u.getQueryParameter("pair") ?: return null
                return "${BuildConfig.WEB_URL}/?native=1&pair=$pair"
            }
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
                val o = JSONObject()
                i.getStringExtra(Intent.EXTRA_TEXT)?.let { o.put("text", it) }
                val uris = ArrayList<Uri>()
                if (i.action == Intent.ACTION_SEND) IntentCompat.getParcelableExtra(i, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris += it }
                else IntentCompat.getParcelableArrayListExtra(i, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris += it }
                if (uris.isNotEmpty()) o.put("files", JSONArray().apply { uris.forEach { put(Phone.register(it)) } })
                if (pageReady) Hub.emit("shared", o) else pendingShare = o
            }
        }
        return null
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)?.let { web.loadUrl(it) }
    }

    override fun onResume() {
        super.onResume()
        Hub.activityResumed = true
        // Clipboard can only be read while focused; give the window a moment.
        web.postDelayed({ Hub.emit("resume", "{}") }, 400)
    }

    override fun onPause() {
        Hub.activityResumed = false
        super.onPause()
        // Intentionally not pausing the WebView so the link keeps running in the background.
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) Hub.emit("clipboard", "{}")
    }

    override fun onDestroy() {
        runCatching { getSystemService(ClipboardManager::class.java).removePrimaryClipChangedListener(clipListener) }
        runCatching { unregisterReceiver(battery) }
        Hub.detach(web)
        KeepAliveService.stop(this)
        web.destroy()
        super.onDestroy()
    }

    /* ---- called from Bridge on the UI thread ---- */

    fun pickFiles() = picker.launch(arrayOf("*/*"))

    fun scanQr() {
        scanner.launch(ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("PCに表示されたQRコードを読み取ってください")
            setBeepEnabled(false)
            setOrientationLocked(false)
        })
    }

    fun shareText(text: String) {
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))
    }

    @SuppressLint("BatteryLife")
    fun requestPerm(key: String) {
        when (key) {
            "notificationListener" -> startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            "battery" -> runCatching {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            }
            else -> {
                val p = Phone.runtimeFor(key)
                if (p.isEmpty()) return
                val sp = getSharedPreferences("perm", MODE_PRIVATE)
                val askedBefore = sp.getBoolean(key, false)
                val blocked = askedBefore && p.any { !Phone.has(it) && !shouldShowRequestPermissionRationale(it) }
                sp.edit().putBoolean(key, true).apply()
                if (blocked) openAppSettings() else perms.launch(p)
            }
        }
    }

    private fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
