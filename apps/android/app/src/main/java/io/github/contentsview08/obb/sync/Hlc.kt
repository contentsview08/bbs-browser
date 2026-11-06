package io.github.contentsview08.obb.sync

// HLC は「壁時計(ms)12 桁の 16 進.カウンター 4 桁の 16 進.端末 ID」の文字列。文字列の比較がそのまま順序になる
object Hlc {
    const val ZERO = "000000000000.0000."
    const val FUTURE_LIMIT_MS = 24L * 60 * 60 * 1000
    private const val MAX_WALL = (1L shl 48) - 1
    private const val MAX_COUNTER = 0xffff
    private val RE = Regex("([0-9a-f]{12})\\.([0-9a-f]{4})\\.([A-Za-z0-9_-]{1,64})")
    val DEVICE_ID = Regex("[A-Za-z0-9_-]{1,64}")

    class Parts(val wall: Long, val counter: Int, val device: String)
    class Stamp(val stamp: String, val clock: String)

    fun format(wall: Long, counter: Int, device: String): String {
        if (wall < 0 || wall > MAX_WALL || counter < 0 || counter > MAX_COUNTER || !DEVICE_ID.matches(device)) throw SyncError("bad_hlc")
        return wall.toString(16).padStart(12, '0') + "." + counter.toString(16).padStart(4, '0') + "." + device
    }

    fun parse(s: String): Parts {
        if (s == ZERO) return Parts(0, 0, "")
        val m = RE.matchEntire(s) ?: throw SyncError("bad_hlc")
        return Parts(m.groupValues[1].toLong(16), m.groupValues[2].toInt(16), m.groupValues[3])
    }

    fun isHlc(v: Any?): Boolean = v is String && RE.matches(v)

    fun compare(a: String, b: String): Int = a.compareTo(b).coerceIn(-1, 1)

    /** (wall, counter) を 1 つ進める。カウンターが尽きたら壁時計を進める */
    private fun bump(wall: Long, counter: Int): Pair<Long, Int> = if (counter >= MAX_COUNTER) (wall + 1) to 0 else wall to (counter + 1)

    /** 受け取った HLC を端末の HLC に反映する。24 時間以上先なら、時計の狂った端末に引きずられないよう進めない */
    fun observe(clock: String, remote: String, nowMs: Long): String {
        if (parse(remote).wall - nowMs >= FUTURE_LIMIT_MS) return clock
        return if (compare(remote, clock) > 0) remote else clock
    }

    /**
     * 新しい更新の HLC を作る。floor はそのレコードの HLC で、必ずこれより大きくする(時計の狂った端末が書いた値も上書きできるように)。
     * floor が 24 時間以上先なら、更新の値だけが先へ進み、端末の HLC は引きずられない
     */
    fun stamp(clock: String, nowMs: Long, device: String, floor: String? = null): Stamp {
        val c = parse(clock)
        val (wall, counter) = if (nowMs > c.wall) nowMs to 0 else bump(c.wall, c.counter)
        val ticked = format(wall, counter, device)
        if (floor == null || compare(ticked, floor) > 0) return Stamp(ticked, ticked)
        val f = parse(floor)
        val (fw, fc) = bump(f.wall, f.counter)
        val stamp = format(fw, fc, device)
        return Stamp(stamp, if (fw - nowMs >= FUTURE_LIMIT_MS) ticked else stamp)
    }
}
