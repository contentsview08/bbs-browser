package io.github.contentsview08.obb.sync

// 既読。リセット(スレごと・LWW)と端末ごとの記録(持ち主だけが書く・LWW)に分ける

const val MAX_STEPS = 8
const val RESET_KIND = "read_reset"
const val DEV_KIND = "read_dev"

/** record_id は片道なので、どのスレの記録かを本文に書く */
class ThreadRef(val boardUrl: String, val thread: String) {
    fun toBody(): Map<String, Any?> = mapOf("board_url" to boardUrl, "thread" to thread)
}

private fun resetId(r: SyncPayload?): String? = r?.body?.get("id") as? String
private fun resetAt(r: SyncPayload?): String = r?.hlc ?: Hlc.ZERO
private fun resetTarget(r: SyncPayload?): Long = r?.body?.get("target_res") as? Long ?: 0

@Suppress("UNCHECKED_CAST")
private fun stepsOf(d: SyncPayload?): List<Map<String, Any?>> = d?.body?.get("steps") as? List<Map<String, Any?>> ?: emptyList()
private fun stepAt(s: Map<String, Any?>) = s["at"] as String
private fun stepPos(s: Map<String, Any?>) = s["pos"] as Long

/** 後ろの要素以下の位置は要らない(どの時刻で引いても後ろの要素が同じ答えを返す)。at が進むほど pos が小さい並びになる */
fun pushStep(steps: List<Map<String, Any?>>, at: String, pos: Long): List<Map<String, Any?>> =
    (steps.filter { stepPos(it) > pos } + mapOf("at" to at, "pos" to pos)).takeLast(MAX_STEPS)

/**
 * 読んだ記録。stamp は Hlc.stamp に dev の hlc を floor として渡して作る。
 * 新しいリセットを知った時点でも、そのリセットより後に読んだ分は引き継ぐ(既読位置が読み直しで下がらないように)。
 * 今の読みも必ず steps に足す(まだ知らない次のリセットより後の読みかもしれない)
 */
fun recordRead(dev: SyncPayload?, latest: SyncPayload?, ref: ThreadRef, pos: Long, stamp: String, deviceId: String): SyncPayload {
    val id = resetId(latest)
    val after = resetAt(latest)
    val live = stepsOf(dev).filter { Hlc.compare(stepAt(it), after) > 0 }
    val prior = if (dev != null && dev.body?.get("base_reset_id") as? String == id) dev.body?.get("pos") as? Long ?: 0 else live.maxOfOrNull(::stepPos) ?: 0
    return withoutTombstone(dev) + mapOf(
        "kind" to DEV_KIND,
        "hlc" to stamp,
        "device_id" to deviceId,
        "body" to (dev?.body.orEmpty() + ref.toBody() + mapOf("base_reset_id" to id, "pos" to maxOf(prior, pos), "steps" to pushStep(live, stamp, pos))),
    )
}

/** リセットの floor。知っている読みより必ず後にする(先の日時の読みが残ると未読に戻せない) */
fun resetFloor(latest: SyncPayload?, devs: Iterable<SyncPayload>): String {
    var floor = resetAt(latest)
    for (d in devs) {
        if (Hlc.compare(d.hlc, floor) > 0) floor = d.hlc
        for (s in stepsOf(d)) if (Hlc.compare(stepAt(s), floor) > 0) floor = stepAt(s)
    }
    return floor
}

/** 未読に戻す。stamp は Hlc.stamp に resetFloor の値を floor として渡して作る。id はランダムな値 */
fun makeReset(existing: SyncPayload?, ref: ThreadRef, id: String, targetRes: Long, stamp: String, deviceId: String): SyncPayload =
    withoutTombstone(existing) + mapOf(
        "kind" to RESET_KIND,
        "hlc" to stamp,
        "device_id" to deviceId,
        "body" to (existing?.body.orEmpty() + ref.toBody() + mapOf("id" to id, "target_res" to targetRes)),
    )

fun readPosition(latest: SyncPayload?, devs: Iterable<SyncPayload>): Long {
    val id = resetId(latest)
    val after = resetAt(latest)
    var best = resetTarget(latest)
    for (d in devs) {
        if (d.body?.get("base_reset_id") as? String == id) {
            best = maxOf(best, d.body?.get("pos") as? Long ?: 0)
        } else {
            for (s in stepsOf(d)) if (Hlc.compare(stepAt(s), after) > 0) best = maxOf(best, stepPos(s))
        }
    }
    return best
}
