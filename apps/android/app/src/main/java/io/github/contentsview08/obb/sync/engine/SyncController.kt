package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.SyncText
import io.github.contentsview08.obb.sync.adapters.AdapterContext
import io.github.contentsview08.obb.sync.adapters.NG_KIND
import io.github.contentsview08.obb.sync.adapters.SyncAdapter
import io.github.contentsview08.obb.sync.deriveKeys
import io.github.contentsview08.obb.sync.isServerPairingCode
import io.github.contentsview08.obb.sync.parseDrivePairingCode
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.spaceId
import kotlinx.coroutines.CancellationException

// 画面から使う同期の入口。PC 版の packages/sync/src/engine/controller.ts と同じ順番。使っていない間は鍵保管にも通信にも触らない。
// 置き場は Google ドライブだけ(本人の決定)。スマホは Google のログインをせず、PC の QR(obb2)で参加する

const val PAIRING_SHOW_MS = 60_000L
/** 参加で手元を送る前の確認の種類 */
const val JOIN_DATA_CONFIRM = "join_data"

/**
 * 参加のとき、種まきで相手へ送るものが手元にあるか。閲覧履歴・既読・お気に入り(スレ・板)・書き込み履歴・自分のレスの印・
 * 上げた画像の履歴・サイト・NG を見る(設定は数えない)。最初から入っている掲示板・板は、まっさらな端末にもあるので数えない。
 * 既読は履歴から外したスレの分も種まきで送るので、read_at がなくても read_no があれば数える
 */
fun hasLocalData(db: SyncSql, adapters: List<SyncAdapter>, ctx: AdapterContext, presetUrls: List<String>): Boolean {
    fun any(sql: String, params: List<Any?> = emptyList()) = (db.query("SELECT COUNT(*) AS n $sql", params).firstOrNull()?.get("n") as? Long ?: 0L) > 0L
    fun notPreset(col: String) = if (presetUrls.isEmpty()) "" else " WHERE $col NOT IN (${presetUrls.joinToString(", ") { "?" }})"
    if (any("FROM threads WHERE read_at IS NOT NULL OR read_no > 0")) return true
    if (any("FROM favorite_threads")) return true
    if (any("FROM post_history")) return true
    if (any("FROM own_posts")) return true
    if (any("FROM uploads")) return true
    if (any("FROM favorite_boards${notPreset("url")}", presetUrls)) return true
    if (any("FROM sites${notPreset("menu_url")}", presetUrls)) return true
    val ng = adapters.firstOrNull { it.kind == NG_KIND } ?: return false
    return !ng.localLines(ctx).isNullOrEmpty()
}

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
    val confirm: SyncConfirm?,
    /** Google ドライブを使えない理由(ビルドにクライアントがない)。使えるなら null */
    val driveUnavailable: String?,
    /** 参加した Google アカウントのメール。使っている間だけ */
    val email: String?,
)

/** 確認を待っている参加。答えが出るまで鍵も同期の表も書かない */
private class PendingJoin(val k: ByteArray, val refreshToken: String, val account: GoogleAccount, val confirm: SyncConfirm)

