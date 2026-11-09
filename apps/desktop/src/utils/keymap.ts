// キー操作の割り当て。設定で変えられる。キーは「Ctrl+Shift+J」のような文字列で表す。
// 決め打ちは Esc(閉じる・外す)・Ctrl+Enter(書き込む)・数字(絞り込み・スレ一覧のタブ)だけ。ほかは既定の割り当てで、設定で変えられる。

/** キーで呼べる操作 */
export type KeyAction =
  // スレ表示(スレ一覧でも同じキーで、それに当たる操作をする)
  | 'nextPost'
  | 'prevPost'
  | 'openPost'
  | 'anchorTree'
  | 'copyPost'
  | 'postsById'
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
  | 'autoScroll'
  | 'peek'
  // アプリ全体(どちらにキーが向いていても効く)
  | 'switchPane'
  | 'nextTab'
  | 'prevTab'
  | 'back'
  | 'forward'
  | 'closeTab'
  | 'closeAllTabs'
  | 'deleteLogAndClose'
  | 'reload'
  | 'reopenTab'
  | 'focusUrl'
  | 'toggleSidebar'
  | 'zoomIn'
  | 'zoomOut'
  | 'help'
  | 'patrol'
  | 'palette'

/** where: 'view' はスレ表示・スレ一覧の、キーを受け取っている方で効く。'app' はどこでも効く */
export const KEY_ACTIONS: { key: KeyAction; name: string; where: 'view' | 'app' }[] = [
  { key: 'nextPost', name: '次のレスを選ぶ(スレ一覧では次のスレ)', where: 'view' },
  { key: 'prevPost', name: '前のレスを選ぶ(スレ一覧では前のスレ)', where: 'view' },
  { key: 'openPost', name: '選んでいるレスの画像を開く(なければ返信を出す。スレ一覧では選んでいるスレを開く)', where: 'view' },
  { key: 'anchorTree', name: '選んでいるレスのアンカーツリー', where: 'view' },
  { key: 'copyPost', name: '選んでいるレスの本文をコピー', where: 'view' },
  { key: 'postsById', name: '選んでいるレスの ID のレスを出す', where: 'view' },
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
  { key: 'replyToPost', name: '選んでいるレス(J・K で送った・押した)に返信', where: 'view' },
  { key: 'favorite', name: 'お気に入りのスレに足す・外す(スレ一覧では選んでいるスレ)', where: 'view' },
  { key: 'gallery', name: '画像一覧', where: 'view' },
  { key: 'copyUrl', name: 'スレの URL をコピー(スレ一覧では選んでいるスレ)', where: 'view' },
  { key: 'findNext', name: '次スレを探す', where: 'view' },
  { key: 'autoScroll', name: '実況モード(入れる・やめる)', where: 'view' },
  { key: 'peek', name: 'スレを開かずに中身をのぞく(スレ一覧で。中身が一緒に届く掲示板だけ)', where: 'view' },
  { key: 'switchPane', name: 'キーを受け取る方を、スレ一覧とスレ表示で入れ替える(1 画面なら見せる方を入れ替える)', where: 'app' },
  { key: 'nextTab', name: '次のタブ', where: 'app' },
  { key: 'prevTab', name: '前のタブ', where: 'app' },
  { key: 'back', name: '戻る', where: 'app' },
  { key: 'forward', name: '進む', where: 'app' },
  { key: 'closeTab', name: 'タブを閉じる', where: 'app' },
  { key: 'closeAllTabs', name: 'すべてのタブを閉じる', where: 'app' },
  { key: 'deleteLogAndClose', name: 'ログを削除してタブを閉じる(確かめてから)', where: 'app' },
  { key: 'reload', name: '更新(キーを受け取っている方。スレを開いていなければスレ一覧)', where: 'app' },
  { key: 'reopenTab', name: '閉じたタブを開き直す', where: 'app' },
  { key: 'focusUrl', name: 'URL 欄へ', where: 'app' },
  { key: 'toggleSidebar', name: 'サイドバーを広げる・しまう', where: 'app' },
  { key: 'zoomIn', name: '文字を大きく', where: 'app' },
  { key: 'zoomOut', name: '文字を小さく', where: 'app' },
  { key: 'patrol', name: '未読の巡回(未読のあるタブ・お気に入りのスレへ順に移り、新着の頭から読む)', where: 'app' },
  { key: 'palette', name: 'コマンドパレット(板・スレ・操作を名前で探す)', where: 'app' },
  { key: 'help', name: 'キー操作の一覧', where: 'app' },
]

export type Keymap = Record<KeyAction, string[]>

// vim(ブラウザの拡張 Vimium)に寄せた割り当て。入力欄の外では文字を打たないので、1 文字のキーでもほかとぶつからない。
// 普通のキー(Space・PageDown・Home・End・Ctrl+F・Ctrl+L など)も並べておく
export const DEFAULT_KEYMAP: Keymap = {
  nextPost: ['J', 'ArrowDown'],
  prevPost: ['K', 'ArrowUp'],
  openPost: ['Enter'],
  anchorTree: ['T'],
  copyPost: ['C'],
  postsById: ['Shift+I'],
  pageDown: ['Space', 'PageDown'],
  pageUp: ['Shift+Space', 'PageUp'],
  halfDown: ['D'],
  halfUp: ['U'],
  // vim と同じく g を 2 回で先頭(1 回では動かない)
  top: ['Home', 'G G'],
  bottom: ['End', 'Shift+G'],
  unread: ['N'],
  refresh: ['R'],
  search: ['/', 'Ctrl+F'],
  reply: ['W', 'E'],
  replyToPost: ['Shift+E'],
  favorite: ['S'],
  gallery: ['I'],
  copyUrl: ['Y'],
  findNext: ['Shift+N'],
  autoScroll: ['A'],
  peek: ['P'],
  switchPane: ['Ctrl+E'],
  nextTab: ['Shift+J', 'Ctrl+Tab', 'Ctrl+PageDown'],
  prevTab: ['Shift+K', 'Ctrl+Shift+Tab', 'Ctrl+PageUp'],
  back: ['Shift+H', 'Alt+ArrowLeft'],
  forward: ['Shift+L', 'Alt+ArrowRight'],
  closeTab: ['X', 'Ctrl+W', 'Delete'],
  closeAllTabs: ['Ctrl+Shift+W'],
  deleteLogAndClose: ['Shift+Delete'],
  reload: ['F5', 'Ctrl+R'],
  reopenTab: ['Shift+X'],
  focusUrl: ['Ctrl+L', 'O'],
  toggleSidebar: ['Ctrl+B'],
  zoomIn: ['Ctrl+=', 'Ctrl++', 'Ctrl+;'],
  zoomOut: ['Ctrl+-'],
  help: ['?'],
  patrol: ['Shift+U'],
  palette: ['Ctrl+K', ':'],
}

