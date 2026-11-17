package io.github.contentsview08.obb

import android.app.Application

/**
 * アプリの入口。まるごとバックアップの控え(次の起動で入れ替える DB と SharedPreferences)は、
 * 通知の巡回などの裏の起動で先に SharedPreferences が読まれるより前に当てる必要があるので、ここで最初に当てる
 * (LogDb・Prefs の init でも当てるが、それは画面から開いたときのため)
 */
class ObbApp : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching { io.github.contentsview08.obb.data.FullBackup.applyPending(this) }
    }
}
