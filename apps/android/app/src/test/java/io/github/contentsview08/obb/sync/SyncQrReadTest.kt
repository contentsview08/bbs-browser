package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.data.SyncQrRead
import io.github.contentsview08.obb.data.readSyncQr
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncController
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// カメラが読んだ文字から先の扱い。カメラそのものは JVM で動かないので、読み取った文字を渡して確かめる
/** 最初から入っている掲示板・板。参加の確認で手元のデータに数えない */
@Suppress("UNCHECKED_CAST")
private val PRESET_URLS: List<String> = (parseStrictJson(java.io.File("../../../packages/presets/sites.json").readText()) as Map<String, Any?>).let { p ->
    (p["sites"] as List<Map<String, Any?>>).map { it["menu"] as String } + (p["boards"] as List<Map<String, Any?>>).map { it["url"] as String }
}

class SyncQrReadTest {
    private var clock = 1_800_000_000_000L

    private class Keys : SyncKeyStore {
        var value: SyncKeyMaterial? = null
        override suspend fun load() = value
        override suspend fun save(v: SyncKeyMaterial) { value = v }
        override suspend fun clear() { value = null }
    }

    private class Device(google: FakeGoogle, now: () -> Long) {
        val db = JdbcSyncSql.open()
        val requests = ArrayList<SyncRequest>()
        val keys = Keys()
        val ctl = SyncController(
            db = db,
            keyStore = keys,
            transport = { r ->
                requests += r
                google.handle(r)
            },
            google = TEST_GOOGLE_CLIENT,
            adapters = listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
            now = now,
            presetUrls = PRESET_URLS,
            keyHint = { keys.value != null },
        )
        // 画面で「同期を使う」をオンにしたあとの状態
        init { db.exec("INSERT INTO sync_state (key, value) VALUES ('master', '1')", emptyList()) }
        val ops = io.github.contentsview08.obb.data.UserOps(db)
        fun favorites() = db.query("SELECT key FROM favorite_threads ORDER BY key").map { it["key"] as String }
    }

    private fun thread(key: String) = io.github.contentsview08.obb.bbs.ThreadSummary("https://a.5ch.io/x/", key, "t$key", 0, 0, null)
    private val google = FakeGoogle { clock }.also { it.accounts["1//0e-a"] = "acct-1"; it.accounts["1//0e-b"] = "acct-1" }
    private val codeA = encodeDrivePairingCode(DrivePairingCode(ByteArray(32) { 1 }, "1//0e-a"))
    private val codeB = encodeDrivePairingCode(DrivePairingCode(ByteArray(32) { 2 }, "1//0e-b"))

    @Test fun 同期のコードでないものは参加しない() {
        for (text in listOf("", "   ", "https://example.test/", "obb2", "obb2.", "obb2..", "obb2.!!!.!!!", "obb2.${"\u0000"}.a", "OBB2." + codeA.removePrefix("obb2."), "x".repeat(4000))) {
            assertEquals(text, "bad_code", (readSyncQr(text, enabled = false, space = null) as SyncQrRead.Bad).reason)
            assertEquals(text, "bad_code", (readSyncQr(text, enabled = true, space = "abc") as SyncQrRead.Bad).reason)
        }
        // 前の同期サーバーのコードは、終わった案内を出す
        val server = javaClass.classLoader!!.getResourceAsStream("sync-pairing.json")!!.bufferedReader(Charsets.UTF_8).use { org.json.JSONArray(it.readText()) }.getJSONObject(0).getString("code")
        assertEquals("server_code", (readSyncQr(server, enabled = false, space = null) as SyncQrRead.Bad).reason)
        assertTrue(SyncText.message("server_code").contains("Google ドライブだけ"))
    }

    @Test fun 同期している端末は領域で分ける() {
        val head = spaceId(deriveKeys(ByteArray(32) { 1 }).authToken).take(12)
        assertEquals(codeA, (readSyncQr(codeA, enabled = false, space = null) as SyncQrRead.Join).code)
        assertEquals(codeA, (readSyncQr(codeA, enabled = true, space = head) as SyncQrRead.SameSpace).code)
        assertEquals(codeB, (readSyncQr(codeB, enabled = true, space = head) as SyncQrRead.OtherSpace).code)
        // 鍵を読めないときは同じと決めつけず、確認に回す
        assertTrue(readSyncQr(codeA, enabled = true, space = null) is SyncQrRead.OtherSpace)
    }

    @Test fun 読み取って参加すると同期が始まり同じ領域はトークンだけを置き直す() = runBlocking {
        val first = Device(google) { clock }
        first.ops.setFavoriteThreadNow(thread("1"), "t1", true, clock)
        // 手元にデータがあるので参加の確認が出る。進める
        assertEquals("confirm", first.ctl.join(codeA).state)
        first.ctl.resolveConfirm("accept_removal")

        val second = Device(google) { clock }
        assertFalse(second.ctl.status().enabled)
        val read = readSyncQr(codeA, enabled = false, space = null) as SyncQrRead.Join
        second.ctl.join(read.code)
        val st = second.ctl.status()
        assertTrue(st.enabled)
        assertEquals(first.ctl.status().space, st.space)
        assertEquals(listOf("1"), second.favorites())

        val same = readSyncQr(codeA, st.enabled, st.space) as SyncQrRead.SameSpace
        second.ctl.join(same.code)
        assertEquals(st.space, second.ctl.status().space)
        assertEquals(listOf("1"), second.favorites())
    }

    @Test fun 別の領域へ移ると手元を残して新しい領域につながる() = runBlocking {
        val a = Device(google) { clock }
        a.ctl.join(codeA)
        val b = Device(google) { clock }
        b.ops.setFavoriteThreadNow(thread("2"), "t2", true, clock)
        b.ctl.join(codeB)
        b.ctl.resolveConfirm("accept_removal")
        val me = a.ctl.status()

        val read = readSyncQr(codeB, me.enabled, me.space) as SyncQrRead.OtherSpace
        // 確認で閉じたら何も変わらない
        assertEquals(me.space, a.ctl.status().space)
        a.ctl.leave()
        a.ctl.setMaster(true)
        a.ctl.join(read.code)

        val moved = a.ctl.status()
        assertTrue(moved.enabled)
        assertNotEquals(me.space, moved.space)
        assertEquals(b.ctl.status().space, moved.space)
        assertEquals(listOf("2"), a.favorites())
        assertTrue(readSyncQr(codeB, moved.enabled, moved.space) is SyncQrRead.SameSpace)
    }
}
