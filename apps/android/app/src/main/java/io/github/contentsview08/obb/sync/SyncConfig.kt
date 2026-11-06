package io.github.contentsview08.obb.sync

// 端末の同期の定数。PC 版の packages/sync/src/config.ts と packages/conformance/sync-config.json で揃える
object SyncConfig {
    const val SCHEMA_VERSION = 1L
    const val PULL_MIN_GAP_MS = 10_000L
    const val HTTP_TIMEOUT_MS = 10_000L
    const val BACKOFF_MIN_MS = 1_000L
    const val BACKOFF_MAX_MS = 60_000L
    const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    const val PUSH_BATCH_RECORDS = 100
    const val PUSH_BATCH_BYTES = 1024 * 1024
    const val PUSH_MAX_ROUNDS = 20
    const val APPLY_BATCH = 200
    const val WRITE_BATCH = 200
    const val APPLY_SPLIT_AFTER = 3
    const val REBASE_LIMIT = 3
    const val REBASE_WINDOW_MS = 24L * 60 * 60 * 1000
    const val RECREATE_RETRY_MS = 60L * 60 * 1000
    const val JOIN_CONFIRM_MIN = 10

    /** 打ち切った回数から次の待ち時間を決める。jitter は 0 以上 1 未満 */
    fun backoffDelayMs(attempt: Int, jitter: Double): Long {
        val base = minOf(BACKOFF_MAX_MS, BACKOFF_MIN_MS shl minOf(attempt, 16))
        return Math.floor(base / 2.0 + (base / 2.0) * jitter).toLong()
    }
}
