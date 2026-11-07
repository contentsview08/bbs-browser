package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.PairingCode
import io.github.contentsview08.obb.sync.SyncText
import io.github.contentsview08.obb.sync.adapters.AdapterContext
import io.github.contentsview08.obb.sync.adapters.SyncAdapter
import io.github.contentsview08.obb.sync.deriveKeys
import io.github.contentsview08.obb.sync.encodePairingCode
import io.github.contentsview08.obb.sync.generateMasterKey
import io.github.contentsview08.obb.sync.parsePairingCode
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.spaceId
import kotlinx.coroutines.CancellationException

// 画面から使う同期の入口。PC 版の packages/sync/src/engine/controller.ts と同じ順番。使っていない間は鍵保管にも通信にも触らない

const val PAIRING_SHOW_MS = 60_000L

/** 利用者の操作を続けられない理由。文は SyncText.message */
class SyncHostError(val code: String) : Exception(code)

class SyncStatus(
    /** 領域に入っている(鍵がある) */
    val enabled: Boolean,
    /** 同期自体のスイッチ */
    val master: Boolean,
    val kinds: Map<String, Boolean>,
    val state: String,
    /** 領域の先頭。鍵は出さない */
    val space: String?,
    /** 送信待ちの件数(まだレコードにしていない操作を含む) */
    val pending: Long,
    val lastError: String?,
    val lastErrorText: String?,
    val lastPullAt: Long?,
    val lastPushAt: Long?,
    val serverUrl: String,
    /** 開発用の上書き。なければ既定値 */
    val serverOverride: String?,
    val confirmLost: Long?,
)

