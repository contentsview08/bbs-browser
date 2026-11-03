// スマホのスワイプに割り当てられる操作。キー操作の操作(KeyAction)に、スワイプだけの操作を足したもの
import { KEY_ACTIONS } from './keymap'

/** スワイプだけの操作 */
export const GESTURE_ONLY_ACTIONS: { key: string; name: string }[] = [
  { key: 'drawer', name: 'メニュー(引き出し)を開く' },
  { key: 'deleteLog', name: 'ログを削除して閉じる' },
]

/** タブの操作。スマホはタブを使わない(スレは 1 つだけ開き、前の画面へは「戻る」で行く)ので、割り当てない */
const TAB_ACTIONS = new Set(['nextTab', 'prevTab', 'closeTab', 'reopenTab'])

/** スワイプに割り当てられる操作の一覧(設定の画面で選ぶ) */
export const GESTURE_ACTIONS: { key: string; name: string }[] = [...GESTURE_ONLY_ACTIONS, ...KEY_ACTIONS.filter((a) => !TAB_ACTIONS.has(a.key))]

/** なぞっている間に出す、操作の短い名前(説明の括弧書きを除く) */
export function gestureActionName(action: string): string | undefined {
  return GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '')
}

/** PC: マウスジェスチャー(円盤)だけの操作(キー操作にない、画面を開くもの) */
export const MOUSE_ONLY_ACTIONS: { key: string; name: string }[] = [
  { key: 'settings', name: '設定を開く' },
  { key: 'history', name: '閲覧履歴を開く' },
  { key: 'favThreads', name: 'お気に入りのスレを開く' },
  { key: 'notifications', name: '通知を開く' },
  { key: 'openUrl', name: 'URL を開く(入力欄)' },
]

/** PC: マウスジェスチャーに割り当てられる操作(キー操作すべて + 画面を開く操作) */
export const MOUSE_GESTURE_ACTIONS: { key: string; name: string }[] = [...KEY_ACTIONS, ...MOUSE_ONLY_ACTIONS]

/** マウスを動かしている間に出す、操作の短い名前(説明の括弧書きを除く) */
export function mouseActionName(action: string): string | undefined {
  return MOUSE_GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '')
}
