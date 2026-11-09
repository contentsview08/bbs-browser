// 端末の同期の定数。スマホ版の SyncConfig.kt と packages/conformance/sync-config.json で揃える
export const SCHEMA_VERSION = 1
export const PULL_MIN_GAP_MS = 10_000
/** 履歴の画面に出す件数 */
export const HISTORY_SHOWN = 300
/** 通信の打ち切り。無通信が続く時間と、1 回の要求の全体の時間。遅い回線でも 1MB のページを読み切れるよう全体は長めにする */
export const HTTP_IDLE_TIMEOUT_MS = 10_000
export const HTTP_TOTAL_TIMEOUT_MS = 60_000
export const BACKOFF_MIN_MS = 1_000
export const BACKOFF_MAX_MS = 60_000
/** 429 の待ちの上限。サーバーが 1 時間・翌日と言ってきても、この間隔で 1 回だけ試す(日の上限は翌日まで待たずに戻れるように) */
export const RETRY_WAIT_MAX_MS = 600_000
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
/**
 * 利用者の操作(ログの削除・お気に入り・設定など)を積んでから送るまでの待ち。続けての操作を 1 回の書き込みにまとめる。
 * 選んだ間隔によらない(他の端末に出るまでを、送信の周の 5 分ではなく確認の間隔で決まるようにする)。読んだ位置は積むたびに送らず PUSH_INTERVAL_MS で送る
 */
export const PUSH_SOON_MS = 5_000
/** 確認が「変化なし」のたびに間隔を 2 倍にし、ここで止める(Cloudflare の無料枠に 100 人分を収めるため) */
export const HEAD_BACKOFF_MAX_MS = 300_000
/** サーバーの指示する間隔の上限。タイマーの上限(2^31-1 ms)を超えてすぐ発火しないように */
export const PACE_MAX_MS = 3_600_000
export const NET_SETTLE_MS = 5_000
export const NET_MIN_GAP_MS = 30_000
/** 窓の行き来(focus・blur)で周を回す最低の間隔。Alt+Tab を繰り返しても 1 分の要求の上限に当たらないように。
 * 裏へ回る・閉じるときの送信はこの間隔によらない。PC の窓のきっかけだけに使うので sync-config.json には置かない */
export const NUDGE_MIN_GAP_MS = 30_000
export const IDLE_STOP_MS = 10 * 60 * 1000

/**
 * 利用者が選ぶ同期の間隔(ほかの端末の変化を確かめる間隔)。端末ごとの設定で、同期しない。
 * manual は自動で確かめない(今すぐ同期と、この端末の変更の送り出しだけ)。変化なしが続いたときの伸ばし方・放置で止める・裏で止めるは間隔によらず残す
 */
export const SYNC_INTERVALS = [
  { id: '30s', ms: 30_000 },
  { id: '1m', ms: 60_000 },
  { id: '5m', ms: 300_000 },
  { id: '15m', ms: 900_000 },
  { id: 'manual', ms: null },
] as const
export type SyncIntervalId = (typeof SYNC_INTERVALS)[number]['id']
export const DEFAULT_SYNC_INTERVAL: SyncIntervalId = '1m'

/** 間隔の ms。手動のみは null。知らない値は既定 */
export function syncIntervalMs(id: string | null): number | null {
  const found = SYNC_INTERVALS.find((x) => x.id === id)
  return found ? found.ms : HEAD_INTERVAL_MS
}

/** 打ち切った回数から次の待ち時間を決める。jitter は 0 以上 1 未満 */
export function backoffDelayMs(attempt: number, jitter: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 16))
  return Math.floor(base / 2 + (base / 2) * jitter)
}