class SyncController(
    private val db: SyncSql,
    private val keyStore: SyncKeyStore,
    private val transport: SyncTransport,
    private val defaultServerUrl: String,
    private val adapters: List<SyncAdapter>,
    private val now: () -> Long,
    private val allowLocalhost: Boolean = false,
    /** 鍵保管に値があるかもしれない。使ったことのない人の鍵保管を開かないための控え */
    private val keyHint: () -> Boolean,
    /** /start の窓を開く。許可証か、閉じたら null */
    private val openStartWindow: suspend (String) -> String?,
    private val onCycle: (CycleResult) -> Unit = {},
) {
    private val t = SyncTables(db)
    private var engineValue: SyncEngine? = null
    private var engineUrl = ""
    private var spaceHead: String? = null

    private fun overrideUrl(): String? = t.state("server_url")
    private fun serverUrl(): String = overrideUrl() ?: defaultServerUrl
    private fun isEnabled() = t.state("enabled") == "1"
    private fun isMasterOn() = masterOn(t.state("master"), t.state("enabled"))
    private fun onAdapters(): List<SyncAdapter> {
        val off = offKindsOf(parseSwitches(t.state("kinds")))
        return adapters.filter { it.kind !in off }
    }

    private suspend fun engine(): SyncEngine {
        val url = serverUrl()
        val cur = engineValue
        if (cur != null && engineUrl == url) return cur
        // 古い先へ走っている周を残さない
        cur?.halt()
        engineUrl = url
        return SyncEngine(db = db, keyStore = keyStore, transport = transport, serverUrl = url, adapters = adapters, now = now, allowLocalhost = allowLocalhost).also { engineValue = it }
    }

    private suspend fun run(manual: Boolean): CycleResult = engine().runCycle(manual).also(onCycle)

    private suspend fun loadKeys(): SyncKeyMaterial? = try {
        keyStore.load()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        throw SyncHostError("key_store_unavailable")
    }

    private suspend fun pair(k: ByteArray, ticket: String) {
        try {
            engine().pair(k, ticket)
        } catch (e: CancellationException) {
            throw e
        } catch (e: SyncApiError) {
            throw e
        } catch (_: Exception) {
            throw SyncHostError("key_store_unavailable")
        }
    }

    private fun spaceOf(k: ByteArray) = spaceId(deriveKeys(k).authToken)

    suspend fun status(): SyncStatus {
        val enabled = isEnabled()
        val kinds = parseSwitches(t.state("kinds"))
        val off = offKindsOf(kinds).toList()
        val skip = if (off.isEmpty()) "" else " AND kind NOT IN (${off.joinToString(", ") { "?" }})"
        // 切っている種類は送らないので数えない
        val pending = db.query("SELECT (SELECT COUNT(*) FROM sync_records WHERE pending = 1$skip) + (SELECT COUNT(*) FROM sync_ops) AS n", off).firstOrNull()?.get("n") as? Long ?: 0L
        val master = isMasterOn()
        val lastError = t.state("last_error")
        // 切っている間は鍵保管を開かない
        if (enabled && master && spaceHead == null) {
            val m = try { keyStore.load() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (m != null) spaceHead = spaceOf(m.k).take(12)
        }
        val running = engineValue?.state
        @Suppress("UNCHECKED_CAST")
        val confirm = t.state("pending_confirm")?.let { (parseStrictJson(it) as Map<String, Any?>)["lost"] as? Long ?: 0L }
        return SyncStatus(
            enabled = enabled,
            master = master,
            kinds = kinds,
            state = if (!enabled || !master) "off" else if (running == null || running == "off") t.state("phase") ?: "idle" else running,
            space = if (enabled) spaceHead else null,
            pending = pending,
            lastError = lastError,
            lastErrorText = lastError?.let(SyncText::message),
            lastPullAt = t.state("last_pull_at")?.toLongOrNull(),
            lastPushAt = t.state("last_push_at")?.toLongOrNull(),
            serverUrl = serverUrl(),
            serverOverride = overrideUrl(),
            confirmLost = confirm,
        )
    }

    /** 同期を始める。1 台目は K を作り、窓を閉じたら捨てる。止まっている領域は同じ K で確認を通し直す */
    suspend fun start(): CycleResult {
        if (!isMasterOn()) throw SyncHostError("sync_off")
        val url = checkServerUrl(serverUrl(), allowLocalhost)
        val material = loadKeys()
        val resuming = material != null && isEnabled()
        val k = if (resuming) material!!.k else generateMasterKey()
        val id = spaceOf(k)
        val ticket = openStartWindow("$url/start?space_id=$id&return=app") ?: throw SyncHostError("cancelled")
        if (ticketSpaceId(ticket) != id) throw SyncHostError("bad_ticket")
        if (resuming) engine().setTicket(ticket) else pair(k, ticket)
        spaceHead = id.take(12)
        return run(true)
    }

    /** QR とコピー用のコードの中身。表示は 60 秒で消す */
    suspend fun pairingCode(): String {
        if (!isEnabled()) throw SyncHostError("already_on")
        val m = loadKeys() ?: throw SyncHostError("key_store_unavailable")
        val ticket = m.ticket ?: throw SyncHostError("ticket_required")
        return encodePairingCode(PairingCode(m.k, serverUrl(), ticket))
    }

    suspend fun join(code: String): CycleResult {
        if (!isMasterOn()) throw SyncHostError("sync_off")
        if (isEnabled()) throw SyncHostError("already_on")
        val c = parsePairingCode(code, allowLocalhost)
        loadKeys()
        engineValue?.halt()
        writeServerUrl(c.serverUrl)
        pair(c.k, c.ticket)
        spaceHead = spaceOf(c.k).take(12)
        return run(true)
    }

    suspend fun syncNow(): CycleResult = run(true)

    /** 前面に戻ったとき。pull の間隔はエンジンが守る。使っていないなら何もしない */
    suspend fun foreground(): CycleResult? {
        if (!autoEnabled()) return null
        return run(false)
    }

    /** オフの間は通信も積みも起きない。鍵と領域は残すので、オンに戻せば続きから動く */
    suspend fun setMaster(on: Boolean) {
        engine().setMaster(on)
        if (on && isEnabled()) run(true)
    }

    suspend fun setKind(group: String, on: Boolean) {
        engine().setKind(group, on)
        if (on && isEnabled() && isMasterOn()) run(true)
    }

    suspend fun leave() {
        engine().leave()
        spaceHead = null
    }

    /** 自動の同期の口。周の結果は手動と同じ流れで画面へ渡す */
    suspend fun autoCycle() {
        run(false)
    }

    suspend fun autoCheck(): Boolean = engine().checkHead()

    suspend fun hasChanges(): Boolean = engine().hasChanges()

    fun autoEnabled(): Boolean = t.state("master") != "0" && (isEnabled() || keyHint())

    fun pace(): SyncPace? = engineValue?.pace

    private suspend fun adapterContext(): AdapterContext? {
        // 使っていない間は鍵保管を開かない
        if (!isEnabled() || !isMasterOn()) return null
        val m = try { keyStore.load() } catch (e: CancellationException) { throw e } catch (_: Exception) { null } ?: return null
        return AdapterContext(deriveKeys(m.k), m.deviceId, now())
    }

    /** 種類ごとの件数とハッシュ。本文や URL は出さない */
    suspend fun summary(): SyncSummary? = adapterContext()?.let { syncSummary(db, onAdapters(), it) }

    /** 手元と同期の表の違いを数える。件数によって時間がかかるので押したときだけ */
    suspend fun mismatches(): MismatchSummary? = adapterContext()?.let { syncMismatches(db, onAdapters(), it) }

    suspend fun resolveConfirm(choice: String): CycleResult {
        engine().resolveConfirm(choice)
        return run(true)
    }

    private fun writeServerUrl(url: String) {
        db.batch(listOf(if (url == defaultServerUrl) delState("server_url") else setState("server_url", url)))
    }

    /**
     * 空で既定値に戻す。使っている間に変えたら、新しい先に領域がないかもしれないので全件を合わせ直す。
     * 手元のレコードを消さず、version は計画が決め直す
     */
    suspend fun setServerUrl(url: String) {
        val next = if (url.isBlank()) defaultServerUrl else checkServerUrl(url.trim(), allowLocalhost)
        if (next == serverUrl()) return
        engineValue?.halt()
        val stmts = arrayListOf(if (next == defaultServerUrl) delState("server_url") else setState("server_url", next))
        if (isEnabled()) stmts += listOf(setState("since", "0"), setState("recreate_pending", "1"), delState("epoch"), delState("gc_floor"), delState("push_inflight"), delState("last_error"))
        db.batch(stmts)
    }
}
