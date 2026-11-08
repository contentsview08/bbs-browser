package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.DEV_KIND
import io.github.contentsview08.obb.sync.DeviceCheck
import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.LAST_VIEWED_FIELD
import io.github.contentsview08.obb.sync.LocalRecord
import io.github.contentsview08.obb.sync.RecordContext
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.SyncError
import io.github.contentsview08.obb.sync.SyncKeys
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.adapters.AdapterContext
import io.github.contentsview08.obb.sync.adapters.AREA_FAVORITE_THREADS
import io.github.contentsview08.obb.sync.adapters.OpTarget
import io.github.contentsview08.obb.sync.adapters.ApplyPlan
import io.github.contentsview08.obb.sync.adapters.DroppedThread
import io.github.contentsview08.obb.sync.adapters.IMAGE_KIND
import io.github.contentsview08.obb.sync.adapters.LAST_VIEW_KIND
import io.github.contentsview08.obb.sync.adapters.POST_KIND
import io.github.contentsview08.obb.sync.adapters.SyncAdapter
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.checkDeviceId
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.deriveKeys
import io.github.contentsview08.obb.sync.generateDeviceId
import io.github.contentsview08.obb.sync.hlc
import io.github.contentsview08.obb.sync.kind
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.mergePayloads
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.openRecords
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.planRebase
import io.github.contentsview08.obb.sync.planRecreate
import io.github.contentsview08.obb.sync.sealPayload
import io.github.contentsview08.obb.sync.settleRecord
import io.github.contentsview08.obb.sync.spaceId
import io.github.contentsview08.obb.sync.toBase64Url
import io.github.contentsview08.obb.sync.toHex
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.security.SecureRandom
import kotlin.math.ceil
import kotlin.random.Random

// 同期エンジン。PC 版の packages/sync/src/engine/engine.ts と同じ順番で動く。周の順は必ず draining → pull → apply → push

/** ticket は領域の作成の許可証。k と一緒に動くので一緒に置く。これだけでは領域を作れない(トークンが要る) */
class SyncKeyMaterial(val k: ByteArray, val deviceId: String, val ticket: String?)

/** Android Keystore で包んで専用の Prefs に置く(data/SyncKeyVault.kt)。k を同期の表にも settings の Prefs にも置かない */
interface SyncKeyStore {
    suspend fun load(): SyncKeyMaterial?
    suspend fun save(v: SyncKeyMaterial)
    suspend fun clear()
}

/** 画面に出す確認。join・rebase は適用の前に止まる確認、join_data は参加で手元を送る前の確認(host はふだんと違うサーバーのとき) */
class SyncConfirm(val type: String, val lost: Long, val host: String? = null)

class CycleResult {
    var state = "off"
    var pulled = 0
    var pushed = 0
    var conflicts = 0

    /** 画面が読み直すもの。値はアダプターの area。適用で手元が変わったときだけ入る */
    val applied = HashSet<String>()
    val favoriteThreads get() = AREA_FAVORITE_THREADS in applied

    /** 他の端末のログの削除が写って、手元の行を消したスレ。画面が閉じるのはこれだけ */
    val dropped = ArrayList<DroppedThread>()

    /** 周を始めなかった理由 */
    var skipped: String? = null

    /** 参加で手元を送る前に止まった確認(周は回していない) */
    var confirm: SyncConfirm? = null
}

private class SpaceGone(val newEpoch: String? = null) : Exception("space_gone")
private class NeedsRebase : Exception("needs_rebase")
private class CycleStop(val state: String) : Exception("stop")

private class ServerMeta(val kindTag: String, val schemaVersion: Long)

private class FullRead {
    val full = LinkedHashMap<String, LocalRecord>()
    val meta = HashMap<String, ServerMeta>()
    var head = 0L
    var gcFloor = 0L
    /** 途中で打ち切ったときの原因。読めた分は使う */
    var failure: Exception? = null
}

private class Prepared(val requestId: String, val rows: List<StoredRecord>, val sent: Map<String, String>)

private fun refsFromBody(p: SyncPayload, detail: String?): RecordRefs {
    val board = p.body?.get("board_url") as? String
    return RecordRefs(board?.let(::normalizeBoardUrl), p.body?.get("thread") as? String, detail)
}

/** 容量を超えたとき外す順。お気に入り・NG・設定・リセットは外さない */
private val TRIM_ORDER = listOf(listOf(LAST_VIEW_KIND, DEV_KIND), listOf(IMAGE_KIND), listOf(POST_KIND))

private fun same(a: SyncPayload, b: SyncPayload) = canonicalJson(a) == canonicalJson(b)

/** 権限系だけ k_secret で封をする */
private fun tagOfKind(kind: String) = if (kind == SECRET_KIND) "s" else "h"

/** 応答に待ち時間がないときの、権限系の読み直しの間隔 */
private const val REFETCH_RETRY_MS = 3_600_000L

