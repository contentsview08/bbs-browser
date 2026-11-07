package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.data.SyncQrRead
import io.github.contentsview08.obb.data.readSyncQr
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncController
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// カメラが読んだ文字から先の扱い。カメラそのものは JVM で動かないので、読み取った文字を渡して確かめる
class SyncQrReadTest {
    private var clock = 1_800_000_000_000L

    private class Keys : SyncKeyStore {
        var value: SyncKeyMaterial? = null
        override suspend fun load() = value
        override suspend fun save(v: SyncKeyMaterial) { value = v }
        override suspend fun clear() { value = null }
    }

    private class Device(server: FakeSyncServer, now: () -> Long) {
        val db = JdbcSyncSql.open()
        val requests = ArrayList<SyncRequest>()
        val keys = Keys()
        val ctl = SyncController(
            db = db,
            keyStore = keys,
            transport = { r ->
                requests += r
                val res = server.handle(FakeRequest(r.method, r.url.replace(Regex("^https://[^/]+"), ""), r.headers, r.body))
                SyncResponse(res.status, res.body, res.headers)
            },
            defaultServerUrl = "https://sync.test",
            adapters = listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
            now = now,
            keyHint = { keys.value != null },
            openStartWindow = { url -> signTicket(Regex("space_id=([0-9a-f]{64})").find(url)!!.groupValues[1], 4_000_000_000L) },
        )
        // 画面で「同期を使う」をオンにしたあとの状態
        init { db.exec("INSERT INTO sync_state (key, value) VALUES ('master', '1')", emptyList()) }
        val ops = io.github.contentsview08.obb.data.UserOps(db)
        fun favorites() = db.query("SELECT key FROM favorite_threads ORDER BY key").map { it["key"] as String }
    }

    private fun server() = FakeSyncServer(now = { clock }, ratePerMinute = null, fullPullPerHour = null)
    private fun thread(key: String) = io.github.contentsview08.obb.bbs.ThreadSummary("https://a.5ch.io/x/", key, "t$key", 0, 0, null)
    private fun cases() = JSONArray(javaClass.classLoader!!.getResourceAsStream("sync-pairing.json")!!.bufferedReader(Charsets.UTF_8).use { it.readText() })

    @Test fun 共通のコードの一覧と同じ判定になる() {
        val list = cases()
        for (i in 0 until list.length()) {
            val c = list.getJSONObject(i)
            val r = readSyncQr(c.getString("code"), enabled = false, space = null, allowLocalhost = c.optBoolean("allow_localhost"))
            if (c.has("error")) assertEquals(c.getString("name"), c.getString("error"), (r as SyncQrRead.Bad).reason)
            else assertEquals(c.getString("name"), c.getString("code"), (r as SyncQrRead.Join).code)
        }
    }

    @Test fun 同期のコードでないものは参加しない() {
        val valid = cases().getJSONObject(0).getString("code")
        for (text in listOf("", "   ", "https://example.test/", "obb1", "obb1.", "obb1...", "obb1.!!!.!!!.!!!", "obb1.${"\u0000"}.a.b", "OBB1." + valid.removePrefix("obb1."), "x".repeat(4000))) {
            assertEquals(text, "bad_code", (readSyncQr(text, enabled = false, space = null) as SyncQrRead.Bad).reason)
            assertEquals(text, "bad_code", (readSyncQr(text, enabled = true, space = "abc") as SyncQrRead.Bad).reason)
        }
    }

    @Test fun 同期している端末は領域で分ける() {
        val c = cases().getJSONObject(0)
        val code = c.getString("code")
        val head = c.getString("ticket").removePrefix("v1.").take(12)
        assertEquals(SyncQrRead.SameSpace, readSyncQr(code, enabled = true, space = head))
        val other = readSyncQr(code, enabled = true, space = "000000000000") as SyncQrRead.OtherSpace
        assertEquals(code, other.code)
        assertEquals(c.getString("server_url"), other.serverUrl)
        // 鍵を読めないときは同じと決めつけず、確認に回す
        assertTrue(readSyncQr(code, enabled = true, space = null) is SyncQrRead.OtherSpace)
        assertEquals("bad_url", (readSyncQr(cases().getJSONObject(2).getString("code"), enabled = true, space = head) as SyncQrRead.Bad).reason)
    }

    @Test fun 読み取って参加すると同期が始まり同じ領域は何もしない() = runBlocking {
        val server = server()
        val first = Device(server) { clock }
        first.ops.setFavoriteThreadNow(thread("1"), "t1", true, clock)
        first.ctl.start()
        val code = first.ctl.pairingCode()

        val second = Device(server) { clock }
        assertFalse(second.ctl.status().enabled)
        val read = readSyncQr(code, enabled = false, space = null) as SyncQrRead.Join
        second.ctl.join(read.code)
        val st = second.ctl.status()
        assertTrue(st.enabled)
        assertEquals(first.ctl.status().space, st.space)
        assertEquals(listOf("1"), second.favorites())

        val before = second.requests.size
        assertEquals(SyncQrRead.SameSpace, readSyncQr(code, st.enabled, st.space))
        assertEquals(before, second.requests.size)
    }

    @Test fun 別の領域へ移ると手元を残して新しい領域につながる() = runBlocking {
        val server = server()
        val a = Device(server) { clock }
        a.ctl.start()
        val b = Device(server) { clock }
        b.ops.setFavoriteThreadNow(thread("2"), "t2", true, clock)
        b.ctl.start()
        val other = b.ctl.pairingCode()
        val me = a.ctl.status()

        val read = readSyncQr(other, me.enabled, me.space) as SyncQrRead.OtherSpace
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
        assertEquals(SyncQrRead.SameSpace, readSyncQr(other, moved.enabled, moved.space))
    }
}
