// キー操作の割り当て。設定で変えられる。キーは「Ctrl+Shift+J」のような文字列で表す。
// Esc(ポップアップを閉じる・絞り込みを解く)と、タブの Ctrl+Tab / Ctrl+W / Delete は決め打ちで、ここでは扱わない。

/** スレ表示で使う操作 */
export type KeyAction =
  | 'nextPost'
  | 'prevPost'
  | 'pageDown'
  | 'pageUp'
  | 'top'
  | 'bottom'
  | 'unread'
  | 'refresh'
  | 'search'
  | 'reply'

export const KEY_ACTIONS: { key: KeyAction; name: string }[] = [
  { key: 'nextPost', name: '次のレスへ' },
  { key: 'prevPost', name: '前のレスへ' },
  { key: 'pageDown', name: '1 画面下へ' },
  { key: 'pageUp', name: '1 画面上へ' },
  { key: 'top', name: '先頭へ' },
  { key: 'bottom', name: '一番下へ' },
  { key: 'unread', name: '最初の未読へ' },
  { key: 'refresh', name: 'スレを更新' },
  { key: 'search', name: 'レスを検索' },
  { key: 'reply', name: '書き込み欄へ(スレ一覧ではスレ立て)' },
]

export type Keymap = Record<KeyAction, string[]>

export const DEFAULT_KEYMAP: Keymap = {
  nextPost: ['J'],
  prevPost: ['K'],
  pageDown: ['Space', 'PageDown'],
  pageUp: ['Shift+Space', 'PageUp'],
  top: ['Home', 'G'],
  bottom: ['End', 'Shift+G'],
  unread: ['U'],
  // F5・Ctrl+R はアプリ全体で決め打ち(開いているスレ、なければスレ一覧を更新する。App.tsx)
  refresh: ['R'],
  search: ['/', 'Ctrl+F'],
  reply: ['W', 'E'],
}

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
