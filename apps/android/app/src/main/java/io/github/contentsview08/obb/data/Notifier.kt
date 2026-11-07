package io.github.contentsview08.obb.data

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.github.contentsview08.obb.MainActivity

/** Android の通知を出す。押すと OPEN_URL の URL をアプリの中で開く(MainActivity。ACTION_OPEN_URL のときだけ読む) */
object Notifier {
    const val OPEN_URL = "open_url"
    /** 通知から開く intent の action。MainActivity は exported なので、この action のない intent の extra は読まない */
    const val ACTION_OPEN_URL = "io.github.contentsview08.obb.OPEN_URL"
    private const val CHANNEL = "obb_news"

    fun enabled(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    @SuppressLint("MissingPermission") // 許可は enabled で確かめる(なければ何もしない)
    fun show(context: Context, title: String, body: String?, url: String?) {
        if (!enabled(context)) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "新着の知らせ", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (url != null) intent.setAction(ACTION_OPEN_URL).putExtra(OPEN_URL, url)
        val id = (title + url).hashCode()
        val pending = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(id, n)
    }
}
