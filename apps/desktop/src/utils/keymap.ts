// キー操作の割り当て。設定で変えられる。キーは「Ctrl+Shift+J」のような文字列で表す。
// Esc(ポップアップを閉じる・絞り込みを解く)と、タブの Ctrl+Tab / Ctrl+W / Delete は決め打ちで、ここでは扱わない。

/** キーで呼べる操作 */
export type KeyAction =
  // スレ表示(スレ一覧でも同じキーで、それに当たる操作をする)
  | 'nextPost'
  | 'prevPost'
  | 'pageDown'
  | 'pageUp'
  | 'halfDown'
  | 'halfUp'
  | 'top'
  | 'bottom'
  | 'unread'
  | 'refresh'
  | 'search'
  | 'reply'
  | 'replyToPost'
  | 'favorite'
  | 'gallery'
  | 'copyUrl'
  | 'findNext'
  // アプリ全体(どちらにキーが向いていても効く)
  | 'nextTab'
  | 'prevTab'
  | 'back'
  | 'forward'
  | 'closeTab'
  | 'reopenTab'
  | 'focusUrl'
  | 'toggleSidebar'
  | 'zoomIn'
  | 'zoomOut'
  | 'help'

/** where: 'view' はスレ表示・スレ一覧の、キーを受け取っている方で効く。'app' はどこでも効く */
export const KEY_ACTIONS: { key: KeyAction; name: string; where: 'view' | 'app' }[] = [
  { key: 'nextPost', name: '次のレスへ(スレ一覧では次のスレを選ぶ)', where: 'view' },
  { key: 'prevPost', name: '前のレスへ(スレ一覧では前のスレを選ぶ)', where: 'view' },
  { key: 'pageDown', name: '1 画面下へ', where: 'view' },
  { key: 'pageUp', name: '1 画面上へ', where: 'view' },
  { key: 'halfDown', name: '半画面下へ', where: 'view' },
  { key: 'halfUp', name: '半画面上へ', where: 'view' },
  { key: 'top', name: '先頭へ', where: 'view' },
  { key: 'bottom', name: '一番下へ', where: 'view' },
  { key: 'unread', name: '最初の未読へ', where: 'view' },
  { key: 'refresh', name: '更新', where: 'view' },
  { key: 'search', name: '検索', where: 'view' },
  { key: 'reply', name: '書き込み欄へ(スレ一覧ではスレ立て)', where: 'view' },
  { key: 'replyToPost', name: 'いま見ているレスに返信', where: 'view' },
  { key: 'favorite', name: 'お気に入りのスレに足す・外す(スレ一覧では選んでいるスレ)', where: 'view' },
  { key: 'gallery', name: '画像一覧', where: 'view' },
  { key: 'copyUrl', name: 'スレの URL をコピー(スレ一覧では選んでいるスレ)', where: 'view' },
  { key: 'findNext', name: '次スレを探す', where: 'view' },
  { key: 'nextTab', name: '次のタブ', where: 'app' },
  { key: 'prevTab', name: '前のタブ', where: 'app' },
  { key: 'back', name: '戻る', where: 'app' },
  { key: 'forward', name: '進む', where: 'app' },
  { key: 'closeTab', name: 'タブを閉じる', where: 'app' },
  { key: 'reopenTab', name: '閉じたタブを開き直す', where: 'app' },
  { key: 'focusUrl', name: 'URL 欄へ', where: 'app' },
  { key: 'toggleSidebar', name: 'サイドバーを広げる・しまう', where: 'app' },
  { key: 'zoomIn', name: '文字を大きく', where: 'app' },
  { key: 'zoomOut', name: '文字を小さく', where: 'app' },
  { key: 'help', name: 'キー操作の一覧', where: 'app' },
]

export type Keymap = Record<KeyAction, string[]>

