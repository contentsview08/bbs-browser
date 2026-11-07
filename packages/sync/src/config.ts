// 端末の同期の定数。スマホ版の SyncConfig.kt と packages/conformance/sync-config.json で揃える
export const SCHEMA_VERSION = 1
export const PULL_MIN_GAP_MS = 10_000
/** 履歴の画面に出す件数 */
export const HISTORY_SHOWN = 300
export const HTTP_TIMEOUT_MS = 10_000
export const BACKOFF_MIN_MS = 1_000
export const BACKOFF_MAX_MS = 60_000
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const PUSH_BATCH_RECORDS = 100
export const PUSH_BATCH_BYTES = 1024 * 1024
export const PUSH_MAX_ROUNDS = 20
export const APPLY_BATCH = 200
export const WRITE_BATCH = 200
export const APPLY_SPLIT_AFTER = 3
export const REBASE_LIMIT = 3
export const REBASE_WINDOW_MS = 24 * 60 * 60 * 1000
export const RECREATE_RETRY_MS = 60 * 60 * 1000
export const JOIN_CONFIRM_MIN = 10
export const LEASE_MS = 90_000
/** 1 回のログの削除で書くリセットの数。これを超えた分は手元からだけ消える。1 件 528 バイトなので 2,000 件で約 1MB */
export const RESET_BATCH_MAX = 2000
/** 領域のリセットの総数。read_reset は容量超過でも外さないので、ここで容量の 4 分の 1 に抑える(5,000 件で約 2.6MB) */
export const RESET_TOTAL_MAX = 5000

/** 容量超過のとき、1 回に外す数と、1 周で試す回数 */
export const TRIM_BATCH = 100
export const TRIM_ROUNDS = 5

/** 自動の同期の既定値はここだけに置く。サーバーの応答の指示より短くしない(engine/scheduler.ts) */
export const HEAD_INTERVAL_MS = 60_000
export const PUSH_INTERVAL_MS = 300_000
/** 確認が「変化なし」のたびに間隔を 2 倍にし、ここで止める(Cloudflare の無料枠に 100 人分を収めるため) */
export const HEAD_BACKOFF_MAX_MS = 300_000
export const NET_SETTLE_MS = 5_000
export const NET_MIN_GAP_MS = 30_000
export const IDLE_STOP_MS = 10 * 60 * 1000

/** 打ち切った回数から次の待ち時間を決める。jitter は 0 以上 1 未満 */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 16))
  return Math.floor(base / 2 + (base / 2) * jitter)
}