@Suppress("UNCHECKED_CAST")
class SyncEngine(
    private val db: SyncSql,
    private val keyStore: SyncKeyStore,
    private val transport: SyncTransport,
    private val serverUrl: String,
    private val adapters: List<SyncAdapter>,
    private val now: () -> Long,
    private val newDeviceId: () -> String = ::generateDeviceId,
    private val newRequestId: () -> String = { toBase64Url(ByteArray(16).also { SecureRandom().nextBytes(it) }) },
    /** 0 以上 1 未満 */
    private val jitter: () -> Double = { Random.nextDouble() },
    private val allowLocalhost: Boolean = false,
    private val onState: (String) -> Unit = {},
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val t = SyncTables(db)
    private val kinds = adapters.map { it.kind }.distinct()
    private val opNames = adapters.flatMap { it.ops }
    private val mutex = Mutex()

    @Volatile var state = "off"
        private set

    /** サーバーの指示。覚えておくので、304 の間も効く */
    @Volatile var pace: SyncPace? = null
        private set

    /** 別の領域へ移る途中。走っている周を次の区切りで止め、古い領域の受信を新しい表に混ぜない */
    @Volatile private var halting = false
    /** 直前の確認が「変化なし」(304 か同じ version)だった時刻。自動の周で pull を省く根拠 */
    private var headFreshAt = 0L

    @Volatile private var again = false
    @Volatile private var againManual = false
    @Volatile private var againQuick = false
    private var last = CycleResult()
    private var deviceChecked = false
    private var reconciled = false
    private var filled = false
    private var attempts = 0
    private var retryAt = 0L
    /** 送信だけの待ち。/records の 429(日の件数の上限など)では pull と確認を止めない */
    @Volatile private var pushRetryAt = 0L
    /** この周で送信を後回しにした理由。周が通っても画面に出す */
    private var pushDeferred: String? = null
    private var applyFailures = 0

    // 周の間だけ持つ
    private lateinit var keys: SyncKeys
    private lateinit var api: SyncApi
    private var spaceIdValue = ""
    private var deviceId = ""
    private lateinit var result: CycleResult

    /** この周で切っている種類。周の途中で切り替えるときは halted で周を終わらせてから書く */
    private var offKinds: Set<String> = emptySet()

    private fun enter(s: String) {
        state = s
        onState(s)
    }

    /** 送るものがあるか。通信しない。切っている種類の送信待ちは数えない(自動の同期を空回りさせない) */
    suspend fun hasChanges(): Boolean = withContext(io) {
        if (!isMasterOn() || now() < pushRetryAt) return@withContext false
        t.pendingCount(offKindsOf(switches()), opNames) > 0
    }

    private fun isMasterOn() = masterOn(t.state("master"), t.state("enabled"))

    private fun switches() = parseSwitches(t.state("kinds"))

    /** 同期自体のスイッチ。切っても鍵と領域は残す。戻したら切っていた間の手元の行を補う */
    suspend fun setMaster(on: Boolean) = withContext(io) {
        halted {
            val stmts = arrayListOf(setState("master", if (on) "1" else "0"))
            if (on && t.state("enabled") == "1") {
                val sw = switches()
                stmts += setState("kinds_resume", canonicalJson(SYNC_GROUPS.filter { sw[it.id] == true }.map { it.id }))
            }
            db.batch(stmts)
            headFreshAt = 0
        }
    }

    /**
     * 種類ごとのスイッチ。切ってもサーバーのデータは消さない。
     * 権限系を切ったら同期の表の平文を残さない(手元の削除ページは残るので、オンに戻せば作り直せる)
     */
    suspend fun setKind(group: String, on: Boolean) = withContext(io) {
        halted {
            val sw = switches().toMutableMap()
            if (sw[group] == on) return@halted
            sw[group] = on
            val saved = SYNC_GROUPS.filter { sw[it.id] != it.default }.associate { it.id to sw[it.id] }
            val resume = (t.state("kinds_resume")?.let { parseStrictJson(it) as List<*> }.orEmpty()).map { it as String }.toMutableSet()
            if (on) resume += group else resume -= group
            val stmts = arrayListOf(setState("kinds", canonicalJson(saved)), if (resume.isEmpty()) delState("kinds_resume") else setState("kinds_resume", canonicalJson(resume.toList())))
            if (group == "secret") {
                if (on) stmts += setState("secret_refetch", "0")
                else stmts += listOf(delState("secret_refetch"), SqlStatement("DELETE FROM sync_records WHERE kind = ?", listOf(SECRET_KIND)), SqlStatement("DELETE FROM sync_ops WHERE op IN ('secret_put', 'secret_remove')"), delState("push_inflight"))
            }
            db.batch(stmts)
        }
    }

    /** 走っている周を止めて、終わるまで待つ。その後で block を動かす間は次の周も入れない(裏のスレッドで周と表の削除が重ならないように) */
    private suspend fun <T> halted(block: suspend () -> T): T {
        halting = true
        again = false
        againManual = false
        try {
            return mutex.withLock { block() }
        } finally {
            halting = false
        }
    }

    /** 表を消す・別の領域へ移るときはこれを先に通す */
    suspend fun halt() = withContext(io) { halted { } }

    /** 確認に付ける ETag。覚えずに手元の since と epoch から作る(周が失敗しても、送った分だけ since を進めても、ずれない) */
    private fun headEtag(): String? = t.state("epoch")?.let { "\"$it:${t.state("since")?.toLong() ?: 0L}\"" }

    /** GET /head。変化があれば true(次に周を回す)。変化なし・通信の失敗は false。周が走っていれば確かめない */
    suspend fun checkHead(): Boolean = withContext(io) {
        if (!mutex.tryLock()) return@withContext false
        try {
            if (t.state("enabled") != "1" || !isMasterOn() || t.state("phase") != "idle" || now() < retryAt) return@withContext false
            val material = keyStore.load() ?: return@withContext false
            val head = SyncApi(serverUrl, deriveKeys(material.k).authToken.toHex(), transport, allowLocalhost)
            try {
                val r = head.head(headEtag())
                head.pace?.let { pace = it }
                val version = r.version
                if (version == null) {
                    headFreshAt = now()
                    return@withContext false
                }
                val since = t.state("since")?.toLong() ?: 0L
                val changed = version > since || (r.gcFloor ?: 0L) > since || r.epoch != t.state("epoch")
                headFreshAt = if (changed) 0 else now()
                changed
            } catch (e: SyncApiError) {
                // 404・401 は周の流れ(作り直し・止める)で扱う
                if (e.kind == "http" && (e.status == 404 || e.status == 401)) {
                    headFreshAt = 0
                    return@withContext true
                }
                if (e.kind == "http" && e.status == 429) waitFor(e) else retryAt = now() + SyncConfig.backoffDelayMs(attempts++, jitter())
                false
            }
        } finally {
            mutex.unlock()
        }
    }

    /** 429 の応答の指示より早く試さない。ただし RETRY_WAIT_MAX_MS より長くは待たない */
    private fun waitFor(e: SyncApiError) {
        retryAt = now() + waitMs(e)
    }

    /** 掛ける前に丸めるので、大きな値でも Long があふれない */
    private fun waitMs(e: SyncApiError): Long {
        val sec = (e.detail?.get("retry_after_sec") as? Number)?.toDouble()
        val told = if (sec != null && sec.isFinite() && sec > 0) ceil(minOf(sec * 1000, SyncConfig.RETRY_WAIT_MAX_MS.toDouble())).toLong() else 0L
        return minOf(SyncConfig.RETRY_WAIT_MAX_MS, maxOf(told, SyncConfig.backoffDelayMs(attempts++, jitter())))
    }

    /** 長い周の途中で止められていたら、区切りで抜ける */
    private fun keepRunning() {
        if (halting) throw CycleStop("idle")
    }

    /** 走っている間のきっかけは「もう 1 周」の印にする */
    /**
     * 走っている間のきっかけは「もう 1 周」にまとめる。
     * quick は確認の時計と裏に回る瞬間の周。直前の確認が「変化なし」なら pull を省く(前面復帰・手動は省かない)
     */
    suspend fun runCycle(manual: Boolean = false, quick: Boolean = false): CycleResult = withContext(io) {
        if (!mutex.tryLock()) {
            againQuick = if (again) againQuick && quick else quick
            againManual = againManual || manual
            again = true
            return@withContext mutex.withLock {
                if (again) runAgain()
                last
            }
        }
        try {
            last = cycle(manual, quick)
            while (again) runAgain()
            last
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun runAgain() {
        val m = againManual
        val q = againQuick
        again = false
        againManual = false
        againQuick = false
        val prev = last
        val next = cycle(m, q)
        // 画面が読み直す印を前の周の分まで渡す
        next.pulled += prev.pulled
        next.pushed += prev.pushed
        next.conflicts += prev.conflicts
        next.applied += prev.applied
        next.dropped.addAll(0, prev.dropped)
        last = next
    }

    private fun checkTicketFor(k: ByteArray, ticket: String) {
        if (ticketSpaceId(ticket) != spaceId(deriveKeys(k).authToken)) throw SyncApiError("bad_ticket")
    }

    /** 同期を始めるページから受け取った許可証を置く。止まっていれば次の手動の同期で続く */
    suspend fun setTicket(ticket: String) = withContext(io) {
        val material = keyStore.load() ?: throw SyncApiError("bad_ticket")
        checkTicketFor(material.k, ticket)
        keyStore.save(SyncKeyMaterial(material.k, material.deviceId, ticket))
    }

    /** 使い始め。鍵と端末 ID を保管してから enabled を立てる。ここから利用者の操作が積まれ始める */
    suspend fun pair(k: ByteArray, ticket: String?) = withContext(io) {
        if (ticket != null) checkTicketFor(k, ticket)
        halted {
            headFreshAt = 0
            pace = null
            val id = newDeviceId()
            keyStore.save(SyncKeyMaterial(k, id, ticket))
            db.batch(joinStatements(id))
            deviceChecked = true
            reconciled = false
            filled = false
        }
    }

    private fun joinStatements(id: String) = listOf(setState("device_id", id), setState("clock", Hlc.ZERO), setState("since", "0"), setState("phase", "joining"), setState("enabled", "1"), delState("master"), delState("kinds_resume"))

    /** この端末で同期をやめる。手元のデータは消さない */
    suspend fun leave() = withContext(io) {
        halted {
            headFreshAt = 0
            pace = null
            clearTables()
            keyStore.clear()
            enter("off")
        }
    }

    /** サーバーの URL の上書きも消す。参加のコードで入った先に、やめたあとも向いたままにしない */
    private fun clearTables() = db.batch(listOf(SqlStatement("DELETE FROM sync_records"), SqlStatement("DELETE FROM sync_ops"), SqlStatement("DELETE FROM sync_state")))

    /**
     * 確認の答え。合流で keep_local は「進まない」なのでやめる。
     * リベースの keep_local は手元を消さず、領域が消えたときと同じく全部を合わせ直して送る
     */
    suspend fun resolveConfirm(choice: String) = withContext(io) {
        val raw = t.state("pending_confirm") ?: return@withContext
        val plan = parseStrictJson(raw) as Map<String, Any?>
        if (plan["type"] == "join") {
            if (choice == "keep_local") {
                clearTables()
                keyStore.clear()
                enter("off")
            } else db.batch(listOf(delState("pending_confirm"), setState("phase", "idle")))
        } else if (choice == "accept_removal") {
            db.batch(listOf(delState("pending_confirm"), setState("phase", "idle"), setState("rebase_accepted", (plan["lost"] as Long).toString())))
        } else {
            db.batch(listOf(delState("pending_confirm"), setState("phase", "idle"), setState("recreate_pending", "1"), setState("since", "0")))
        }
    }

    private suspend fun cycle(manual: Boolean, quick: Boolean): CycleResult {
        val r = CycleResult()
        result = r
        pushDeferred = null
        if (halting) {
            r.skipped = "halting"
            return r
        }
        fun finish(s: String): CycleResult {
            enter(s)
            r.state = s
            return r
        }
        // 切っている間は鍵保管にも通信にも触らない
        if (t.state("master") == "0") return finish("off")
        if (!deviceChecked && !checkDevice()) return finish("off")
        if (t.state("enabled") != "1") return finish("off")
        val material = keyStore.load() ?: return finish("off")
        keys = deriveKeys(material.k)
        spaceIdValue = spaceId(keys.authToken)
        deviceId = material.deviceId
        offKinds = offKindsOf(switches())

        var phase = t.state("phase") ?: "joining"
        if (phase == "confirm") return finish("confirm")
        if (phase == "blocked") {
            if (!manual) return finish("blocked")
            phase = t.state("phase_before") ?: "idle"
            db.batch(listOf(setState("phase", phase), delState("phase_before")))
        }
        if (phase == "recreate_waiting" && !manual) {
            val tried = t.state("recreate_tried_at")?.toLong() ?: 0
            if (now() - tried < SyncConfig.RECREATE_RETRY_MS) {
                r.skipped = "waiting"
                return finish("recreate_waiting")
            }
        }
        if (!manual && now() < retryAt) {
            r.skipped = "backoff"
            return finish(if (state == "offline") "offline" else "backoff")
        }
        return try {
            api = SyncApi(serverUrl, keys.authToken.toHex(), transport, allowLocalhost)
            enter("draining")
            drain()
            flow(manual, quick)
            api.pace?.let { pace = it }
            attempts = 0
            retryAt = 0
            val deferred = pushDeferred
            if (deferred != null) noteError(deferred) else db.exec("DELETE FROM sync_state WHERE key = ?", listOf("last_error"))
            finish("idle")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            finish(failed(e))
        }
    }

    private fun failed(e: Exception): String {
        if (e is CycleStop) return e.state
        var code = "internal"
        var next = "backoff"
        if (e is SyncApiError) {
            if (e.kind == "bad_url") return block("bad_url")
            if (e.kind == "http" && e.status == 401) return block("auth_failed")
            code = if (e.kind == "http") e.code.ifEmpty { "http_${e.status}" } else e.kind
            if (e.kind == "network") next = "offline"
            // 再送しない 4xx。次のきっかけでまた試す
            if (e.kind == "http" && e.status in 400..499 && e.status != 429) {
                noteError(code)
                return "idle"
            }
        }
        noteError(code)
        if (e is SyncApiError && e.kind == "http" && e.status == 429) waitFor(e) else retryAt = now() + SyncConfig.backoffDelayMs(attempts++, jitter())
        return next
    }

    private fun noteError(code: String) {
        try {
            putState("last_error", code)
        } catch (_: Exception) {
            // DB が止まっているときは画面に出す値を諦める
        }
    }

    private fun block(code: String): String {
        val phase = t.state("phase") ?: "idle"
        db.batch(listOfNotNull(setState("phase", "blocked"), if (phase == "blocked") null else setState("phase_before", phase), setState("last_error", code)))
        return "blocked"
    }

    /** 別の端末の DB を入れると同じ device_id が 2 台でき、read_dev がぶつかる */
    private suspend fun checkDevice(): Boolean {
        deviceChecked = true
        val material = keyStore.load()
        return when (checkDeviceId(material?.deviceId, t.state("device_id"))) {
            DeviceCheck.NONE -> false
            DeviceCheck.OK -> true
            DeviceCheck.CLEAR -> {
                clearTables()
                false
            }
            DeviceCheck.REJOIN -> {
                val id = newDeviceId()
                keyStore.save(SyncKeyMaterial(material!!.k, id, material.ticket))
                clearTables()
                db.batch(joinStatements(id))
                true
            }
        }
    }

    private fun putState(key: String, value: String) {
        val s = setState(key, value)
        db.exec(s.sql, s.args)
    }

    private fun ctx() = AdapterContext(keys, deviceId, now())

    private fun onAdapters() = adapters.filter { it.kind !in offKinds }

    private fun refsOfBody(p: SyncPayload): RecordRefs {
        val detail = adapters.firstNotNullOfOrNull { a -> if (a.kind == p.kind) a.detailOf(p) else null }
        return refsFromBody(p, detail)
    }

    /** sync_ops を前から処理する。適用と入れ違った操作でも手元が揃うよう、needs_apply を立てて写し直す */
    private fun drain() {
        while (true) {
            val ops = t.ops(opNames, SyncConfig.WRITE_BATCH)
            if (ops.isEmpty()) return
            val c = ctx()
            var clock = t.state("clock") ?: Hlc.ZERO
            val stmts = ArrayList<SqlStatement>()
            val touched = LinkedHashMap<String, StoredRecord>()
            fun put(target: OpTarget, atMs: Long, floor: String?, make: (SyncPayload?, String) -> SyncPayload?) {
                val existing = touched[target.recordId] ?: t.record(target.recordId)
                val before = existing?.payload?.hlc
                val stamped = Hlc.stamp(clock, atMs, deviceId, if (floor != null && (before == null || Hlc.compare(floor, before) > 0)) floor else before)
                val payload = make(existing?.payload, stamped.stamp) ?: return
                if (checkPayload(payload) == null) {
                    countBad("local")
                    return
                }
                clock = stamped.clock
                val settled = settleRecord(payload, existing?.version ?: 0, existing?.asLocal(), c.now)
                val refs = target.refs.over(existing?.refs)
                touched[target.recordId] = StoredRecord(
                    target.recordId, payload.kind, existing?.kindTag ?: tagOfKind(payload.kind), existing?.schemaVersion ?: SyncConfig.SCHEMA_VERSION, payload, settled.version,
                    pending = true, priority = 0, needsApply = true, refs.board, refs.thread, refs.detail, refs.local, settled.tombAt,
                )
            }
            for (op in ops) {
                val adapter = adapters.first { op.op in it.ops }
                // 権限系は切ったあとに残った操作も処理しない。ほかの種類は切る前の変更なので、送信待ちとして持ち続ける
                if (adapter.kind == SECRET_KIND && SECRET_KIND in offKinds) {
                    stmts += delOp(op)
                    continue
                }
                if (adapter.expands) {
                    // 前の操作の結果を読むので、先に書いてから 1 件だけで処理する
                    if (touched.isNotEmpty()) break
                    stmts += delOp(op)
                    try {
                        val effects = adapter.expand(op, c)
                        if (effects == null) countBad("local")
                        for (e in effects.orEmpty()) put(e.target, op.atMs, e.floor, e.make)
                    } catch (_: SyncError) {
                        dropBadOp()
                        touched.clear()
                    }
                    break
                }
                stmts += delOp(op)
                val target = adapter.target(op, c)
                if (target == null) {
                    countBad("local")
                    continue
                }
                try {
                    put(target, op.atMs, null) { existing, stamp -> adapter.fromOp(op, existing, stamp, c) }
                } catch (_: SyncError) {
                    dropBadOp()
                }
            }
            for (r in touched.values) stmts += writeRecord(r)
            stmts += setState("clock", clock)
            db.batch(stmts)
        }
    }

    /**
     * 値から作れない操作(壁時計が上限の HLC を上書きするなど)は捨てて数える。残すと周の最初で毎回止まり、同期全体が動かなくなる。
     * DB の読み取りの失敗などは一時的なので、SyncError 以外は捕まえず、操作を残したまま周を失敗させる
     */
    private fun dropBadOp() = countBad("local")

    private fun countBad(reason: String) {
        val raw = t.state("bad_counts")
        val counts = LinkedHashMap((if (raw != null) parseStrictJson(raw) as Map<String, Any?> else emptyMap()))
        counts[reason] = ((counts[reason] as? Long) ?: 0L) + 1
        putState("bad_counts", canonicalJson(counts))
    }

    private suspend fun flow(manual: Boolean, quick: Boolean) {
        // 作り直しとリベースは周の中で 1 度ずつあれば足りる。それ以上はサーバーがおかしいので次の周へ回す
        for (i in 0 until 4) {
            try {
                step(manual, quick)
                return
            } catch (e: SpaceGone) {
                onSpaceGone(e)
            } catch (_: NeedsRebase) {
                rebase()
            }
        }
        throw SyncApiError("bad_response")
    }

    private suspend fun step(manual: Boolean, quick: Boolean) {
        var phase = t.state("phase") ?: "joining"
        if (phase == "recreate_waiting") throw SpaceGone()
        var pulled = false
        var seeded = false
        if (t.state("recreate_pending") == "1") {
            finishRecreate()
            pulled = true
        }
        if (phase == "joining") {
            enter("joining")
            pull(true)
            putState("phase", "seeding")
            phase = "seeding"
            pulled = true
        }
        // 権限系のレコードは切っている間は開かずに読み飛ばしたので、最初から読み直す
        if ((t.state("secret_refetch")?.toLongOrNull() ?: Long.MAX_VALUE) <= now() && refetchSecrets()) pulled = true
        if (phase == "seeding") {
            enter("seeding")
            seedAndPlan()
            db.batch(listOf(delState("kinds_resume")))
            seeded = true
        } else {
            catchUp()
        }
        if (!seeded && !reconciled) reconcile()
        reconciled = true
        if (!seeded && (manual || !filled)) fillMissing()
        filled = true
        val at = now()
        if (!pulled && (manual || (at - (t.state("last_pull_at")?.toLong() ?: 0) >= SyncConfig.PULL_MIN_GAP_MS && !(quick && headIsFresh(at))))) pull(false)
        applyAll()
        pushAll(manual)
        // 409 のマージでサーバーの値が勝つと、手元へ写すものが増える
        if (result.conflicts > 0) applyAll()
    }

    /**
     * 直前の確認が「変化なし」で、確認の間隔がまだ過ぎていないか。
     * 確認の時計は前の確認が終わってから数えるので、次の周は間隔よりわずかに遅れて来る。その分 PULL_MIN_GAP_MS を足す。
     * 省いた間に他の端末が同じレコードを書いていれば 409 で分かり、マージして読み直す
     */
    private fun headIsFresh(at: Long): Boolean = headFreshAt > 0 && at - headFreshAt < paceMs(pace).head + SyncConfig.PULL_MIN_GAP_MS

    /** pull。joining の全件の読み取りではリベースを見ない(since = 0 がすでに全件なので) */
    private suspend fun pull(joining: Boolean) {
        var since = t.state("since")?.toLong() ?: 0
        while (true) {
            enter("pulling")
            keepRunning()
            val page = call { api.changes(since) }
            checkEpoch(page.epoch)
            if (!joining && since > 0 && page.gcFloor > since) throw NeedsRebase()
            val lastVersion = maxVersion(page.records, since)
            val next = if (page.more) lastVersion else maxOf(lastVersion, page.head)
            if (page.more && next <= since) throw SyncApiError("no_progress")
            enter("merging")
            keepRunning()
            mergePage(page.records, next, page.gcFloor)
            since = next
            if (!page.more) return
        }
    }

    private fun maxVersion(records: List<Map<String, Any?>>, from: Long): Long = records.fold(from) { m, r -> (r["version"] as? Long)?.let { maxOf(m, it) } ?: m }

    /** 404 だけ領域がないと読み替える。ほかの失敗はそのまま周の失敗にする */
    private suspend fun <T> call(f: suspend () -> T): T = try {
        f()
    } catch (e: SyncApiError) {
        if (e.kind == "http" && e.status == 404) throw SpaceGone() else throw e
    }

    /** 全応答の epoch を見る。初めて見る値はそのまま覚える */
    private fun checkEpoch(epoch: String) {
        val known = t.state("epoch")
        if (known == null) putState("epoch", epoch) else if (known != epoch) throw SpaceGone(epoch)
    }

    /** 権限系を切っている端末は開かない。version は呼ぶ側が数えるので、読み飛ばしてもページングは進む */
    private fun readable(raw: List<Map<String, Any?>>) = if (SECRET_KIND in offKinds) raw.filter { it["kind_tag"] != "s" } else raw

    private fun mergePage(raw: List<Map<String, Any?>>, since: Long, gcFloor: Long) {
        val at = now()
        val page = readable(raw)
        val opened = openRecords(keys, spaceIdValue, page)
        val metaOf = page.associateBy { it["record_id"] as? String }
        val local = t.records(opened.records.map { it.recordId })
        var clock = t.state("clock") ?: Hlc.ZERO
        val stmts = ArrayList<SqlStatement>()
        for (rec in opened.records) {
            val m = metaOf.getValue(rec.recordId)
            val row = merged(local[rec.recordId], rec.recordId, rec.payload, rec.version, ServerMeta(m["kind_tag"] as String, m["schema_version"] as Long), at)
            local[rec.recordId] = row
            stmts += writeRecord(row)
            clock = Hlc.observe(clock, rec.payload.hlc, at)
        }
        for (f in opened.failed) countBad(f.reason)
        // since はレコードと同じバッチで進むので、途中までは有効
        stmts += listOf(setState("since", since.toString()), setState("clock", clock), setState("gc_floor", gcFloor.toString()), setState("last_pull_at", at.toString()))
        db.batch(stmts)
        result.pulled += opened.records.size
    }

    /** 受け取った 1 件を手元と合わせる。手元の方が新しければ送り直す。変わったものだけ写す */
    private fun merged(l: StoredRecord?, id: String, server: SyncPayload, version: Long, meta: ServerMeta, at: Long): StoredRecord {
        val payload = if (l != null) mergePayloads(l.payload, server) else server
        val fromServer = same(payload, server)
        val settled = settleRecord(payload, maxOf(l?.version ?: 0, version), l?.asLocal(), at)
        val refs = refsOfBody(payload).over(l?.refs)
        return StoredRecord(
            id, payload.kind, if (fromServer) meta.kindTag else l!!.kindTag, if (fromServer) meta.schemaVersion else l!!.schemaVersion, payload, settled.version,
            pending = !fromServer, priority = l?.priority ?: 5, needsApply = l == null || !same(l.payload, payload) || l.needsApply,
            refs.board, refs.thread, refs.detail, refs.local, settled.tombAt,
        )
    }

    /** 種まきと合流の残り。古い HLC なので新しい削除に勝たない。ID が決まっているのでやり直しても重ならない */
    /** 全件の読み取りには 1 時間の回数の制限がある。断られても権限系の分だけ後回しにして、ほかの同期を止めない */
    private suspend fun refetchSecrets(): Boolean {
        val before = t.state("since") ?: "0"
        putState("since", "0")
        try {
            pull(true)
        } catch (e: SyncApiError) {
            if (e.kind != "http" || e.status != 429) throw e
            val sec = (e.detail?.get("retry_after_sec") as? Number)?.toDouble()
            val wait = if (sec != null && sec.isFinite() && sec > 0) ceil(minOf(sec * 1000, REFETCH_RETRY_MS.toDouble())).toLong() else REFETCH_RETRY_MS
            db.batch(listOf(setState("since", before), setState("secret_refetch", (now() + wait).toString())))
            return false
        }
        db.batch(listOf(delState("secret_refetch")))
        return true
    }

    /** 今のデータをレコードと合わせる。元の時刻の HLC なので、後から消したものには負け、切っていた間に増えたものは勝つ */
    private fun seedOne(adapter: SyncAdapter, c: AdapterContext) {
        // 件数の多い人でも 1 回の呼び出しを小さく保つ。ID が決まっているので途中で切れてもやり直せる
        for (chunk in adapter.seed(c).chunked(SyncConfig.WRITE_BATCH)) {
            val local = t.records(chunk.map { it.recordId })
            val stmts = ArrayList<SqlStatement>()
            for (r in chunk) {
                val l = local[r.recordId]
                val payload = if (l != null) mergePayloads(l.payload, r.payload) else r.payload
                val changed = l == null || !same(l.payload, payload)
                val settled = settleRecord(payload, l?.version ?: 0, l?.asLocal(), c.now)
                val refs = r.refs.over(l?.refs)
                stmts += writeRecord(
                    StoredRecord(
                        r.recordId, payload.kind, l?.kindTag ?: tagOfKind(payload.kind), l?.schemaVersion ?: SyncConfig.SCHEMA_VERSION, payload, settled.version,
                        pending = changed || (l?.pending ?: false), priority = l?.priority ?: r.priority, needsApply = l?.needsApply ?: false,
                        refs.board, refs.thread, refs.detail, refs.local, settled.tombAt,
                    ),
                )
            }
            if (stmts.isNotEmpty()) db.batch(stmts)
        }
    }

    /**
     * スイッチをオンに戻したあと。切っていた間に増えた手元の行を種まきで補い、切っていた間に受け取った分と手元の違いを全部写し直す。
     * 切っていた間の手元の削除は積んでいないので、同期の表の値へ戻る
     */
    private fun catchUp() {
        val raw = t.state("kinds_resume") ?: return
        val groups = (parseStrictJson(raw) as List<*>).map { it as String }.filter { g -> kindsOfGroups(listOf(g)).none { it in offKinds } }
        val c = ctx()
        val kinds = kindsOfGroups(groups)
        for (adapter in adapters) if (adapter.kind in kinds) seedOne(adapter, c)
        val mark = if (kinds.isEmpty()) emptyList() else listOf(SqlStatement("UPDATE sync_records SET needs_apply = 1 WHERE kind IN (${kinds.joinToString(", ") { "?" }})", kinds))
        db.batch(mark + delState("kinds_resume"))
    }

    private fun seedAndPlan() {
        val c = ctx()
        for (adapter in onAdapters()) seedOne(adapter, c)
        // 消えるものがなければ全件を見ない(種類ごとの exists は 1 件ごとに DB を読むので)
        fun count(where: (StoredRecord) -> Boolean): Long {
            var n = 0L
            for (adapter in onAdapters()) {
                for (r in t.recordsOfKind(adapter.kind)) {
                    if (where(r) && adapter.owns(r) && adapter.exists(r)) n++
                }
            }
            return n
        }
        val lost = count { it.needsApply && isDeleted(it.payload) && it.payload["trim"] != true }
        val total = if (lost > 0) count { true } else 0L
        if (lost > 0 && (lost >= SyncConfig.JOIN_CONFIRM_MIN || lost * 2 >= total)) {
            db.batch(listOf(setState("phase", "confirm"), setState("pending_confirm", canonicalJson(mapOf("type" to "join", "lost" to lost, "total" to total)))))
            throw CycleStop("confirm")
        }
        putState("phase", "idle")
    }

    /**
     * 起動後 1 回の照合。取りこぼしの保険なので、レコードのないものだけ低い HLC で作り、ほかは同期の表を正として写し直す。
     * レコードのあるものを手元から作らない(適用の時刻を持つ行が、まだ届いていない削除に勝ってしまう)
     */
    private fun reconcile() {
        // 切っている種類は照合しない(手元と違っていて正しい)
        val c = ctx()
        val stmts = ArrayList<SqlStatement>()
        for (adapter in onAdapters()) {
            if (!adapter.reconciles) continue
            val rows = adapter.seed(c)
            val local = t.records(rows.map { it.recordId })
            for (r in rows) {
                if (r.recordId in local) continue
                val settled = settleRecord(r.payload, 0, null, c.now)
                stmts += writeRecord(
                    StoredRecord(
                        r.recordId, r.payload.kind, tagOfKind(r.payload.kind), SyncConfig.SCHEMA_VERSION, r.payload, 0, pending = true, priority = r.priority, needsApply = false,
                        r.refs.board, r.refs.thread, r.refs.detail, r.refs.local, settled.tombAt,
                    ),
                )
            }
            for (r in t.recordsOfKind(adapter.kind)) {
                if (r.needsApply || !adapter.owns(r) || r.payload["trim"] == true) continue
                if (adapter.exists(r) == isDeleted(r.payload)) stmts += SqlStatement("UPDATE sync_records SET needs_apply = 1 WHERE record_id = ?", listOf(r.recordId))
            }
        }
        if (stmts.isNotEmpty()) db.batch(stmts)
    }

    /** 手元にあってレコードのない行を、種まきと同じ古い HLC で作る。消した記録があるものは作らないので、消したものは戻らない */
    private fun fillMissing() {
        val c = ctx()
        for (adapter in onAdapters()) {
            for (chunk in adapter.fill(c).chunked(SyncConfig.WRITE_BATCH)) {
                val local = t.records(chunk.map { it.recordId })
                val stmts = chunk.mapNotNull { r ->
                    if (r.recordId in local) {
                        if (r.reapply) SqlStatement("UPDATE sync_records SET needs_apply = 1 WHERE record_id = ?", listOf(r.recordId)) else null
                    } else {
                        writeRecord(
                            StoredRecord(
                                r.recordId, r.payload.kind, tagOfKind(r.payload.kind), SyncConfig.SCHEMA_VERSION, r.payload, 0, pending = true, priority = r.priority, needsApply = r.reapply,
                                r.refs.board, r.refs.thread, r.refs.detail, r.refs.local, null,
                            ),
                        )
                    }
                }
                if (stmts.isNotEmpty()) db.batch(stmts)
            }
        }
    }

    private fun applyAll() {
        enter("applying")
        keepRunning()
        val c = ctx()
        // まだ処理していない操作のあるレコードは、次の周に回す(操作の結果を古いレコードで上書きしない)
        val waiting = t.ops(opNames, 1000).mapNotNull { op -> adapters.firstOrNull { op.op in it.ops }?.target(op, c)?.recordId }.toSet()
        var after = ""
        while (true) {
            // 切っている種類は needs_apply を残し、オンに戻したときに写す
            val rows = t.toApply(kinds.filter { it !in offKinds }, after, SyncConfig.APPLY_BATCH)
            if (rows.isEmpty()) break
            after = rows.last().recordId
            val items = ArrayList<ApplyItem>()
            for (r in rows) {
                if (r.recordId in waiting) continue
                val adapter = adapters.firstOrNull { it.kind == r.kind && it.owns(r) }
                if (adapter == null) {
                    // 本文も ref もない tombstone は手元のどれか分からない。後で種まきが同じ ID を作れば ref が埋まって写せる
                    if (r.refBoard == null && r.refDetail == null && isDeleted(r.payload)) items += ApplyItem(r.recordId, "", ApplyPlan(emptyList(), false))
                    continue
                }
                items += ApplyItem(r.recordId, adapter.area, adapter.apply(r, c))
            }
            writeApplied(items)
        }
        for (adapter in onAdapters()) {
            val plan = adapter.afterApply(c) ?: continue
            if (plan.statements.isNotEmpty()) db.batch(plan.statements)
            if (plan.changed) result.applied += adapter.area
            result.dropped += plan.dropped
            plan.bad?.let { countBad(it) }
        }
    }

    private class ApplyItem(val id: String, val area: String, val plan: ApplyPlan)

    private fun writeApplied(items: List<ApplyItem>) {
        if (items.isEmpty()) return
        fun done(x: ApplyItem) {
            if (x.plan.changed) result.applied += x.area
            result.dropped += x.plan.dropped
            x.plan.bad?.let { countBad(it) }
        }
        try {
            db.batch(items.flatMap { it.plan.statements + clearNeedsApply(it.id) })
            applyFailures = 0
            items.forEach { done(it) }
        } catch (e: Exception) {
            // 全部戻っているので needs_apply が残る。続けて失敗するなら 1 件ずつ分けて、原因のレコードだけを除ける
            if (++applyFailures < SyncConfig.APPLY_SPLIT_AFTER) throw e
            for (x in items) {
                try {
                    db.batch(x.plan.statements + clearNeedsApply(x.id))
                    done(x)
                } catch (_: Exception) {
                    db.exec("UPDATE sync_records SET needs_apply = 0 WHERE record_id = ?", listOf(x.id))
                    countBad("apply")
                }
            }
            applyFailures = 0
        }
    }

    private suspend fun pushAll(manual: Boolean) {
        if (!manual && now() < pushRetryAt) return
        enter("pushing")
        var trims = 0
        for (round in 0 until SyncConfig.PUSH_MAX_ROUNDS) {
            keepRunning()
            val prepared = prepareBatch() ?: return
            val body = ArrayList<Map<String, Any?>>()
            for (r in prepared.rows) {
                try {
                    val (nonce, ciphertext) = sealPayload(keys, RecordContext(spaceIdValue, r.recordId, r.kindTag, r.schemaVersion), r.payload)
                    body += mapOf("record_id" to r.recordId, "base_version" to r.version, "kind_tag" to r.kindTag, "schema_version" to r.schemaVersion, "deleted" to isDeleted(r.payload), "nonce" to nonce, "ciphertext" to ciphertext)
                } catch (e: SyncError) {
                    // 大きすぎるものは送れない。列を止めない
                    db.exec("UPDATE sync_records SET pending = 0 WHERE record_id = ?", listOf(r.recordId))
                    countBad(e.code)
                }
            }
            if (body.isEmpty()) {
                db.exec("DELETE FROM sync_state WHERE key = ?", listOf("push_inflight"))
                continue
            }
            val res = try {
                call { api.pushRecords(prepared.requestId, body) }
            } catch (e: SyncApiError) {
                if (e.status == 413 && e.code == "quota_exceeded" && trims < SyncConfig.TRIM_ROUNDS && trimForQuota()) {
                    trims++
                    continue
                }
                // 送信の 429(日の件数の上限など)は送信だけを後回しにする。読んだ分の適用と確認は続ける。
                // 送り直しは同じ request_id で行うので、push_inflight は残す
                if (e.kind == "http" && e.status == 429) {
                    pushRetryAt = now() + waitMs(e)
                    pushDeferred = e.code.ifEmpty { "http_429" }
                    return
                }
                throw e
            }
            keepRunning()
            checkEpoch(res.epoch)
            settlePush(res.results, prepared.sent, body.size)
            pushRetryAt = 0
        }
    }

    /** 容量を超えた。古いものから trim の tombstone にしてサーバーから外す。手元は消さない。外せるものがなければ false */
    private fun trimForQuota(): Boolean {
        for (order in TRIM_ORDER) {
            val trimKinds = order.filter { it !in offKinds }
            if (trimKinds.isEmpty()) continue
            val marks = trimKinds.joinToString(", ") { "?" }
            val rows = t.selectRecords("deleted = 0 AND kind IN ($marks) AND (version > 0 OR pending = 1) ORDER BY hlc, record_id LIMIT ?", trimKinds + SyncConfig.TRIM_BATCH.toLong())
            if (rows.isEmpty()) continue
            val at = now()
            var clock = t.state("clock") ?: Hlc.ZERO
            val stmts = ArrayList<SqlStatement>()
            for (r in rows) {
                // まだ送っていないものは送らないだけでよい
                if (r.version == 0L) {
                    stmts += SqlStatement("UPDATE sync_records SET pending = 0 WHERE record_id = ?", listOf(r.recordId))
                    continue
                }
                val stamped = Hlc.stamp(clock, at, deviceId, r.payload.hlc)
                clock = stamped.clock
                val payload = makeTombstone(r.payload, stamped.stamp, deviceId, if (r.kind == LAST_VIEW_KIND) listOf(LAST_VIEWED_FIELD) else emptyList(), true)
                val settled = settleRecord(payload, r.version, r.asLocal(), at)
                stmts += writeRecord(r.copy(payload = payload, version = settled.version, pending = true, priority = 0, needsApply = false, tombAt = settled.tombAt))
            }
            stmts += listOf(setState("clock", clock), delState("push_inflight"))
            db.batch(stmts)
            countBad("quota_trim")
            return true
        }
        return false
    }

    /** 送信中の一覧を先に保存する。応答が来ないまま落ちたら、同じ request_id で送り直す(サーバーが二重に採番しない) */
    private fun prepareBatch(): Prepared? {
        val raw = t.state("push_inflight")
        if (raw != null) {
            val inflight = parseStrictJson(raw) as Map<String, Any?>
            val entries = inflight["records"] as List<Map<String, Any?>>
            val local = t.records(entries.map { it["record_id"] as String })
            val rows = entries.mapNotNull { x -> local[x["record_id"] as String]?.takeIf { it.pending && it.kind !in offKinds } }
            if (rows.isNotEmpty()) return Prepared(inflight["request_id"] as String, rows, entries.associate { (it["record_id"] as String) to (it["hlc"] as String) })
            db.exec("DELETE FROM sync_state WHERE key = ?", listOf("push_inflight"))
        }
        val candidates = t.pendingRecords(SyncConfig.PUSH_BATCH_RECORDS, offKinds)
        if (candidates.isEmpty()) return null
        var bytes = 0L
        val rows = ArrayList<StoredRecord>()
        for (r in candidates) {
            // 暗号文は平文の 4/3 倍と少しになる
            bytes += ceil((canonicalJson(r.payload).length + 256 + 16) * 4 / 3.0).toLong() + 256
            if (rows.isNotEmpty() && bytes > SyncConfig.PUSH_BATCH_BYTES) break
            rows += r
        }
        val requestId = newRequestId()
        putState("push_inflight", canonicalJson(mapOf("request_id" to requestId, "records" to rows.map { mapOf("record_id" to it.recordId, "hlc" to it.payload.hlc) })))
        return Prepared(requestId, rows, rows.associate { it.recordId to it.payload.hlc })
    }

    private fun settlePush(results: List<PushResult>, sent: Map<String, String>, expected: Int) {
        val at = now()
        val stmts = ArrayList<SqlStatement>()
        val since = t.state("since")?.toLong() ?: 0L
        val local = t.records(results.map { it.recordId })
        for (res in results) {
            val l = local[res.recordId] ?: continue
            if (res.status == 200L) {
                // 送信中に変わったレコードは version だけ進め、pending を残す
                stmts += SqlStatement(
                    "UPDATE sync_records SET version = MAX(version, ?), pending = CASE WHEN hlc = ? THEN 0 ELSE pending END WHERE record_id = ?",
                    listOf(res.version, sent[res.recordId].orEmpty(), res.recordId),
                )
                result.pushed++
                continue
            }
            // 409。応答のレコードとマージして、新しい version で送り直す
            result.conflicts++
            val raw = res.record!!
            val opened = openRecords(keys, spaceIdValue, listOf(raw))
            val version = raw["version"] as? Long ?: l.version
            // 別のレコードの暗号文をすり替えて返されても混ぜない。送信待ちのまま次で送り直す
            if (raw["record_id"] != res.recordId) {
                countBad("swapped")
            } else if (opened.records.size == 1) {
                stmts += writeRecord(merged(l, res.recordId, opened.records[0].payload, opened.records[0].version, ServerMeta(raw["kind_tag"] as String, raw["schema_version"] as Long), at))
            } else {
                // 読めないサーバーの値は使えない。手元の値で上書きできるよう version だけ進める
                for (f in opened.failed) countBad(f.reason)
                stmts += SqlStatement("UPDATE sync_records SET version = MAX(version, ?) WHERE record_id = ?", listOf(version, res.recordId))
            }
        }
        stmts += listOf(delState("push_inflight"), setState("last_push_at", at.toString()))
        // 全部 200 で version が since の続きに隙間なく並べば、増えたのは自分の送ったものだけ。読み戻さずに済むよう since を進め、次の確認を 304 にする
        val advanced = pushedRun(results, expected, since)
        if (advanced != null) stmts += setState("since", advanced.toString())
        db.batch(stmts)
        if (advanced != null) headFreshAt = at
    }

    /** 全件を読む。途中で切れたら読めた分を返し、呼び出す側が complete = false で扱う */
    private suspend fun readFull(): FullRead {
        val out = FullRead()
        var since = 0L
        while (true) {
            val page = try {
                call { api.changes(since) }
            } catch (e: SpaceGone) {
                throw e
            } catch (e: SyncApiError) {
                out.failure = e
                return out
            }
            checkEpoch(page.epoch)
            val shown = readable(page.records)
            val opened = openRecords(keys, spaceIdValue, shown)
            for (f in opened.failed) countBad(f.reason)
            val metaOf = shown.associateBy { it["record_id"] as? String }
            for (r in opened.records) {
                out.full[r.recordId] = LocalRecord(r.payload, r.version)
                val m = metaOf.getValue(r.recordId)
                out.meta[r.recordId] = ServerMeta(m["kind_tag"] as String, m["schema_version"] as Long)
            }
            val lastVersion = maxVersion(page.records, since)
            out.head = maxOf(lastVersion, page.head)
            out.gcFloor = page.gcFloor
            if (!page.more) return out
            if (lastVersion <= since) {
                out.failure = SyncApiError("no_progress")
                return out
            }
            since = lastVersion
        }
    }

    /**
     * gc_floor と epoch の変更はサーバーが決める値なので、回数を制限する。
     * 数えるのは合わせ直しを終えたときだけ(通信の失敗や全件読みの 429 で途中で切れた分を数えると、それだけで止まる)。
     * 返す文は終えたときの書き込みに入れる
     */
    private fun checkRebaseLimit(): SqlStatement {
        val at = now()
        val raw = t.state("rebase_log")
        val log = (if (raw != null) parseStrictJson(raw) as List<Long> else emptyList()).filter { at - it < SyncConfig.REBASE_WINDOW_MS }
        if (log.size >= SyncConfig.REBASE_LIMIT) throw CycleStop(block("too_many_rebases"))
        return setState("rebase_log", canonicalJson(log + at))
    }

    private suspend fun onSpaceGone(e: SpaceGone) {
        val known = t.state("epoch")
        val epoch = e.newEpoch ?: try {
            val ticket = keyStore.load()?.ticket ?: throw CycleStop(block("ticket_required"))
            api.createSpace(ticket)
        } catch (err: SyncApiError) {
            if (err.kind == "http" && err.status == 403) {
                val code = err.code.ifEmpty { "http_403" }
                noteError(code)
                // 許可証の問題は待っても直らない。利用者が通し直すまで止まる
                if (known == null || code.startsWith("ticket_")) throw CycleStop(block(code))
                db.batch(listOf(setState("phase", "recreate_waiting"), setState("recreate_tried_at", now().toString()), setState("last_error", code)))
                throw CycleStop("recreate_waiting")
            }
            throw err
        }
        val phase = t.state("phase")
        if (known == null) {
            // 初めて作った領域。合わせ直すものがない
            putState("epoch", epoch)
            return
        }
        val counted = checkRebaseLimit()
        enter("recreating")
        db.batch(
            listOf(
                counted,
                setState("epoch", epoch),
                setState("since", "0"),
                setState("recreate_pending", "1"),
                setState("phase", if (phase == "recreate_waiting") "idle" else (phase ?: "idle")),
                delState("push_inflight"),
                delState("recreate_tried_at"),
            ),
        )
    }

    private fun rowFromPlan(l: StoredRecord?, id: String, settled: LocalRecord, meta: ServerMeta?, pending: Boolean, priority: Long? = null): StoredRecord {
        val refs = refsOfBody(settled.payload).over(l?.refs)
        return StoredRecord(
            id, settled.payload.kind, l?.kindTag ?: meta?.kindTag ?: tagOfKind(settled.payload.kind), l?.schemaVersion ?: meta?.schemaVersion ?: SyncConfig.SCHEMA_VERSION, settled.payload, settled.version,
            pending = pending, priority = priority ?: l?.priority ?: 5, needsApply = l == null || !same(l.payload, settled.payload) || l.needsApply,
            refs.board, refs.thread, refs.detail, refs.local, settled.tombAt,
        )
    }

    private fun writeChunks(stmts: List<SqlStatement>, last: List<SqlStatement>) {
        var i = 0
        while (stmts.size - i > SyncConfig.WRITE_BATCH) {
            db.batch(stmts.subList(i, i + SyncConfig.WRITE_BATCH))
            i += SyncConfig.WRITE_BATCH
        }
        db.batch(stmts.subList(i, stmts.size) + last)
    }

    /** 領域が消えたときの合わせ直し。手元を消さない。途中で切れたら since = 0 のまま次の周で読み直す */
    private suspend fun finishRecreate() {
        enter("recreating")
        val read = readFull()
        read.failure?.let { throw it }
        val at = now()
        val all = t.allRecords()
        val byId = all.associateBy { it.recordId }
        val plan = planRecreate(all.associate { it.recordId to it.asLocal() }, read.full, at)
        val stmts = ArrayList<SqlStatement>()
        for ((id, settled) in plan.records) {
            val pending = id in plan.pending
            // tombstone を先に送る。他の端末の古い値が先に領域へ入っても、すぐ負けるように
            val priority = if (pending && isDeleted(settled.payload)) 0L else null
            stmts += writeRecord(rowFromPlan(byId[id], id, settled, read.meta[id], pending, priority))
        }
        for (id in plan.expired) stmts += delRecord(id)
        writeChunks(stmts, listOf(delState("recreate_pending"), setState("since", read.head.toString()), setState("gc_floor", read.gcFloor.toString()), setState("last_pull_at", at.toString())))
        result.pulled += read.full.size
    }

    /** since < gc_floor。全件を正にして、消えたものを手元から消す */
    private suspend fun rebase() {
        enter("rebasing")
        val counted = checkRebaseLimit()
        val read = readFull()
        val complete = read.failure == null
        val at = now()
        val all = t.allRecords()
        val byId = all.associateBy { it.recordId }
        val plan = planRebase(
            all.associate { it.recordId to it.asLocal() },
            all.filter { it.pending }.associate { it.recordId to it.payload },
            read.full,
            complete,
            at,
        )
        val liveRemoved = plan.removed.filter { !isDeleted(byId.getValue(it).payload) }
        if (complete && plan.needsConfirmation) {
            val accepted = t.state("rebase_accepted")
            if (accepted == null || liveRemoved.size > accepted.toInt()) {
                val confirm = mapOf("type" to "rebase", "lost" to liveRemoved.size.toLong(), "empty" to read.full.isEmpty())
                db.batch(listOf(setState("phase", "confirm"), setState("pending_confirm", canonicalJson(confirm))))
                throw CycleStop("confirm")
            }
        }
        val stmts = ArrayList<SqlStatement>()
        if (plan.removed.isNotEmpty()) {
            val backup = liveRemoved.map { id -> byId.getValue(id).let { mapOf("record_id" to id, "kind" to it.kind, "ref_board" to it.refBoard, "ref_thread" to it.refThread, "ref_detail" to it.refDetail) } }
            stmts += setState("rebase_backup", canonicalJson(backup))
        }
        for ((id, settled) in plan.records) stmts += writeRecord(rowFromPlan(byId[id], id, settled, read.meta[id], id in plan.pending))
        for (id in plan.removed) {
            val r = byId.getValue(id)
            // すでに tombstone のものは今のデータに触らない。行を消すだけ
            if (!isDeleted(r.payload)) {
                val adapter = onAdapters().firstOrNull { it.kind == r.kind && it.owns(r) }
                if (adapter != null) {
                    val removal = adapter.remove(r)
                    stmts += removal.statements
                    if (removal.changed) result.applied += adapter.area
                    result.dropped += removal.dropped
                }
            }
            stmts += delRecord(id)
        }
        if (!complete) {
            // 読めた分のマージだけを残す。since は進めないので、次の周でまた最初から読む
            if (stmts.isNotEmpty()) writeChunks(stmts, emptyList())
            throw read.failure!!
        }
        writeChunks(stmts, listOf(counted, delState("rebase_accepted"), setState("since", maxOf(read.head, read.gcFloor).toString()), setState("gc_floor", read.gcFloor.toString()), setState("last_pull_at", at.toString())))
        result.pulled += read.full.size
    }
}

/** 送った全部が 200 で、version が since + 1 から連番で隙間なく並んでいれば、その最後の version。それ以外は null */
fun pushedRun(results: List<PushResult>, expected: Int, since: Long): Long? {
    if (expected == 0 || results.size != expected) return null
    val versions = ArrayList<Long>()
    for (r in results) {
        if (r.status != 200L) return null
        versions += r.version ?: return null
    }
    versions.sort()
    for (i in versions.indices) if (versions[i] != since + 1 + i) return null
    return since + versions.size
}
