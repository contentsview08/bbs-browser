package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.SyncConfig
import kotlinx.coroutines.CancellationException
import kotlin.math.ceil

// 自動の同期のきっかけ。前面にいる間だけ動く。時計とタイマーは外から渡すので、偽の時計で試せる

/** サーバーが応答で指示する「最低これだけ空ける」。アプリはこれより短くしない */
class SyncPace(val headSec: Double? = null, val pushSec: Double? = null)

interface SchedulerHost {
    fun now(): Long
    fun setTimer(f: () -> Unit, ms: Long): Any
    fun clearTimer(t: Any)

    /** 画面のスレッドで裏の処理を始める */
    fun launch(f: suspend () -> Unit)

    /** 使っていないときは何もしない */
    suspend fun enabled(): Boolean

    /** 周を回す。pull の間隔はエンジンが守る。reason は foreground・tick・background・network */
    suspend fun cycle(reason: String)

    /** GET /head。変化があれば true。304 と通信の失敗は false */
    suspend fun check(): Boolean

    /** 送るものがあるか(通信しない) */
    suspend fun hasChanges(): Boolean
    fun pace(): SyncPace?

    /** 利用者の選んだ確認の間隔。null は手動のみ(自動では確かめず、この端末の変更を送るだけ) */
    fun interval(): Long? = SyncConfig.HEAD_INTERVAL_MS

    /** PC は放置で確認を止める。スマホは前面なら操作がなくても見ている */
    val idleStops: Boolean
}

class PaceMs(val head: Long, val push: Long)

/** 既定(head は利用者の選んだ間隔)より短くせず、PACE_MAX_MS より長くしない(大きな値で時刻の足し算があふれないように、掛ける前に丸める) */
fun paceMs(pace: SyncPace?, head: Long = SyncConfig.HEAD_INTERVAL_MS): PaceMs {
    fun ms(sec: Double?, base: Long) = if (sec != null && sec.isFinite() && sec > 0) minOf(SyncConfig.PACE_MAX_MS, maxOf(base, ceil(minOf(sec * 1000, SyncConfig.PACE_MAX_MS.toDouble())).toLong())) else base
    return PaceMs(ms(pace?.headSec, head), ms(pace?.pushSec, SyncConfig.PUSH_INTERVAL_MS))
}

/** 「変化なし」が続いた回数から確認の間隔を決める。基本の間隔より短くせず、上限で止める */
fun headWaitMs(head: Long, misses: Int): Long = maxOf(head, minOf(SyncConfig.HEAD_BACKOFF_MAX_MS, head shl minOf(misses, 16)))

/** 状態は画面のスレッドでだけ触る */
class SyncScheduler(private val host: SchedulerHost) {
    private var front = false
    private var paused = false
    private var busy = false
    private var timer: Any? = null
    private var netTimer: Any? = null
    private var lastActivity = 0L
    private var lastCheck = 0L
    private var lastPush = 0L
    private var lastSync = 0L
    /** 確認が「変化なし」だった回数。間隔を伸ばす元。周を回す・操作・前面復帰で 0 に戻す */
    private var misses = 0

    val isPaused get() = paused

    private fun clear(t: Any?) {
        if (t != null) host.clearTimer(t)
    }

    /** 裏の処理の失敗で時計を止めない。次のきっかけでまた試す */
    private fun launchQuiet(f: suspend () -> Unit) = host.launch {
        try {
            f()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    /** 手動のみなら null */
    private fun headBase(): Long? = host.interval()?.let { maxOf(1_000L, it) }

    /** head が null なら自動では確かめない。送り出しの間隔は選んだ間隔によらない */
    private fun paces(): Pair<Long?, Long> {
        val base = headBase()
        val p = paceMs(host.pace(), base ?: SyncConfig.HEAD_INTERVAL_MS)
        return (if (base == null) null else p.head) to p.push
    }

    /** 間隔を選び直したとき。次の確認を新しい間隔で掛け直す */
    fun intervalChanged() {
        misses = 0
        schedule()
    }

    /** 次の確認と次の送信の早い方で起きる。確認を遠ざけている間も、送るものの有無は送信の間隔で見る */
    private fun schedule() {
        clear(timer)
        timer = null
        if (!front || paused) return
        val (head, push) = paces()
        val now = host.now()
        val untilCheck = if (head == null) Long.MAX_VALUE else maxOf(0L, lastCheck + headWaitMs(head, misses) - now)
        val untilPush = maxOf(0L, lastPush + push - now)
        timer = host.setTimer({ launchQuiet { tick() } }, minOf(untilPush, untilCheck))
    }

    /** 走っている間のきっかけは捨てる(走っているものが終わりに時計を掛け直す) */
    private suspend fun guarded(f: suspend () -> Unit) {
        if (busy) return
        busy = true
        try {
            f()
        } finally {
            busy = false
            schedule()
        }
    }

    private suspend fun run(reason: String) {
        lastSync = host.now()
        lastCheck = lastSync
        lastPush = lastSync
        misses = 0
        host.cycle(reason)
    }

    private suspend fun tick() {
        timer = null
        if (!front) return
        val now = host.now()
        if (host.idleStops && now - lastActivity >= SyncConfig.IDLE_STOP_MS) {
            paused = true
            return
        }
        guarded {
            val (head, push) = paces()
            val checkDue = head != null && now - lastCheck >= headWaitMs(head, misses)
            val pushDue = now - lastPush >= push
            // 送るものがなくても・使っていなくても、次はここから数える(時計が空回りしないように)
            if (checkDue) lastCheck = now
            if (pushDue) lastPush = now
            if (host.enabled()) {
                if (pushDue && host.hasChanges()) {
                    run("tick")
                } else if (checkDue) {
                    if (host.check()) run("tick") else misses++
                }
            }
        }
    }

    /** 前面に戻った。すぐ 1 回 pull して、時計を動かし始める */
    suspend fun foreground() {
        front = true
        paused = false
        lastActivity = host.now()
        lastCheck = lastActivity
        lastPush = lastActivity
        misses = 0
        guarded {
            // 手動のみでは、前面に戻っても確かめに行かない。送るものがあれば送る
            if (host.enabled() && (headBase() != null || host.hasChanges())) run("foreground")
        }
    }

    /** 裏に回る瞬間。送るものがあれば 1 回だけ試す。止められても送信待ちは DB に残る */
    suspend fun background() {
        front = false
        stopTimers()
        guarded {
            if (host.enabled() && host.hasChanges()) run("background")
        }
    }

    /** 利用者の操作。伸ばしていた確認の間隔を基本に戻す。放置で止めていたら 1 回確認する */
    fun activity() {
        lastActivity = host.now()
        if (!front) return
        val stretched = misses > 0
        misses = 0
        if (paused) {
            paused = false
            lastCheck = 0
            launchQuiet { tick() }
        } else if (stretched) schedule()
    }

    /** ネットワークが戻った。すぐは不安定なので待ち、前回から空いていれば同期する */
    fun networkBack() {
        clear(netTimer)
        netTimer = host.setTimer({
            netTimer = null
            if (front && host.now() - lastSync >= SyncConfig.NET_MIN_GAP_MS) {
                launchQuiet { guarded { if (host.enabled() && (headBase() != null || host.hasChanges())) run("network") } }
            }
        }, SyncConfig.NET_SETTLE_MS)
    }

    private fun stopTimers() {
        clear(timer)
        clear(netTimer)
        timer = null
        netTimer = null
    }

    /** 画面が消えるとき */
    fun dispose() {
        front = false
        stopTimers()
    }
}
