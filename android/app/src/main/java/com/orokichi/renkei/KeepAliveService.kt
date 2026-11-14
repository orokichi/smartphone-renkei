package com.orokichi.renkei

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat

class KeepAliveService : Service() {
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra("label") ?: "PCと接続中"
        val n = notification(this, label)
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, n)
        if (wake == null) {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "renkei:link").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        runCatching { wake?.release() }
        wake = null
        super.onDestroy()
    }

    companion object {
        private const val ID = 7
        const val CH = "link"
        const val CH_ALERT = "alert"

        fun channels(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH, "接続状態", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
            nm.createNotificationChannel(NotificationChannel(CH_ALERT, "PCからの通知", NotificationManager.IMPORTANCE_HIGH))
        }

        fun notification(ctx: Context, label: String): Notification {
            channels(ctx)
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            return Notification.Builder(ctx, CH)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("スマートフォン連携")
                .setContentText(label)
                .setContentIntent(open)
                .setOngoing(true)
                .build()
        }

        fun start(ctx: Context, label: String) {
            runCatching { ContextCompat.startForegroundService(ctx, Intent(ctx, KeepAliveService::class.java).putExtra("label", label)) }
        }

        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, KeepAliveService::class.java)) }
    }
}