// vim(ブラウザの拡張 Vimium)に寄せた割り当て。入力欄の外では文字を打たないので、1 文字のキーでもほかとぶつからない。
// 普通のキー(Space・PageDown・Home・End・Ctrl+F・Ctrl+L など)も並べておく
export const DEFAULT_KEYMAP: Keymap = {
  nextPost: ['J'],
  prevPost: ['K'],
  pageDown: ['Space', 'PageDown'],
  pageUp: ['Shift+Space', 'PageUp'],
  halfDown: ['D'],
  halfUp: ['U'],
  top: ['Home', 'G'],
  bottom: ['End', 'Shift+G'],
  unread: ['N'],
  // F5・Ctrl+R はアプリ全体で決め打ち(キーを受け取っている方を更新する。App.tsx)
  refresh: ['R'],
  search: ['/', 'Ctrl+F'],
  reply: ['W', 'E'],
  replyToPost: ['Shift+E'],
  favorite: ['S'],
  gallery: ['I'],
  copyUrl: ['Y'],
  findNext: ['Shift+N'],
  nextTab: ['Shift+J'],
  prevTab: ['Shift+K'],
  back: ['Shift+H'],
  forward: ['Shift+L'],
  closeTab: ['X'],
  reopenTab: ['Shift+X'],
  focusUrl: ['Ctrl+L', 'O'],
  toggleSidebar: ['Ctrl+B'],
  zoomIn: ['Ctrl+=', 'Ctrl++', 'Ctrl+;'],
  zoomOut: ['Ctrl+-'],
  help: ['?'],
}

/** 割り当ては変えられない、決め打ちのキー(キー操作の一覧と設定の画面に出す) */
export const FIXED_KEYS: { keys: string; name: string }[] = [
  { keys: 'F5・Ctrl+R', name: '更新(キーを受け取っている方)' },
  { keys: 'Ctrl+E', name: 'キーを受け取る方を、スレ一覧とスレ表示で入れ替える' },
  { keys: 'Esc', name: 'ポップアップを閉じる・絞り込みを外す・書き込み欄をしまう' },
  { keys: '1〜4・5', name: 'スレ表示：人気・画像・動画・リンクで絞り込む・すべて' },
  { keys: '1・2・3', name: 'スレ一覧：未読だけ・勢い順・新しい順' },
  { keys: 'Enter', name: 'スレ一覧：選んでいるスレを開く' },
  { keys: 'Ctrl+Enter', name: '書き込む(書き込み欄で)' },
  { keys: 'Ctrl+Tab・Ctrl+Shift+Tab', name: '次・前のタブ(Ctrl を離すまで選ぶだけ)' },
  { keys: 'Ctrl+PageDown・Ctrl+PageUp', name: '次・前のタブ' },
  { keys: 'Ctrl+W・Ctrl+Shift+W', name: 'タブを閉じる・すべてのタブを閉じる' },
  { keys: 'Delete', name: 'タブを閉じる' },
  { keys: 'Shift+Delete', name: 'ログを削除してタブを閉じる(確かめてから)' },
  { keys: 'Alt+← →・マウスの戻る/進む', name: '戻る・進む' },
]

/** 保存してある割り当てに、あとから増えた操作の既定値を足す */
export function resolveKeymap(saved: Partial<Keymap> | undefined): Keymap {
  return { ...DEFAULT_KEYMAP, ...saved }
}

/** 修飾キーだけを押したとき(割り当てには使わない) */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Process', 'Unidentified'])

/**
 * 押したキーを「Ctrl+Shift+J」の形にする。修飾キーだけのときは undefined。
 * 英字は大文字にそろえ、Shift を付けて区別する(j と Shift+J)。
 * 記号はキーボードの並びで Shift の要る・要らないが変わるので、Shift を付けずに文字そのもので表す(/ や ?)
 */
export function keyString(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string | undefined {
  if (MODIFIER_KEYS.has(e.key)) return undefined
  let base: string
  let shiftMatters = true
  if (e.key === ' ' || e.key === 'Spacebar') base = 'Space'
  else if (e.key.length === 1) {
    base = e.key.toUpperCase()
    shiftMatters = /[A-Z]/.test(base)
  } else base = e.key
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && shiftMatters) parts.push('Shift')
  parts.push(base)
  return parts.join('+')
}

/** 押したキーに割り当てた操作。なければ undefined */
export function actionFor(keymap: Keymap, key: string | undefined): KeyAction | undefined {
  if (!key) return undefined
  return (Object.keys(keymap) as KeyAction[]).find((a) => keymap[a].includes(key))
}

/** WebView がページごと読み直してしまうキー(F5・Ctrl+R)。アプリでは止める */
export function isReloadKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')
}

/** 画面に出すときの書き方 */
export function keyLabel(key: string): string {
  return key.replace('Space', 'スペース')
}
