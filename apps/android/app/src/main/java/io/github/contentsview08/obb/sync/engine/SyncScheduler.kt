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

    /** PC は放置で確認を止める。スマホは前面なら操作がなくても見ている */
    val idleStops: Boolean
}

class PaceMs(val head: Long, val push: Long)

fun paceMs(pace: SyncPace?): PaceMs {
    fun ms(sec: Double?, base: Long) = if (sec != null && sec.isFinite() && sec > 0) maxOf(base, ceil(sec * 1000).toLong()) else base
    return PaceMs(ms(pace?.headSec, SyncConfig.HEAD_INTERVAL_MS), ms(pace?.pushSec, SyncConfig.PUSH_INTERVAL_MS))
}

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

    private fun schedule() {
        clear(timer)
        timer = null
        if (!front || paused) return
        val p = paceMs(host.pace())
        timer = host.setTimer({ launchQuiet { tick() } }, minOf(p.head, p.push))
    }

    private suspend fun guarded(f: suspend () -> Unit) {
        if (busy) return
        busy = true
        try {
            f()
        } finally {
            busy = false
        }
    }

    private suspend fun run(reason: String) {
        lastSync = host.now()
        lastCheck = lastSync
        lastPush = lastSync
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
        try {
            guarded {
                if (host.enabled()) {
                    val p = paceMs(host.pace())
                    if (now - lastPush >= p.push && host.hasChanges()) {
                        run("tick")
                    } else if (now - lastCheck >= p.head) {
                        lastCheck = now
                        if (host.check()) run("tick")
                    }
                }
            }
        } finally {
            schedule()
        }
    }

    /** 前面に戻った。すぐ 1 回 pull して、時計を動かし始める */
    suspend fun foreground() {
        front = true
        paused = false
        lastActivity = host.now()
        schedule()
        guarded {
            if (host.enabled()) run("foreground")
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

    /** 利用者の操作。放置で止めていたら 1 回確認する */
    fun activity() {
        lastActivity = host.now()
        if (!front || !paused) return
        paused = false
        lastCheck = 0
        launchQuiet { tick() }
    }

    /** ネットワークが戻った。すぐは不安定なので待ち、前回から空いていれば同期する */
    fun networkBack() {
        clear(netTimer)
        netTimer = host.setTimer({
            netTimer = null
            if (front && host.now() - lastSync >= SyncConfig.NET_MIN_GAP_MS) {
                launchQuiet { guarded { if (host.enabled()) run("network") } }
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