class SyncController(
    private val db: SyncSql,
    private val keyStore: SyncKeyStore,
    private val transport: SyncTransport,
    /** ビルドのときに入れた Google のクライアント。なければ同期は使えない */
    private val google: GoogleClient?,
    private val adapters: List<SyncAdapter>,
    private val now: () -> Long,
    /** 最初から入っている掲示板・板の URL。まっさらな端末にもあるので、参加の確認では手元のデータに数えない */
    private val presetUrls: List<String> = emptyList(),
    /** 鍵保管に値があるかもしれない。使ったことのない人の鍵保管を開かないための控え */
    private val keyHint: () -> Boolean,
    private val onCycle: (CycleResult) -> Unit = {},
) {
    private val t = SyncTables(db)
    private var engineValue: SyncEngine? = null
    private var spaceHead: String? = null
    private var pendingJoin: PendingJoin? = null
    /** 同期サーバーで使っていた端末を戻したか(起動して最初の 1 回だけ見る) */
    private var serverChecked = false

    private val tokens = GoogleTokens(
        transport, google, now,
        load = { keyStore.load()?.google },
        // 更新で新しいトークンが返ったら置き換える(K と同期の表はそのまま)
        save = { next -> keyStore.load()?.let { keyStore.save(SyncKeyMaterial(it.k, it.deviceId, it.ticket, next)) } },
    )
    private val remote = driveRemote(DriveRemoteOptions(transport, { fresh -> tokens.accessToken(fresh) }))

    private fun isEnabled() = t.state("enabled") == "1"
    private fun isMasterOn() = masterOn(t.state("master"), t.state("enabled"))
    private fun onAdapters(): List<SyncAdapter> {
        val off = offKindsOf(parseSwitches(t.state("kinds")))
        return adapters.filter { it.kind !in off }
    }

    private suspend fun engine(): SyncEngine {
        val e = engineValue ?: SyncEngine(db = db, keyStore = keyStore, transport = transport, serverUrl = "", adapters = adapters, now = now, remote = remote).also { engineValue = it }
        if (!serverChecked) {
            serverChecked = true
            retireServer(e)
        }
        return e
    }

    /**
     * 同期サーバーで使っていた端末を、同期をやめた状態に戻す(本人の決定: 同期は Google ドライブだけ。移す期間は設けない)。
     * 手元のデータは消さない。スイッチはそのまま残し、QR を読み直す案内を最後のエラーに出す
     */
    private suspend fun retireServer(e: SyncEngine) {
        if (!isEnabled() || t.state("store") == "drive") return
        val on = isMasterOn()
        e.leave()
        spaceHead = null
        db.batch(listOf(setState("master", if (on) "1" else "0"), setState("last_error", SERVER_SYNC_ENDED)))
    }

    private suspend fun run(manual: Boolean, quick: Boolean = false): CycleResult = engine().runCycle(manual, quick).also(onCycle)

    private suspend fun loadKeys(): SyncKeyMaterial? = try {
        keyStore.load()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        throw SyncHostError("key_store_unavailable")
    }

    private fun spaceOf(k: ByteArray) = spaceId(deriveKeys(k).authToken)

    suspend fun status(): SyncStatus {
        engine()
        val enabled = isEnabled()
        val kinds = parseSwitches(t.state("kinds"))
        val pending = t.pendingCount(offKindsOf(kinds), adapters.flatMap { it.ops })
        val master = isMasterOn()
        val lastError = t.state("last_error")
        // 切っている間は鍵保管を開かない
        if (enabled && master && spaceHead == null) {
            val m = try { keyStore.load() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (m != null) spaceHead = spaceOf(m.k).take(12)
        }
        val running = engineValue?.state
        @Suppress("UNCHECKED_CAST")
        val confirm = pendingJoin?.confirm ?: t.state("pending_confirm")?.let { raw ->
            val m = parseStrictJson(raw) as Map<String, Any?>
            SyncConfirm(m["type"] as? String ?: "", m["lost"] as? Long ?: 0L)
        }
        return SyncStatus(
            enabled = enabled,
            master = master,
            kinds = kinds,
            state = if (!master) "off" else if (!enabled) (if (pendingJoin != null) "confirm" else "off") else if (running == null || running == "off") t.state("phase") ?: "idle" else running,
            space = if (enabled) spaceHead else null,
            pending = pending,
            lastError = lastError,
            lastErrorText = lastError?.let(SyncText::message),
            lastPullAt = t.state("last_pull_at")?.toLongOrNull(),
            lastPushAt = t.state("last_push_at")?.toLongOrNull(),
            confirm = confirm,
            driveUnavailable = if (google == null) GOOGLE_UNAVAILABLE else null,
            email = if (enabled) t.state("google_email") else null,
        )
    }

    /**
     * QR(Google の更新用のトークン)を Google に確かめ、アカウントを聞く。使えないトークンは google_pairing_failed。
     * expect(前のアカウント)と違えば置かずに google_other_account
     */
    private suspend fun adopt(refreshToken: String, expect: String?): Pair<String, GoogleAccount> {
        if (google == null) throw SyncHostError(GOOGLE_UNAVAILABLE)
        val (access, _, next) = try {
            refreshGoogleToken(transport, google, refreshToken)
        } catch (e: SyncApiError) {
            if (e.code == GOOGLE_AUTH_FAILED) throw SyncHostError(GOOGLE_PAIRING_FAILED)
            throw e
        }
        val account = try {
            googleAbout(transport, access)
        } catch (e: SyncApiError) {
            if (e.code == GOOGLE_AUTH_FAILED) throw SyncHostError(GOOGLE_PAIRING_FAILED)
            throw e
        }
        if (expect != null && expect != account.permissionId) throw SyncHostError(GOOGLE_OTHER_ACCOUNT)
        return (next ?: refreshToken) to account
    }

    /**
     * QR・コード(obb2)で参加する。手元の全部が相手の鍵で読める形で送られるので、送るものがあれば先に確認を返す
     * (state が confirm。答えは resolveConfirm)。使っている最中でも、K が同じならトークンだけを置き直す(5.7 の配り直し)
     */
    suspend fun join(code: String): CycleResult {
        engine()
        if (!isMasterOn()) throw SyncHostError("sync_off")
        if (isServerPairingCode(code)) throw SyncHostError("server_code")
        val c = parseDrivePairingCode(code)
        if (google == null) throw SyncHostError(GOOGLE_UNAVAILABLE)
        if (isEnabled()) {
            val m = loadKeys()
            if (m == null || !m.k.contentEquals(c.k)) throw SyncHostError("already_on")
            val (token, account) = adopt(c.refreshToken, t.state("google_account"))
            engine().setGoogle(token)
            tokens.forget()
            db.batch(listOf(setState("google_account", account.permissionId), setState("google_email", account.email)))
            return run(true)
        }
        loadKeys()
        pendingJoin = null
        val (token, account) = adopt(c.refreshToken, null)
        val ctx = AdapterContext(deriveKeys(c.k), "", now())
        if (hasLocalData(db, adapters, ctx, presetUrls)) {
            val confirm = SyncConfirm(JOIN_DATA_CONFIRM, 0L, account = account.email.ifEmpty { null })
            pendingJoin = PendingJoin(c.k, token, account, confirm)
            return CycleResult().also { it.state = "confirm"; it.confirm = confirm }
        }
        return finishJoin(c.k, token, account)
    }

    private suspend fun finishJoin(k: ByteArray, token: String, account: GoogleAccount): CycleResult {
        val e = engine()
        e.halt()
        try {
            e.pair(k, null, token)
        } catch (x: CancellationException) {
            throw x
        } catch (x: SyncApiError) {
            throw x
        } catch (_: Exception) {
            throw SyncHostError("key_store_unavailable")
        }
        tokens.forget()
        db.batch(listOf(setState("store", "drive"), setState("google_account", account.permissionId), setState("google_email", account.email)))
        spaceHead = spaceOf(k).take(12)
        return run(true)
    }

    /** 起動したとき。同期サーバーで使っていた端末を戻す(使っていない人の鍵保管は開かない) */
    suspend fun startup() {
        engine()
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

    /** 鍵(Google のトークンを含む)と同期の表を消す。手元のデータは消さない。Google へ取り消しは送らない(同じトークンを使うほかの端末を止めないため) */
    suspend fun leave() {
        pendingJoin = null
        engine().leave()
        tokens.forget()
        spaceHead = null
    }

    /** 自動の同期の口。周の結果は手動と同じ流れで画面へ渡す。確認の時計と裏に回る瞬間の周は、直前の確認が「変化なし」なら pull を省く */
    suspend fun autoCycle(reason: String = "tick") {
        run(false, reason == "tick" || reason == "background")
    }

    suspend fun autoCheck(): Boolean = engine().checkHead()

    suspend fun hasChanges(): Boolean = engine().hasChanges()

    fun autoEnabled(): Boolean = t.state("master") != "0" && (isEnabled() || keyHint())

    fun pace(): SyncPace? = engineValue?.pace

    /** Google ドライブで使っている量(バイト)。使っている間だけ。周とは別に files.list を辿るので、画面を開いたときと同期の後だけ呼ぶ */
    suspend fun driveUsage(): Long? {
        if (!isEnabled() || !isMasterOn() || google == null) return null
        return driveUsage(transport) { fresh -> tokens.accessToken(fresh) }
    }

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
        pendingJoin?.let { j ->
            pendingJoin = null
            // やめるなら、確かめただけのトークンは置かずに捨てる
            return if (choice == "keep_local") CycleResult() else finishJoin(j.k, j.refreshToken, j.account)
        }
        engine().resolveConfirm(choice)
        return run(true)
    }
}

/** 同期サーバーで使っていた端末を戻したときの案内(最後のエラーに出す) */
const val SERVER_SYNC_ENDED = "server_sync_ended"
