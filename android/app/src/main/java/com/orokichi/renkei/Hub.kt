package com.orokichi.renkei

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject
import java.lang.ref.WeakReference

/** Routes native events into the web app: window.__native.emit(name, json). */
object Hub {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var web: WeakReference<WebView>? = null
    @Volatile var activityResumed = false

    fun attach(w: WebView) { web = WeakReference(w) }
    fun detach(w: WebView) { if (web?.get() === w) web = null }
    val attached get() = web?.get() != null

    fun emit(name: String, json: String) {
        main.post {
            val w = web?.get() ?: return@post
            w.evaluateJavascript(
                "window.__native&&window.__native.emit(${JSONObject.quote(name)},${JSONObject.quote(json)})", null
            )
        }
    }

    fun emit(name: String, obj: JSONObject) = emit(name, obj.toString())
}

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Phone.init(this)
    }
}
