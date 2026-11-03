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

/** PC: マウスジェスチャー(円盤)だけの操作: 画面を開く */
export const MOUSE_OPEN_ACTIONS: { key: string; name: string }[] = [
  { key: 'settings', name: '設定を開く' },
  { key: 'history', name: '閲覧履歴を開く' },
  { key: 'favThreads', name: 'お気に入りのスレを開く' },
  { key: 'postHistory', name: '書き込み履歴を開く' },
  { key: 'uploads', name: '上げた画像を開く' },
  { key: 'notifications', name: '通知を開く' },
  { key: 'openUrl', name: 'URL を開く(入力欄)' },
  { key: 'newThread', name: 'スレを立てる(いまの板)' },
]

/** PC: マウスジェスチャー(円盤)だけの操作: スレ一覧の上のタブ(listTab:キー は設定で出しているタブだけ効く) */
export const MOUSE_LIST_ACTIONS: { key: string; name: string }[] = [
  { key: 'listTabNext', name: 'スレ一覧のタブを右へ' },
  { key: 'listTabPrev', name: 'スレ一覧のタブを左へ' },
  { key: 'listTab:unread', name: 'スレ一覧: 未読' },
  { key: 'listTab:visited', name: 'スレ一覧: 閲覧済み' },
  { key: 'listTab:momentum', name: 'スレ一覧: 勢い順' },
  { key: 'listTab:newest', name: 'スレ一覧: 新しい順' },
  { key: 'listTab:count', name: 'スレ一覧: レス数順' },
]

/** お気に入り板を開く操作のキー(board:板の URL) */
export const boardAction = (url: string) => `board:${url}`

/** PC: マウスジェスチャーに割り当てられる操作(キー操作すべて + 画面を開く + スレ一覧のタブ。お気に入り板は board:URL で、設定の画面がお気に入りから足す) */
export const MOUSE_GESTURE_ACTIONS: { key: string; name: string }[] = [...KEY_ACTIONS, ...MOUSE_OPEN_ACTIONS, ...MOUSE_LIST_ACTIONS]

/** 円盤に出す、操作の短い名前(説明の括弧書きを除く)。board:URL は favorites から板の名前(別名があれば別名) */
export function mouseActionName(action: string, favorites?: { url: string; name: string }[]): string | undefined {
  if (action.startsWith('board:')) {
    const url = action.slice(6)
    const b = favorites?.find((f) => f.url === url)
    return b ? b.name : url.replace(/^https?:\/\//, '')
  }
  return MOUSE_GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '')
}
