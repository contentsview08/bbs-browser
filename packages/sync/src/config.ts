// 端末の同期の定数。スマホ版の SyncConfig.kt と packages/conformance/sync-config.json で揃える
export const SCHEMA_VERSION = 1
export const PULL_MIN_GAP_MS = 10_000
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

/** 打ち切った回数から次の待ち時間を決める。jitter は 0 以上 1 未満 */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 16))
  return Math.floor(base / 2 + (base / 2) * jitter)
}
