// 開発用の同期の画面を出すか。書き出しに入らないよう、設定に置かない
import { SYNC_REVEAL_TAPS } from '@bbs-browser/sync'

const KEY = 'obb-sync-dev'

export function syncDevOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function openSyncDev(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // 開いている間だけ出す
  }
}

/** 押した回数を返す関数を作る。間が 2 秒空くと数え直す */
export function versionTapCounter(now: () => number = Date.now) {
  let count = 0
  let last = 0
  return (): boolean => {
    const t = now()
    count = t - last > 2000 ? 1 : count + 1
    last = t
    return count >= SYNC_REVEAL_TAPS
  }
}
