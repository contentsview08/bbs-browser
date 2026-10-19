// スレ表示とスレ一覧の操作ボタンを、どこに置くか。設定で変えられる。
// どのボタンも、いつも右端の ︙ の中には出る。ヘッダーかフッターに置いたものだけ、帯にも並ぶ。
// スマホでは画面の幅が狭いので、ヘッダーとフッターの両方を使う。置き場所は PC とは別に持ち、既定も別(mobile)。
// スマホだけの操作(一覧に戻る・書き込む・引き出しを開くなど)もある(mobileOnly)

export type Placement = 'header' | 'footer' | 'menu'

export type BarArea = 'thread' | 'list'

export interface BarActionDef {
  id: string
  name: string
  icon: string
  /** 既定の置き場所 */
  placement: Placement
  /** スマホでの既定の置き場所(なければ placement) */
  mobile?: Placement
  /** スマホだけの操作 */
  mobileOnly?: boolean
  /** PC だけの操作(書き込み欄の位置など) */
  desktopOnly?: boolean
}

/** スレ表示の操作(並べる順) */
export const THREAD_ACTIONS: BarActionDef[] = [
  { id: 'back', name: '一覧に戻る', icon: 'arrow_back', placement: 'menu', mobile: 'footer', mobileOnly: true },
  { id: 'search', name: 'レス検索', icon: 'search', placement: 'header' },
  { id: 'favorite', name: 'お気に入りのスレ', icon: 'star', placement: 'header', mobile: 'menu' },
  { id: 'openBoard', name: '板に戻る', icon: 'list', placement: 'menu' },
  { id: 'findNext', name: '次スレを探す', icon: 'skip_next', placement: 'menu' },
  { id: 'gallery', name: '画像一覧', icon: 'photo_library', placement: 'menu' },
  { id: 'top', name: '先頭へ', icon: 'vertical_align_top', placement: 'menu', mobileOnly: true },
  { id: 'bottom', name: '一番下へ', icon: 'vertical_align_bottom', placement: 'menu', mobileOnly: true },
  { id: 'reply', name: '書き込む', icon: 'edit', placement: 'menu', mobile: 'footer', mobileOnly: true },
  { id: 'replyToggle', name: '書き込み欄を出す・しまう', icon: 'keyboard_hide', placement: 'header', desktopOnly: true },
  { id: 'replyLayout', name: '書き込み欄の位置', icon: 'view_sidebar', placement: 'header', desktopOnly: true },
  { id: 'delete', name: 'ログを削除して閉じる', icon: 'delete', placement: 'header', mobile: 'menu' },
  { id: 'openBrowser', name: 'ブラウザで開く', icon: 'open_in_new', placement: 'menu' },
  { id: 'save', name: 'スレを保存', icon: 'save', placement: 'menu', desktopOnly: true },
  { id: 'drawer', name: 'メニュー(引き出し)', icon: 'menu', placement: 'menu', mobileOnly: true },
  { id: 'style', name: '表示スタイル', icon: 'palette', placement: 'menu' },
  { id: 'refresh', name: '更新', icon: 'refresh', placement: 'header', mobile: 'footer' },
]

/** スレ一覧の操作(並べる順) */
export const LIST_ACTIONS: BarActionDef[] = [
  { id: 'drawer', name: 'メニュー(引き出し)', icon: 'menu', placement: 'menu', mobileOnly: true },
  { id: 'search', name: 'スレッド検索', icon: 'search', placement: 'header' },
  // スマホでは、左下の丸いボタンでも立てられる
  { id: 'newThread', name: 'スレを立てる', icon: 'edit_square', placement: 'header', mobile: 'menu' },
  { id: 'favorite', name: 'お気に入り板', icon: 'star', placement: 'header', mobile: 'menu' },
  { id: 'style', name: '表示スタイル', icon: 'palette', placement: 'header', mobile: 'menu' },
  { id: 'top', name: '先頭へ', icon: 'vertical_align_top', placement: 'menu', mobileOnly: true },
  { id: 'refresh', name: '更新', icon: 'refresh', placement: 'header', mobile: 'footer' },
]

export const BAR_ACTIONS: Record<BarArea, BarActionDef[]> = { thread: THREAD_ACTIONS, list: LIST_ACTIONS }

/**
 * スマホの ︙ に出す操作。帯(ヘッダー・フッター)に出ているものと、いつも別の所にあるもの
 * (左上のメニュー・戻るのジェスチャー・フッターの入力欄)は出さず、よく使う順に並べ直す
 */
const MOBILE_MENU_HIDDEN = new Set(['drawer', 'back', 'reply'])
const MOBILE_MENU_ORDER: Record<BarArea, string[]> = {
  thread: ['favorite', 'gallery', 'findNext', 'search', 'openBoard', 'top', 'bottom', 'style', 'openBrowser', 'refresh', 'delete'],
  list: ['newThread', 'favorite', 'search', 'top', 'style', 'refresh'],
}
export function mobileMenuActions<T extends { id: string }>(area: BarArea, actions: T[], placements: Record<string, Placement>): T[] {
  const order = MOBILE_MENU_ORDER[area]
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length)
  return actions.filter((a) => placements[a.id] === 'menu' && !MOBILE_MENU_HIDDEN.has(a.id)).sort((a, b) => rank(a.id) - rank(b.id))
}

/** 設定に保存する形。変えたものだけ持つ(あとで増えた操作は既定の置き場所になる) */
export type BarLayout = Partial<Record<BarArea, Record<string, Placement>>>

/** その画面(PC かスマホか)で使える操作 */
export function barActionsFor(area: BarArea, mobile: boolean): BarActionDef[] {
  return BAR_ACTIONS[area].filter((a) => (mobile ? !a.desktopOnly : !a.mobileOnly))
}

/**
 * 操作 id → 置き場所。保存してある置き場所に、既定を足したもの。
 * mobile なら、スマホの操作と既定で(保存してある置き場所も、スマホの分 = settings.mobileBarLayout を渡す)
 */
export function resolvePlacements(area: BarArea, saved: BarLayout | undefined, mobile = false): Record<string, Placement> {
  const out: Record<string, Placement> = {}
  for (const a of barActionsFor(area, mobile)) out[a.id] = saved?.[area]?.[a.id] ?? (mobile ? (a.mobile ?? a.placement) : a.placement)
  return out
}