/** 割り当ては変えられない、決め打ちのキー(キー操作の一覧と設定の画面に出す)。画面の作りに結びついているものだけ */
export const FIXED_KEYS: { keys: string; name: string }[] = [
  { keys: 'Esc', name: 'ポップアップを閉じる・絞り込みを外す・書き込み欄をしまう' },
  { keys: '1〜4・5', name: 'スレ表示：人気・画像・動画・リンクで絞り込む・すべて' },
  { keys: '1・2・3…', name: 'スレ一覧：上のタブを左から順に押す(タブは設定で選べる)' },
  { keys: 'Ctrl+Enter', name: '書き込む(書き込み欄で)' },
  { keys: 'マウスの戻る/進む', name: '戻る・進む' },
]

/** 決め打ちのキー(keyString の形)と、その役目。設定でここに割り当てようとしたら断る */
const RESERVED_KEYS: Record<string, string> = {
  Escape: '閉じる・外す',
  'Ctrl+Enter': '書き込む',
  ...Object.fromEntries([...'123456789'].map((d) => [d, '絞り込み・スレ一覧のタブ'])),
}

/** 決め打ちのキーなら、その役目。割り当てられるキーなら undefined */
export function reservedKeyName(key: string): string | undefined {
  return RESERVED_KEYS[key]
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

/**
 * 割り当てたキー(「Shift+G」「G G」「Ctrl++」)を、押したことにするキーの並びにする。
 * スマホのスワイプから、キー操作と同じ操作を呼ぶのに使う(keyString の逆)
 */
export function keyEventsOf(key: string): { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }[] {
  return key.split(' ').map((k) => {
    // 「Ctrl++」のように、+ そのものがキーのとき
    const plus = k.endsWith('++')
    const parts = (plus ? k.slice(0, -2) : k).split('+').filter(Boolean)
    const base = plus ? '+' : (parts.pop() ?? '')
    const mods = new Set(parts)
    const shiftKey = mods.has('Shift')
    let name = base === 'Space' ? ' ' : base
    if (/^[A-Z]$/.test(name) && !shiftKey) name = name.toLowerCase()
    return { key: name, ctrlKey: mods.has('Ctrl'), shiftKey, altKey: mods.has('Alt'), metaKey: false }
  })
}

/** 2 つ続けて押すキー(「G G」)とみなす間隔 */
const SEQUENCE_MS = 600

/**
 * キーを読んで、割り当てた操作を返すもの。「G G」のように 2 つ続けて押すキーも見分ける
 * (直前のキーと合わせた組に割り当てがあればそれ、なければ今のキー 1 つの割り当て)。受け取る所ごとに 1 つ作る
 */
export function createKeyReader() {
  let prev: { key: string; at: number } | undefined
  return (keymap: Keymap, e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): KeyAction | undefined => {
    const key = keyString(e)
    if (!key) return undefined
    const now = Date.now()
    const pair = prev && now - prev.at < SEQUENCE_MS ? actionFor(keymap, `${prev.key} ${key}`) : undefined
    // 組になったら、次の 1 つ目からやり直す(G を 3 回押しても、2 回目と 3 回目で組にしない)
    prev = pair ? undefined : { key, at: now }
    return pair ?? actionFor(keymap, key)
  }
}

/** 押したキーに割り当てた操作。なければ undefined */
export function actionFor(keymap: Keymap, key: string | undefined): KeyAction | undefined {
  if (!key) return undefined
  return (Object.keys(keymap) as KeyAction[]).find((a) => keymap[a].includes(key))
}

/** 操作のキーを決める。同じキーが 2 つの操作に付かないよう、ほかの操作からは外す */
export function setActionKeys(keymap: Keymap, action: KeyAction, keys: string[]): Keymap {
  const next = { ...keymap }
  for (const a of Object.keys(next) as KeyAction[]) next[a] = next[a].filter((k) => !keys.includes(k))
  next[action] = keys
  return next
}

/** WebView がページごと読み直してしまうキー(F5・Ctrl+R)。アプリでは止める */
export function isReloadKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')
}

/** 画面に出すときの書き方 */
export function keyLabel(key: string): string {
  return key.replace('Space', 'スペース').replace('ArrowDown', '↓').replace('ArrowUp', '↑').replace('ArrowLeft', '←').replace('ArrowRight', '→')
}

/** ダイアログ(NG に追加・キー一覧・設定など)が開いているか。開いている間は、後ろの画面のキー操作を止める(hooks/useFocusTrap.ts) */
export function modalOpen(): boolean {
  return document.querySelector('[data-modal]') !== null
}

/** 文字を打つ欄の中か(キー操作を効かせない) */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}
