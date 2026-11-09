package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.data.KeyBlob
import io.github.contentsview08.obb.data.KeyWrap
import io.github.contentsview08.obb.data.Prefs
import io.github.contentsview08.obb.data.SYNC_KEY_PREFS
import io.github.contentsview08.obb.data.WrappedSyncKeyStore
import io.github.contentsview08.obb.data.decodeQrLuma
import io.github.contentsview08.obb.data.exportedSettings
import io.github.contentsview08.obb.data.qrMatrix
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.DRIVE_API
import io.github.contentsview08.obb.sync.engine.GOOGLE_AUTH_FAILED
import io.github.contentsview08.obb.sync.engine.GOOGLE_OTHER_ACCOUNT
import io.github.contentsview08.obb.sync.engine.GOOGLE_PAIRING_FAILED
import io.github.contentsview08.obb.sync.engine.GOOGLE_TOKEN_URL
import io.github.contentsview08.obb.sync.engine.GOOGLE_UNAVAILABLE
import io.github.contentsview08.obb.sync.engine.GoogleClient
import io.github.contentsview08.obb.sync.engine.OkHttpSyncTransport
import io.github.contentsview08.obb.sync.engine.SERVER_SYNC_ENDED
import io.github.contentsview08.obb.sync.engine.formatDriveUsage
import io.github.contentsview08.obb.sync.engine.PAIRING_SHOW_MS
import io.github.contentsview08.obb.sync.engine.SyncApiError
import io.github.contentsview08.obb.sync.engine.SyncController
import io.github.contentsview08.obb.sync.engine.SyncHostError
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import io.github.contentsview08.obb.sync.engine.SyncResponseTooLarge
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import io.github.contentsview08.obb.sync.engine.SYNC_GROUPS
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Paths

// 画面の入口の決まり。PC 版の packages/sync/test/controller.test.ts・controllerDrive.test.ts と同じことを、Google ドライブの置き場で確かめる
/** 最初から入っている掲示板・板。参加の確認で手元のデータに数えない */
@Suppress("UNCHECKED_CAST")
private val PRESET_URLS: List<String> = (parseStrictJson(File("../../../packages/presets/sites.json").readText()) as Map<String, Any?>).let { p ->
    (p["sites"] as List<Map<String, Any?>>).map { it["menu"] as String } + (p["boards"] as List<Map<String, Any?>>).map { it["url"] as String }
}

class SyncHostTest {
    private fun resource(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader(Charsets.UTF_8).use { it.readText() }

    private class Keys(val fail: Boolean = false) : SyncKeyStore {
        var value: SyncKeyMaterial? = null
        var reads = 0
        override suspend fun load(): SyncKeyMaterial? {
            reads++
            if (fail) throw IllegalStateException("no key store")
            return value
        }
        override suspend fun save(v: SyncKeyMaterial) {
            if (fail) throw IllegalStateException("no key store")
            value = v
        }
        override suspend fun clear() {
            value = null
        }
    }

    private class Device(val google: FakeGoogle, val now: () -> Long, keys: Keys = Keys(), client: GoogleClient? = TEST_GOOGLE_CLIENT) {
        val db = JdbcSyncSql.open()
        val requests = ArrayList<SyncRequest>()
        val keys = keys
        var offline = false
        val ctl = SyncController(
            db = db,
            keyStore = keys,
            transport = { r ->
                requests += r
                if (offline) throw java.io.IOException("機内モード")
                google.handle(r)
            },
            google = client,
            adapters = listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
            now = now,
            presetUrls = PRESET_URLS,
            keyHint = { keys.value != null },
        )
        // 画面で「同期を使う」をオンにしたあとの状態
        init { db.exec("INSERT INTO sync_state (key, value) VALUES ('master', '1')", emptyList()) }
        val ops = io.github.contentsview08.obb.data.UserOps(db)
        fun favorites() = db.query("SELECT key FROM favorite_threads ORDER BY key").map { it["key"] as String }
        /** QR で参加する。手元が空でも Google アカウントを出して確かめるので、「参加する」と答える */
        suspend fun join(code: String) = ctl.join(code).let { if (it.state == "confirm") ctl.resolveConfirm("accept_removal") else it }
        fun state(key: String) = db.query("SELECT value FROM sync_state WHERE key = ?", listOf(key)).firstOrNull()?.get("value") as String?
    }

    private fun t(key: String) = io.github.contentsview08.obb.bbs.ThreadSummary("https://a.5ch.io/x/", key, "t$key", 0, 0, null)

    private var clock = 1_800_000_000_000L
    private val k = ByteArray(32) { 9 }
    private val rt = "1//0e-fake-refresh-token"

    /** PC の「端末を追加」の QR。トークンは acct-1 のもの */
    private fun google(): Pair<FakeGoogle, String> {
        val g = FakeGoogle { clock }
        g.accounts[rt] = "acct-1"
        return g to encodeDrivePairingCode(DrivePairingCode(k, rt))
    }

    @Test fun 既定はオフでオンにするまで参加できない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.db.exec("DELETE FROM sync_state WHERE key = 'master'", emptyList())
        val st = d.ctl.status()
        assertFalse(st.master)
        assertNull(st.driveUnavailable)
        assertEquals(mapOf("history" to true, "favorites" to true, "sites" to true, "posts" to true, "images" to true, "ng" to true, "settings" to true, "secret" to false), st.kinds)
        assertEquals("sync_off", runCatching { d.ctl.join(code) }.exceptionOrNull().let { (it as SyncHostError).code })
        assertEquals(0, d.requests.size)
        d.ctl.setMaster(true)
        d.join(code)
        val on = d.ctl.status()
        assertTrue(on.enabled)
        assertEquals("acct-1@example.test", on.email)
        assertEquals(1, g.drive.spaceCount())
    }

