package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.data.KeyBlob
import io.github.contentsview08.obb.data.KeyWrap
import io.github.contentsview08.obb.data.Prefs
import io.github.contentsview08.obb.data.SYNC_DEV_PREFS
import io.github.contentsview08.obb.data.SYNC_KEY_PREFS
import io.github.contentsview08.obb.data.SyncStartNav
import io.github.contentsview08.obb.data.WrappedSyncKeyStore
import io.github.contentsview08.obb.data.decodeQrLuma
import io.github.contentsview08.obb.data.exportedSettings
import io.github.contentsview08.obb.data.qrMatrix
import io.github.contentsview08.obb.data.syncStartNav
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.OkHttpSyncTransport
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

// 画面の入口の決まり。PC 版の packages/sync/test/controller.test.ts と同じことを確かめる
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

    private class Device(val server: FakeSyncServer, val now: () -> Long, keys: Keys = Keys(), val window: (String) -> String? = { url -> signTicket(Regex("space_id=([0-9a-f]{64})").find(url)!!.groupValues[1], 4_000_000_000L) }) {
        val db = JdbcSyncSql.open()
        val requests = ArrayList<SyncRequest>()
        val keys = keys
        val windows = ArrayList<String>()
        var offline = false
        val ctl = SyncController(
            db = db,
            keyStore = keys,
            transport = { r ->
                requests += r
                if (offline) throw java.io.IOException("機内モード")
                val path = r.url.replace(Regex("^https://[^/]+"), "")
                val res = server.handle(FakeRequest(r.method, path, r.headers, r.body))
                SyncResponse(res.status, res.body, res.headers)
            },
            defaultServerUrl = "https://sync.test",
            adapters = listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
            now = now,
            keyHint = { keys.value != null },
            openStartWindow = { url -> windows += url; window(url) },
        )
        val ops = io.github.contentsview08.obb.data.UserOps(db)
        fun favorites() = db.query("SELECT key FROM favorite_threads ORDER BY key").map { it["key"] as String }
    }

    private fun t(key: String) = io.github.contentsview08.obb.bbs.ThreadSummary("https://a.5ch.io/x/", key, "t$key", 0, 0, null)

    private var clock = 1_800_000_000_000L
    private fun server() = FakeSyncServer(now = { clock }, ratePerMinute = null, fullPullPerHour = null)

    @Test fun 使っていない間は通信せず鍵保管を開かず操作を積まない() = runBlocking {
        val d = Device(server(), { clock })
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        assertNull(d.ctl.foreground())
        val st = d.ctl.status()
        assertFalse(st.enabled)
        assertEquals("off", st.state)
        assertEquals(0, d.requests.size)
        assertEquals(0, d.keys.reads)
        assertEquals(0, d.db.query("SELECT * FROM sync_ops").size)
    }

    @Test fun 窓を閉じたら鍵を残さず何も送らない() = runBlocking {
        val d = Device(server(), { clock }, window = { null })
        val e = runCatching { d.ctl.start() }.exceptionOrNull() as SyncHostError
        assertEquals("cancelled", e.code)
        assertNull(d.keys.value)
        assertEquals(0, d.requests.size)
    }

    @Test fun 別の領域の許可証は受け取らない() = runBlocking {
        val d = Device(server(), { clock }, window = { signTicket("a".repeat(64), 4_000_000_000L) })
        assertEquals("bad_ticket", (runCatching { d.ctl.start() }.exceptionOrNull() as SyncHostError).code)
        assertNull(d.keys.value)
    }

    @Test fun 鍵保管が使えなければ窓を開かない() = runBlocking {
        val d = Device(server(), { clock }, Keys(fail = true))
        assertEquals("key_store_unavailable", (runCatching { d.ctl.start() }.exceptionOrNull() as SyncHostError).code)
        assertEquals(0, d.windows.size)
    }

    @Test fun 鍵と許可証はDBに入らない() = runBlocking {
        val d = Device(server(), { clock })
        d.ctl.start()
        val m = d.keys.value!!
        val dump = StringBuilder()
        for (table in listOf("sync_state", "sync_records", "sync_ops", "settings")) for (row in d.db.query("SELECT * FROM $table")) dump.append(row.values.joinToString())
        assertFalse(dump.contains(toBase64Url(m.k)))
        assertFalse(dump.contains(m.k.toHex()))
        assertFalse(dump.contains(m.ticket!!))
        assertFalse(dump.contains(deriveKeys(m.k).authToken.toHex()))
        assertEquals(12, d.ctl.status().space!!.length)
    }

    @Test fun コードで参加すると削除も届く() = runBlocking {
        val s = server()
        val a = Device(s, { clock })
        val b = Device(s, { clock })
        a.ctl.start()
        a.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        a.ctl.syncNow()
        b.ctl.join(a.ctl.pairingCode())
        assertEquals(0, b.windows.size)
        assertEquals(listOf("1"), b.favorites())
        b.ops.setFavoriteThreadNow(t("1"), "t1", false, clock + 1)
        b.ctl.syncNow()
        a.ctl.syncNow()
        assertEquals(emptyList<String>(), a.favorites())
    }

    @Test fun 通信できなくても手元は残り戻ると追いつく() = runBlocking {
        val s = server()
        val a = Device(s, { clock })
        val b = Device(s, { clock })
        a.ctl.start()
        b.ctl.join(a.ctl.pairingCode())
        a.offline = true
        a.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        assertEquals("offline", a.ctl.syncNow().state)
        assertTrue(a.ctl.status().pending > 0)
        assertEquals(listOf("1"), a.favorites())
        a.offline = false
        assertEquals("idle", a.ctl.syncNow().state)
        assertEquals(0L, a.ctl.status().pending)
        clock += 10_001
        b.ctl.foreground()
        assertEquals(listOf("1"), b.favorites())
    }

    @Test fun 離脱で手元を残しURLの上書きは残す() = runBlocking {
        val d = Device(server(), { clock })
        d.ctl.setServerUrl("https://other.test")
        d.ctl.start()
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        d.ctl.syncNow()
        d.ctl.leave()
        assertNull(d.keys.value)
        assertEquals(0, d.db.query("SELECT * FROM sync_records").size)
        assertEquals(listOf("1"), d.favorites())
        assertEquals("https://other.test", d.ctl.status().serverOverride)
        val n = d.requests.size
        d.ops.setFavoriteThreadNow(t("2"), "t2", true, clock)
        d.ctl.foreground()
        assertEquals(n, d.requests.size)
        assertEquals(0, d.db.query("SELECT * FROM sync_ops").size)
    }

    @Test fun 使っている間にURLを変えると新しい先へ全部送り直す() = runBlocking {
        val s = server()
        val d = Device(s, { clock })
        d.ctl.start()
        d.ops.setFavoriteThreadNow(t("1"), "t1", true, clock)
        d.ctl.syncNow()
        d.ctl.setServerUrl("https://other.test")
        s.spaces.clear()
        val before = d.requests.size
        assertEquals("idle", d.ctl.syncNow().state)
        val after = d.requests.drop(before)
        assertTrue(after.all { it.url.startsWith("https://other.test/") })
        assertTrue(after.any { it.url.endsWith("/records") })
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
        assertEquals(table(ui.getJSONObject("messages")), SyncText.MESSAGES)
        assertEquals(ui.getInt("reveal_taps"), SyncText.REVEAL_TAPS)
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
        assertNotEquals("settings", SYNC_DEV_PREFS)
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

    @Test fun 窓の中で動ける先を絞る() {
        val start = "https://sync.example.test/start?space_id=a&return=app"
        fun nav(u: String) = syncStartNav(u, start)
        assertEquals("v1.a.b", (nav("https://obb-sync.invalid/ticket?ticket=v1.a.b") as SyncStartNav.Ticket).value)
        assertEquals(SyncStartNav.Block, nav("https://obb-sync.invalid/ticket"))
        assertEquals(SyncStartNav.Block, nav("https://obb-sync.invalid/other?ticket=x"))
        assertEquals(SyncStartNav.Block, nav("http://obb-sync.invalid/ticket?ticket=x"))
        assertEquals(SyncStartNav.Allow, nav(start))
        assertEquals(SyncStartNav.Allow, nav("https://challenges.cloudflare.com/turnstile/v0/x"))
        assertEquals(SyncStartNav.Allow, nav("about:blank"))
        assertEquals(SyncStartNav.Allow, nav("about:srcdoc"))
        assertEquals(SyncStartNav.Block, nav("https://evil.example.test/"))
        assertEquals(SyncStartNav.Block, nav("http://sync.example.test/"))
        assertEquals(SyncStartNav.Block, nav("http://challenges.cloudflare.com/"))
        assertEquals(SyncStartNav.Block, nav("javascript:alert(1)"))
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
