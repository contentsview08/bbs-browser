package io.github.contentsview08.obb.data

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * まるごとバックアップ(PC 版の「まるごとバックアップ」と同じ考え方)。
 * スマホ版はログ・既読・お気に入り・書き込み履歴・自分の印・アカウントが DB(obb.db)に、設定と NG が SharedPreferences にあるので、
 * 1 つの ZIP に `obb.db` と `settings.json`(いつものバックアップの設定の部分)を入れる。
 * 戻すときは DB を次の起動の控え(restore-pending.db)に置き、LogDb が作られる前に入れ替える(開いている DB はその場では替えられない)。
 * いまの DB は消さずに `obb.before-restore-時刻.db` として残す
 */
object FullBackup {
    const val DB_NAME = "obb.db"
    private const val PENDING = "restore-pending.db"
    /** 次の起動で入れ替える SharedPreferences の控え(Cookie・設定・読んだ位置など) */
    private const val PENDING_PREFS = "restore-pending-prefs"
    private val SQLITE_HEADER = "SQLite format 3\u0000".toByteArray(Charsets.ISO_8859_1)

    /** SharedPreferences のファイルのあるフォルダ(settings・cookies・post-cookies・positions・crawl …) */
    private fun prefsDir(context: Context) = File(context.dataDir, "shared_prefs")

    /**
     * 次の起動で入れ替える控えがあれば、DB を開く前・設定を読む前に入れ替える(LogDb と Prefs の init から。何度呼んでもよい)。
     * SharedPreferences は読んだあとにファイルを替えても中身が替わらないので、最初に読む前に済ませる
     */
    fun applyPending(context: Context) {
        val pendingPrefs = File(context.filesDir, PENDING_PREFS)
        if (pendingPrefs.isDirectory) {
            val dir = prefsDir(context)
            dir.mkdirs()
            for (f in pendingPrefs.listFiles().orEmpty()) if (f.name.endsWith(".xml")) f.copyTo(File(dir, f.name), overwrite = true)
            pendingPrefs.deleteRecursively()
        }
        val pending = File(context.filesDir, PENDING)
        if (!pending.exists()) return
        val db = context.getDatabasePath(DB_NAME)
        db.parentFile?.mkdirs()
        val stamp = System.currentTimeMillis()
        for (suffix in listOf("", "-journal", "-wal", "-shm")) {
            val f = File(db.path + suffix)
            if (f.exists()) f.renameTo(File(db.parentFile, "obb.before-restore-$stamp.db$suffix"))
        }
        if (!pending.renameTo(db)) {
            pending.copyTo(db, overwrite = true)
            pending.delete()
        }
    }

    /**
     * DB の写し(dbFile)・設定(settings.json。古い版でも読めるように)・SharedPreferences のファイル(shared_prefs の中の .xml。
     * 書き込みの Cookie や認証の状態、読んだ位置もここにある)を 1 つの ZIP に書く
     */
    fun writeZip(context: Context, dbFile: File, settings: JSONObject, out: OutputStream) {
        ZipOutputStream(out.buffered()).use { zip ->
            zip.putNextEntry(ZipEntry(DB_NAME))
            dbFile.inputStream().use { it.copyTo(zip) }
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("settings.json"))
            zip.write(settings.toString(2).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
            for (f in prefsDir(context).listFiles().orEmpty()) {
                if (!f.name.endsWith(".xml")) continue
                zip.putNextEntry(ZipEntry("shared_prefs/${f.name}"))
                f.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }

    /**
     * ZIP を読む。DB は次の起動の控えに置き、設定(settings.json)があれば返す。
     * DB が SQLite でなければ IllegalArgumentException
     */
    fun stageRestore(context: Context, input: InputStream): JSONObject? {
        var settings: JSONObject? = null
        var staged = false
        val pending = File(context.filesDir, PENDING)
        val pendingPrefs = File(context.filesDir, PENDING_PREFS)
        pendingPrefs.deleteRecursively()
        ZipInputStream(input.buffered()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                val name = e.name.substringAfterLast('/')
                // SharedPreferences のファイルは次の起動で shared_prefs/ に写す(今の process が読んだものは替えられない)
                if (e.name.replace('\\', '/').startsWith("shared_prefs/") && name.endsWith(".xml")) {
                    pendingPrefs.mkdirs()
                    File(pendingPrefs, name).outputStream().use { zip.copyTo(it) }
                    continue
                }
                when (name) {
                    DB_NAME -> {
                        val tmp = File(context.cacheDir, "restore-check.db")
                        tmp.outputStream().use { zip.copyTo(it) }
                        val head = tmp.inputStream().use { s -> ByteArray(16).also { s.read(it) } }
                        if (!head.contentEquals(SQLITE_HEADER)) {
                            tmp.delete()
                            throw IllegalArgumentException("obb.db が SQLite のファイルではありません")
                        }
                        if (!tmp.renameTo(pending)) {
                            tmp.copyTo(pending, overwrite = true)
                            tmp.delete()
                        }
                        staged = true
                    }
                    "settings.json" -> settings = runCatching { JSONObject(String(zip.readBytes(), Charsets.UTF_8)) }.getOrNull()
                }
            }
        }
        if (!staged) {
            pendingPrefs.deleteRecursively()
            throw IllegalArgumentException("ZIP の中に obb.db がありません(まるごとバックアップのファイルではありません)")
        }
        // SharedPreferences のファイルがあれば、設定もそこから戻る(settings.json はそれのない古い ZIP のため)
        return if (pendingPrefs.isDirectory) null else settings
    }

    /** ZIP に SharedPreferences のファイルが入っていた(= 設定・Cookie は次の起動で戻る)か */
    fun hasPendingPrefs(context: Context): Boolean = File(context.filesDir, PENDING_PREFS).isDirectory
}