    @Test fun クライアントのないビルドでは参加できず理由を出す() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock }, client = null)
        assertEquals(GOOGLE_UNAVAILABLE, d.ctl.status().driveUnavailable)
        assertEquals(GOOGLE_UNAVAILABLE, (runCatching { d.ctl.join(code) }.exceptionOrNull() as SyncHostError).code)
        assertNull(d.keys.value)
        assertEquals(0, d.requests.size)
        assertTrue(SyncText.message(GOOGLE_UNAVAILABLE).contains("Google の同期の設定が入っていない"))
    }

    @Test fun サーバーのコードと形の違うコードは読まない() = runBlocking {
        val (g, _) = google()
        val d = Device(g, { clock })
        assertEquals("server_code", (runCatching { d.ctl.join("obb1." + "A".repeat(43) + ".x.y") }.exceptionOrNull() as SyncHostError).code)
        assertEquals("bad_code", (runCatching { d.ctl.join("obb2.x") }.exceptionOrNull() as SyncApiError).kind)
        assertNull(d.keys.value)
        assertEquals(0, d.requests.size)
    }

    @Test fun 使えないトークンのコードでは鍵を作らない() = runBlocking {
        val (g, code) = google()
        g.revoked += rt
        val d = Device(g, { clock })
        assertEquals(GOOGLE_PAIRING_FAILED, (runCatching { d.ctl.join(code) }.exceptionOrNull() as SyncHostError).code)
        assertNull(d.keys.value)
        assertFalse(d.ctl.status().enabled)
        assertEquals(0, g.drive.files.size)
    }

    @Test fun オフの間は通信も積みも鍵保管も触らず鍵は残りオンで続きから動く() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ctl.setMaster(false)
        d.requests.clear()
        val reads = d.keys.reads
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        assertNull(d.ctl.foreground())
        assertFalse(d.ctl.autoEnabled())
        assertFalse(d.ctl.autoCheck())
        assertFalse(d.ctl.hasChanges())
        d.ctl.syncNow()
        assertNull(d.ctl.driveUsage())
        assertEquals(0, d.requests.size)
        assertEquals(reads, d.keys.reads)
        assertEquals(0, d.db.query("SELECT * FROM sync_ops").size)
        val st = d.ctl.status()
        assertEquals("off", st.state)
        assertTrue(st.enabled)
        assertTrue(d.keys.value != null)
        d.ctl.setMaster(true)
        assertTrue(d.requests.isNotEmpty())
        assertEquals(1L, d.db.query("SELECT COUNT(*) AS n FROM sync_records WHERE kind = 'favorite' AND pending = 0").first()["n"])
    }

    @Test fun 切っている種類の送信待ちは数えない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        assertTrue(d.ctl.hasChanges())
        d.ctl.syncNow()
        d.db.exec("UPDATE sync_records SET pending = 1 WHERE kind = 'favorite'", emptyList())
        d.ctl.setKind("favorites", false)
        assertFalse(d.ctl.hasChanges())
        assertEquals(0L, d.ctl.status().pending)
    }

    @Test fun 使っていない間は通信せず鍵保管を開かず操作を積まない() = runBlocking {
        val (g, _) = google()
        val d = Device(g, { clock })
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        assertNull(d.ctl.foreground())
        d.ctl.startup()
        val st = d.ctl.status()
        assertFalse(st.enabled)
        assertEquals("off", st.state)
        assertNull(d.ctl.driveUsage())
        assertEquals(0, d.requests.size)
        assertEquals(0, d.keys.reads)
        assertEquals(0, d.db.query("SELECT * FROM sync_ops").size)
    }

    @Test fun 鍵保管が使えなければ参加しない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock }, Keys(fail = true))
        assertEquals("key_store_unavailable", (runCatching { d.ctl.join(code) }.exceptionOrNull() as SyncHostError).code)
        assertEquals(0, d.requests.size)
    }

    @Test fun 鍵とGoogleのトークンはDBに入らない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        val m = d.keys.value!!
        assertEquals(rt, m.google)
        val dump = StringBuilder()
        for (table in listOf("sync_state", "sync_records", "sync_ops", "settings")) for (row in d.db.query("SELECT * FROM $table")) dump.append(row.values.joinToString())
        assertFalse(dump.contains(toBase64Url(m.k)))
        assertFalse(dump.contains(m.k.toHex()))
        assertFalse(dump.contains(rt))
        assertFalse(dump.contains("access-"))
        assertFalse(dump.contains(deriveKeys(m.k).authToken.toHex()))
        // Drive へ送るのはアクセストークンだけ。更新用のトークンはトークンの口にだけ行く
        assertTrue(d.requests.filter { it.url != GOOGLE_TOKEN_URL }.none { r -> r.headers.values.any { it.contains(rt) } || r.body.orEmpty().contains(rt) || r.url.contains(rt) })
        assertEquals(12, d.ctl.status().space!!.length)
    }

    @Test fun QRで参加すると削除も届く() = runBlocking {
        val (g, code) = google()
        val a = Device(g, { clock })
        val b = Device(g, { clock })
        a.join(code)
        a.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        a.ctl.syncNow()
        b.join(code)
        assertEquals(listOf("1"), b.favorites())
        b.ops.setFavoriteThreadNow(t("1"), "t1", false, clock)
        b.ctl.syncNow()
        clock += 60_000
        a.ctl.syncNow()
        assertEquals(emptyList<String>(), a.favorites())
        // 書き手ごとのファイル。目印 1 つと、端末ごとのセグメント
        assertEquals(1, g.drive.spaceCount())
        assertEquals(setOf("space", "seg"), g.drive.files.values.map { it.appProperties["t"] }.toSet())
    }

    @Test fun 手元にデータがあれば確認を出しやめると何も送らずトークンも置かない() = runBlocking {
        val (g, code) = google()
        val b = Device(g, { clock })
        b.ops.setFavoriteThreadNow(t("9"), "t9", true, clock)
        val r = b.ctl.join(code)
        assertEquals("confirm", r.state)
        assertEquals("acct-1@example.test", r.confirm!!.account)
        assertEquals(true, r.confirm!!.data)
        assertEquals("confirm", b.ctl.status().state)
        b.ctl.resolveConfirm("keep_local")
        assertNull(b.keys.value)
        assertFalse(b.ctl.status().enabled)
        assertEquals(0, g.drive.files.size)
        b.ctl.join(code)
        b.ctl.resolveConfirm("accept_removal")
        assertTrue(b.ctl.status().enabled)
        assertEquals(rt, b.keys.value!!.google)
        assertEquals(1, g.drive.recordsOf(spaceId(deriveKeys(k).authToken)).size)
    }

    @Test fun 最初から入っている掲示板と板は手元のデータに数えない() = runBlocking {
        val (g, code) = google()
        val b = Device(g, { clock })
        b.db.exec("INSERT INTO favorite_boards (url, connector_id, name, sort) VALUES (?, '2ch-compat', 'x', 1)", listOf(PRESET_URLS.last()))
        // 手元が空でも Google アカウントは確かめる。送るものはないので、その文は出さない
        val r = b.ctl.join(code)
        assertEquals("confirm", r.state)
        assertEquals(false, r.confirm!!.data)
        assertEquals("acct-1@example.test", r.confirm!!.account)
        assertNull(b.keys.value)
        assertEquals("idle", b.ctl.resolveConfirm("accept_removal").state)
    }

    @Test fun 取り消されると止まりQRの読み直しでトークンだけを置き直して続く() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        g.revoke(rt)
        assertEquals("blocked", d.ctl.syncNow().state)
        val st = d.ctl.status()
        assertEquals(GOOGLE_AUTH_FAILED, st.lastError)
        assertTrue(st.lastErrorText!!.contains("PC で「端末を追加」の QR を出して"))
        // 違うアカウントのトークンは置かない
        val other = "1//0e-other-account"
        g.accounts[other] = "acct-2"
        assertEquals(GOOGLE_OTHER_ACCOUNT, (runCatching { d.ctl.join(encodeDrivePairingCode(DrivePairingCode(k, other))) }.exceptionOrNull() as SyncHostError).code)
        assertEquals(rt, d.keys.value!!.google)
        // 別の K の QR は、使っている最中には読まない
        val fresh = "1//0e-fresh-token"
        g.accounts[fresh] = "acct-1"
        assertEquals("already_on", (runCatching { d.ctl.join(encodeDrivePairingCode(DrivePairingCode(ByteArray(32) { 3 }, fresh))) }.exceptionOrNull() as SyncHostError).code)
        val deviceId = d.keys.value!!.deviceId
        assertEquals("idle", d.ctl.join(encodeDrivePairingCode(DrivePairingCode(k, fresh))).state)
        assertEquals(fresh, d.keys.value!!.google)
        assertEquals(deviceId, d.keys.value!!.deviceId)
        assertNull(d.ctl.status().lastError)
        assertEquals(1L, d.db.query("SELECT COUNT(*) AS n FROM sync_records WHERE kind = 'favorite' AND pending = 0").first()["n"])
    }

    @Test fun アクセストークンはメモリに持ち期限の前と401で取り直す() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        val before = g.tokenBodies.size
        d.ctl.syncNow()
        assertEquals(before, g.tokenBodies.size)
        // 期限(1 時間)の 5 分前を過ぎたら取り直す
        clock += 56 * 60_000L
        d.ctl.syncNow()
        assertEquals(before + 1, g.tokenBodies.size)
        // Google の側でアクセストークンが切れた(401)。1 回だけ取り直して送り直す
        g.drive.tokens.removeAll { it.startsWith("access-") }
        clock += 60_000
        d.ops.setFavoriteThreadNow(t("2"), "t2", true, clock)
        assertEquals("idle", d.ctl.syncNow().state)
        assertEquals(before + 2, g.tokenBodies.size)
        assertTrue(g.tokenBodies.all { it.contains("grant_type=refresh_token") })
    }

    @Test fun 同期サーバーで使っていた端末は起動時に同期をやめた状態に戻り案内を出す() = runBlocking {
        val (g, _) = google()
        val d = Device(g, { clock })
        // 前の版でサーバーの同期を使っていた状態(鍵は K と許可証、置き場の印がない)
        d.keys.value = SyncKeyMaterial(k, "old_device_id_00000000", "v1.ticket")
        d.db.batch(listOf(
            io.github.contentsview08.obb.sync.engine.setState("enabled", "1"),
            io.github.contentsview08.obb.sync.engine.setState("phase", "idle"),
            io.github.contentsview08.obb.sync.engine.setState("device_id", "old_device_id_00000000"),
            io.github.contentsview08.obb.sync.engine.setState("since", "42"),
        ))
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        d.ctl.startup()
        assertNull(d.keys.value)
        val st = d.ctl.status()
        assertFalse(st.enabled)
        assertTrue(st.master)
        assertEquals(SERVER_SYNC_ENDED, st.lastError)
        assertTrue(st.lastErrorText!!.contains("同期をやめた状態に戻しました"))
        assertEquals(listOf("1"), d.favorites())
        assertEquals(0, d.requests.size)
        // QR を読めば Google ドライブで始め直せる。案内は消える
        assertEquals("confirm", d.ctl.join(encodeDrivePairingCode(DrivePairingCode(k, rt))).state)
        d.ctl.resolveConfirm("accept_removal")
        assertNull(d.ctl.status().lastError)
        assertEquals("drive", d.state("store"))
    }

    /** 前の版でサーバーの同期を使っていた状態(鍵は K と許可証、置き場の印がない) */
    private suspend fun serverDevice(d: Device) {
        d.keys.value = SyncKeyMaterial(k, "old_device_id_00000000", "v1.ticket")
        d.db.batch(listOf(
            io.github.contentsview08.obb.sync.engine.setState("enabled", "1"),
            io.github.contentsview08.obb.sync.engine.setState("phase", "idle"),
            io.github.contentsview08.obb.sync.engine.setState("device_id", "old_device_id_00000000"),
            io.github.contentsview08.obb.sync.engine.setState("since", "42"),
        ))
    }

    @Test fun クライアントのない版ではサーバーで使っていた端末を戻さない() = runBlocking {
        val (g, _) = google()
        val d = Device(g, { clock }, client = null)
        serverDevice(d)
        d.ctl.startup()
        assertTrue(d.keys.value != null)
        val st = d.ctl.status()
        assertTrue(st.enabled)
        assertNull(st.lastError)
        assertEquals(0, g.drive.files.size)
    }

    @Test fun 戻しても種類ごとのスイッチは残す() = runBlocking {
        val (g, _) = google()
        val d = Device(g, { clock })
        serverDevice(d)
        d.db.batch(listOf(io.github.contentsview08.obb.sync.engine.setState("kinds", canonicalJson(mapOf("history" to false)))))
        d.ctl.startup()
        val st = d.ctl.status()
        assertFalse(st.enabled)
        assertEquals(SERVER_SYNC_ENDED, st.lastError)
        assertEquals(false, st.kinds["history"])
        assertEquals(true, st.kinds["favorites"])
    }

    @Test fun 容量の超過では外さずに1時間待ち容量の案内だけ出す() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        g.drive.quotaBytes = g.drive.files.values.sumOf { it.content.toByteArray().size.toLong() }
        d.ops.setFavoriteThreadNow(t("5"), "t5", true, clock)
        assertEquals("idle", d.ctl.syncNow().state)
        val st = d.ctl.status()
        assertEquals("drive_quota", st.lastError)
        assertTrue(st.lastErrorText!!.contains("容量"))
        assertEquals(1L, st.pending)
        assertNull(d.state("bad_counts"))
        assertFalse(d.ctl.hasChanges())
        g.drive.quotaBytes = Long.MAX_VALUE
        clock += io.github.contentsview08.obb.sync.engine.DRIVE_QUOTA_WAIT_MS
        assertTrue(d.ctl.hasChanges())
        d.ctl.autoCycle("tick")
        assertEquals(0L, d.ctl.status().pending)
    }

    @Test fun 送るだけの周では変更の一覧もダウンロードも呼ばない() = runBlocking {
        val (g, code) = google()
        val a = Device(g, { clock })
        val b = Device(g, { clock })
        a.join(code)
        b.join(code)
        a.ops.setFavoriteThreadNow(t("7"), "t7", true, clock)
        a.ctl.syncNow()
        clock += 60_000
        b.ops.setFavoriteThreadNow(t("8"), "t8", true, clock)
        val lists = g.drive.calls["changes.list"] ?: 0
        val downloads = g.drive.calls["files.get(media)"] ?: 0
        b.ctl.autoCycle("tick")
        assertEquals(lists, g.drive.calls["changes.list"] ?: 0)
        assertEquals(downloads, g.drive.calls["files.get(media)"] ?: 0)
        assertEquals(listOf("8"), b.favorites())
        b.ctl.syncNow()
        assertEquals(listOf("7", "8"), b.favorites())
    }

    @Test fun 参加の全件の送信はスナップショットへまとめて書く() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        for (i in 0 until 3000) d.ops.setFavoriteThreadNow(t("m$i"), "tm$i", true, clock)
        d.join(code)
        assertEquals(0L, d.ctl.status().pending)
        // 100 件ずつのセグメントなら 30 回の上書きになる。目印 1 + スナップショットの部分だけを作る
        assertEquals(0, g.drive.calls["files.update"] ?: 0)
        assertTrue((g.drive.calls["files.create"] ?: 0) <= 3)
        assertTrue(g.drive.files.values.any { it.appProperties["t"] == "snap" })
        assertTrue(g.drive.recordsOf(spaceId(deriveKeys(k).authToken)).size >= 3000)
    }

    @Test fun 止まっている間は使っている量を読まない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        g.revoke(rt)
        assertEquals("blocked", d.ctl.syncNow().state)
        val before = g.drive.calls["files.list"] ?: 0
        assertNull(d.ctl.driveUsage())
        assertEquals(before, g.drive.calls["files.list"] ?: 0)
    }

    @Test fun サーバーのURLはPCと同じ() {
        assertEquals(JSONObject(File("../../../packages/sync/server-url.json").readText()).getString("default"), SyncConfig.SERVER_URL)
    }

    @Test fun やめると鍵とトークンを手元から消し取り消しは送らない() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        d.ctl.syncNow()
        d.requests.clear()
        d.ctl.leave()
        assertNull(d.keys.value)
        assertFalse(d.ctl.status().enabled)
        assertEquals(listOf("1"), d.favorites())
        assertEquals(0, d.requests.size)
        assertTrue(g.drive.files.isNotEmpty())
    }

    @Test fun ドライブで使っている量を足して出す() = runBlocking {
        val (g, code) = google()
        val d = Device(g, { clock })
        d.join(code)
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        d.ctl.syncNow()
        val want = g.drive.files.values.sumOf { it.content.toByteArray().size.toLong() }
        assertTrue(want > 0)
        val before = g.drive.calls["files.list"] ?: 0
        assertEquals(want, d.ctl.driveUsage())
        assertEquals(before + 1, g.drive.calls["files.list"])
        assertEquals("0.0 KB", formatDriveUsage(0))
        assertEquals("1.2 MB", formatDriveUsage(1_234_567))
        assertEquals("1.0 KB", formatDriveUsage(1024))
        assertEquals("1.0 MB", formatDriveUsage(1024L * 1024 - 1))
        assertEquals("1023.9 KB", formatDriveUsage(1_048_473))
        assertEquals("2.5 GB", formatDriveUsage(2_684_354_560))
        assertEquals("2048.0 GB", formatDriveUsage(2048L * 1024 * 1024 * 1024))
    }

    @Test fun Driveの端末を足すコードは決まりのとおり() {
        val code = encodeDrivePairingCode(DrivePairingCode(ByteArray(32) { 7 }, "1//0e-fake-refresh-token_for.tests"))
        assertEquals("obb2.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc.MS8vMGUtZmFrZS1yZWZyZXNoLXRva2VuX2Zvci50ZXN0cw", code)
        val p = parseDrivePairingCode("  $code\n")
        assertArrayEquals(ByteArray(32) { 7 }, p.k)
        assertEquals("1//0e-fake-refresh-token_for.tests", p.refreshToken)
        for (bad in listOf("obb1" + code.removePrefix("obb2"), "$code.x", "obb2.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw.MS8vMGUtZmFrZS1yZWZyZXNoLXRva2VuX2Zvci50ZXN0cw", "obb2.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc.", "obb2.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc.YSBi", "obb2.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc.44OI44O844Kv44Oz", "$code==")) {
            assertEquals(bad, "bad_code", assertThrows(SyncApiError::class.java) { parseDrivePairingCode(bad) }.kind)
        }
        // PC の共通テスト(packages/conformance/sync-pairing-drive.json)があれば、それとも比べる
        val shared = javaClass.classLoader!!.getResourceAsStream("sync-pairing-drive.json") ?: return
        val cases = JSONArray(shared.bufferedReader(Charsets.UTF_8).use { it.readText() })
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            if (c.has("error")) {
                assertEquals(c.getString("name"), c.getString("error"), assertThrows(c.getString("name"), SyncApiError::class.java) { parseDrivePairingCode(c.getString("code")) }.kind)
                continue
            }
            val d = parseDrivePairingCode(c.getString("code"))
            assertArrayEquals(c.getString("name"), fromHex(c.getString("k_hex")), d.k)
            assertEquals(c.getString("refresh_token"), d.refreshToken)
            if (c.optBoolean("encode")) assertEquals(c.getString("code"), encodeDrivePairingCode(d))
        }
    }

    @Test fun DriveのことばはPCと同じ() {
        // PC の packages/sync/src/messages.ts の DRIVE_MESSAGES・DRIVE_LABELS と同じ文言(スマホだけの案内の文を除く)
        val ts = File("../../../packages/sync/src/messages.ts").readText()
        val phoneOnly = setOf("google_auth_failed", "server_sync_ended", "server_code", "join_note", "rescan")
        for ((key, text) in DriveText.MESSAGES + DriveText.LABELS) {
            if (key in phoneOnly) continue
            assertTrue("$key: $text", ts.contains("$key: '$text'"))
        }
    }

    @Test fun ペアリングのコードは共通テストのとおり() {
        val cases = JSONArray(resource("sync-pairing.json"))
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val allow = c.optBoolean("allow_localhost", false)
            if (c.has("error")) {
                val e = assertThrows(c.getString("name"), SyncApiError::class.java) { parsePairingCode(c.getString("code"), allow) }
                assertEquals(c.getString("name"), c.getString("error"), e.kind)
                continue
            }
            val p = parsePairingCode(c.getString("code"), allow)
            assertArrayEquals(c.getString("name"), fromHex(c.getString("k_hex")), p.k)
            assertEquals(c.getString("server_url"), p.serverUrl)
            assertEquals(c.getString("ticket"), p.ticket)
            if (c.optBoolean("encode")) assertEquals(c.getString("code"), encodePairingCode(p))
        }
    }

    @Test fun 画面の言葉がPCと同じ() {
        val ui = JSONObject(resource("sync-ui.json"))
        fun table(o: JSONObject) = o.keys().asSequence().associateWith { o.getString(it) }
        assertEquals(table(ui.getJSONObject("labels")), SyncText.LABELS)
        assertEquals(table(ui.getJSONObject("notes")), SyncText.NOTES)
        assertEquals(table(ui.getJSONObject("messages")), SyncText.MESSAGES)
        val groups = ui.getJSONArray("groups")
        assertEquals(groups.length(), SYNC_GROUPS.size)
        SYNC_GROUPS.forEachIndexed { i, g ->
            val j = groups.getJSONObject(i)
            assertEquals(j.getString("id"), g.id)
            assertEquals(j.getString("label"), g.label)
            assertEquals(j.getBoolean("default"), g.default)
            val kinds = j.getJSONArray("kinds")
            assertEquals((0 until kinds.length()).map { kinds.getString(it) }, g.kinds)
        }
        assertEquals(ui.getLong("pairing_show_ms"), PAIRING_SHOW_MS)
    }

    private class FakeWrap : KeyWrap {
        var broken = false
        override fun seal(plain: ByteArray) = plain.reversedArray()
        override fun open(sealed: ByteArray): ByteArray {
            if (broken) throw IllegalStateException("鍵がない")
            return sealed.reversedArray()
        }
    }

    private class MemBlob : KeyBlob {
        var value: String? = null
        override fun read() = value
        override fun write(value: String) { this.value = value }
        override fun delete() { value = null }
    }

    @Test fun 包んで置き読み戻せ開けなければ鍵なしにする() = runBlocking {
        val wrap = FakeWrap()
        val blob = MemBlob()
        val store = WrappedSyncKeyStore(wrap, blob)
        assertNull(store.load())
        val k = ByteArray(32) { 5 }
        store.save(SyncKeyMaterial(k, "dev", "v1.x"))
        assertFalse(blob.value!!.contains(toBase64Url(k)))
        val m = store.load()!!
        assertArrayEquals(k, m.k)
        assertEquals("dev", m.deviceId)
        assertEquals("v1.x", m.ticket)
        store.save(SyncKeyMaterial(k, "dev", null))
        assertNull(store.load()!!.ticket)
        wrap.broken = true
        assertNull(store.load())
        wrap.broken = false
        blob.value = "壊れた値"
        assertNull(store.load())
        store.clear()
        assertNull(blob.value)
    }

    @Test fun 鍵はバックアップにも書き出しにも入らない() {
        assertNotEquals("settings", SYNC_KEY_PREFS)
        val out = exportedSettings(mapOf("blob" to "秘密", "open" to true, "keywords" to "[]"), setOf("keywords"))
        assertFalse(out.has("blob"))
        assertFalse(out.has("open"))
        assertFalse(Files.readString(Paths.get("src/main/java/io/github/contentsview08/obb/data/Prefs.kt")).contains(SYNC_KEY_PREFS))
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("""android:allowBackup="false""""))
        assertTrue(manifest.contains("""android:dataExtractionRules="@xml/data_extraction_rules""""))
        val rules = File("src/main/res/xml/data_extraction_rules.xml").readText()
        assertEquals(2, Regex("""path="$SYNC_KEY_PREFS\.xml"""").findAll(rules).count())
    }

    @Test fun 既定のURLはhttpsで検査を通る() {
        val url = JSONObject(File("../../../packages/sync/server-url.json").readText()).getString("default")
        assertEquals(url, io.github.contentsview08.obb.sync.engine.checkServerUrl(url))
    }

    @Test fun QRを書いて読める() {
        val text = "obb1." + "A".repeat(43) + "." + "B".repeat(60) + ".v1." + "a".repeat(64) + ".4000000000.k1." + "c".repeat(43)
        val m = qrMatrix(text)
        val scale = 4
        val side = m.size * scale
        val luma = ByteArray(side * side) { i -> if (m[i / side / scale][(i % side) / scale]) 0 else -1 }
        assertEquals(text, decodeQrLuma(luma, side, side, side))
        assertNull(decodeQrLuma(ByteArray(side * side) { -1 }, side, side, side))
    }

    @Test fun PCの出すQRを読める() {
        val f = JSONObject(resource("sync-qr.json"))
        val rows = f.getJSONArray("rows")
        val scale = 4
        val side = rows.length() * scale
        val luma = ByteArray(side * side) { i -> if (rows.getString(i / side / scale)[(i % side) / scale] == '1') 0 else -1 }
        assertEquals(f.getString("text"), decodeQrLuma(luma, side, side, side))
    }

    /** 決まった応答を返す小さなサーバー。受け取った要求の文字列を返す */
    private fun serve(vararg replies: String): Pair<String, java.util.concurrent.LinkedBlockingQueue<String>> {
        val socket = ServerSocket(0)
        val got = java.util.concurrent.LinkedBlockingQueue<String>()
        Thread {
            for (reply in replies) {
                val s = runCatching { socket.accept() }.getOrNull() ?: return@Thread
                s.use {
                    val input = it.getInputStream()
                    val buf = ByteArray(65536)
                    val text = StringBuilder()
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        text.append(String(buf, 0, n, Charsets.UTF_8))
                        val end = text.indexOf("\r\n\r\n")
                        if (end >= 0) {
                            val len = Regex("content-length: *([0-9]+)", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.toInt() ?: 0
                            if (text.substring(end + 4).toByteArray().size >= len) break
                        }
                    }
                    got.add(text.toString())
                    it.getOutputStream().write(reply.toByteArray())
                    it.getOutputStream().flush()
                }
            }
        }.also { it.isDaemon = true }.start()
        return "http://127.0.0.1:${socket.localPort}" to got
    }

    private fun ok(body: String, extra: String = "") = "HTTP/1.1 200 OK\r\nConnection: close\r\n${extra}Content-Length: ${body.toByteArray().size}\r\n\r\n$body"
    private fun req(method: String, url: String, body: String? = null, max: Int = 1000, timeout: Long = 10_000) = SyncRequest(method, url, mapOf("Authorization" to "Bearer abc") + (if (body != null) mapOf("Content-Type" to "application/json") else emptyMap()), body, max, timeout)

    @Test fun POSTにContentLengthと余計なものを足さないContentTypeが付く() = runBlocking {
        val (base, got) = serve(ok("{}"))
        val body = """{"a":"日本語"}"""
        val r = OkHttpSyncTransport().send(req("POST", "$base/records", body))
        assertEquals(200, r.status)
        val text = got.take().lowercase()
        assertTrue(text, text.startsWith("post /records"))
        assertTrue(text, text.contains("content-length: ${body.toByteArray().size}\r\n"))
        assertTrue(text, text.contains("content-type: application/json\r\n"))
    }

    @Test fun リダイレクトをたどらない() = runBlocking {
        val (other, otherGot) = serve(ok("{}"))
        val (base, got) = serve("HTTP/1.1 302 Found\r\nConnection: close\r\nLocation: $other/stolen\r\nContent-Length: 0\r\n\r\n")
        assertEquals(302, OkHttpSyncTransport().send(req("GET", "$base/head")).status)
        got.take()
        assertNull(otherGot.poll(300, java.util.concurrent.TimeUnit.MILLISECONDS))
    }

    @Test fun 指定の時間で打ち切る() = runBlocking {
        val socket = ServerSocket(0)
        val keep = Thread { runCatching { socket.accept().also { Thread.sleep(2000) }.close() } }.also { it.isDaemon = true; it.start() }
        val started = System.currentTimeMillis()
        assertTrue(runCatching { OkHttpSyncTransport().send(req("GET", "http://127.0.0.1:${socket.localPort}/head", timeout = 200)) }.isFailure)
        assertTrue(System.currentTimeMillis() - started < 1500)
        keep.join(100)
    }

    @Test fun 上限を超える応答を読まない() = runBlocking {
        val (base, _) = serve(ok("x".repeat(5000)))
        val e = runCatching { OkHttpSyncTransport().send(req("GET", "$base/changes")) }.exceptionOrNull()
        assertTrue(e is SyncResponseTooLarge)
    }

    @Test fun Cookieを持たない() = runBlocking {
        val (base, got) = serve(ok("{}", "Set-Cookie: a=1; Path=/\r\n"), ok("{}"))
        val t = OkHttpSyncTransport()
        t.send(req("GET", "$base/head"))
        t.send(req("GET", "$base/head"))
        got.take()
        assertFalse(got.take().lowercase().contains("cookie:"))
    }
}
