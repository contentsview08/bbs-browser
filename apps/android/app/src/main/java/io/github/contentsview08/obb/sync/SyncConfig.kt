package io.github.contentsview08.obb.sync

// 端末の同期の定数。PC 版の packages/sync/src/config.ts と packages/conformance/sync-config.json で揃える
object SyncConfig {
    const val SCHEMA_VERSION = 1L
    const val PULL_MIN_GAP_MS = 10_000L
    /** 履歴の画面に出す件数 */
    const val HISTORY_SHOWN = 300
    /** 通信の打ち切り。無通信が続く時間と、1 回の要求の全体の時間。遅い回線でも 1MB のページを読み切れるよう全体は長めにする */
    const val HTTP_IDLE_TIMEOUT_MS = 10_000L
    const val HTTP_TOTAL_TIMEOUT_MS = 60_000L
    const val BACKOFF_MIN_MS = 1_000L
    const val BACKOFF_MAX_MS = 60_000L
    /** 429 の待ちの上限。サーバーが 1 時間・翌日と言ってきても、この間隔で 1 回だけ試す(日の上限は翌日まで待たずに戻れるように) */
    const val RETRY_WAIT_MAX_MS = 600_000L
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

    /** 1 回のログの削除で書くリセットの数。これを超えた分は手元からだけ消える。1 件 528 バイトなので 2,000 件で約 1MB */
    const val RESET_BATCH_MAX = 2000

    /** 領域のリセットの総数。read_reset は容量超過でも外さないので、ここで容量の 4 分の 1 に抑える */
    const val RESET_TOTAL_MAX = 5000

    /** 容量を超えたとき 1 回に外す件数と、1 周で外す回数 */
    const val TRIM_BATCH = 100
    const val TRIM_ROUNDS = 5

    /** 自動の同期の既定値はここだけに置く。サーバーの応答の指示より短くしない(engine/SyncScheduler.kt) */
    const val HEAD_INTERVAL_MS = 60_000L
    const val PUSH_INTERVAL_MS = 300_000L
    /** 確認が「変化なし」のたびに間隔を 2 倍にし、ここで止める(Cloudflare の無料枠に 100 人分を収めるため) */
    const val HEAD_BACKOFF_MAX_MS = 300_000L
    /** サーバーの指示する間隔の上限。足し算があふれず、確認が止まりっぱなしにならないように */
    const val PACE_MAX_MS = 3_600_000L
    const val NET_SETTLE_MS = 5_000L
    const val NET_MIN_GAP_MS = 30_000L
    const val IDLE_STOP_MS = 10L * 60 * 1000

    /** 打ち切った回数から次の待ち時間を決める。jitter は 0 以上 1 未満 */
    fun backoffDelayMs(attempt: Int, jitter: Double): Long {
        val base = minOf(BACKOFF_MAX_MS, BACKOFF_MIN_MS shl minOf(attempt, 16))
        return Math.floor(base / 2.0 + (base / 2.0) * jitter).toLong()
    }
}
