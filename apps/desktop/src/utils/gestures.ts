// スマホのスワイプに割り当てられる操作。キー操作の操作(KeyAction)に、スワイプだけの操作を足したもの
import { KEY_ACTIONS } from './keymap'

/** スワイプだけの操作 */
export const GESTURE_ONLY_ACTIONS: { key: string; name: string }[] = [
  { key: 'drawer', name: 'メニュー(引き出し)を開く' },
  { key: 'deleteLog', name: 'ログを削除して閉じる' },
]

/** スワイプに割り当てられる操作の一覧(設定の画面で選ぶ) */
export const GESTURE_ACTIONS: { key: string; name: string }[] = [...GESTURE_ONLY_ACTIONS, ...KEY_ACTIONS]

/** なぞっている間に出す、操作の短い名前(説明の括弧書きを除く) */
export function gestureActionName(action: string): string | undefined {
  return GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '')
}
