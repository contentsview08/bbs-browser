// スレ表示とスレ一覧の操作ボタンを、どこに置くか。設定で変えられる。
// どのボタンも、いつも右端の ︙ の中には出る。ヘッダーかフッターに置いたものだけ、帯にも並ぶ

export type Placement = 'header' | 'footer' | 'menu'

export type BarArea = 'thread' | 'list'

export interface BarActionDef {
  id: string
  name: string
  icon: string
  /** 既定の置き場所 */
  placement: Placement
}

/** スレ表示の操作(並べる順) */
export const THREAD_ACTIONS: BarActionDef[] = [
  { id: 'search', name: 'レス検索', icon: 'search', placement: 'header' },
  { id: 'favorite', name: 'お気に入りのスレ', icon: 'star', placement: 'header' },
  { id: 'findNext', name: '次スレを探す', icon: 'skip_next', placement: 'menu' },
  { id: 'replyLayout', name: '書き込み欄の位置', icon: 'view_sidebar', placement: 'header' },
  { id: 'delete', name: 'ログを削除して閉じる', icon: 'delete', placement: 'header' },
  { id: 'openBrowser', name: 'ブラウザで開く', icon: 'open_in_new', placement: 'menu' },
  { id: 'refresh', name: '更新', icon: 'refresh', placement: 'header' },
]

/** スレ一覧の操作(並べる順) */
export const LIST_ACTIONS: BarActionDef[] = [
  { id: 'search', name: 'スレッド検索', icon: 'search', placement: 'header' },
  { id: 'newThread', name: 'スレを立てる', icon: 'edit_square', placement: 'header' },
  { id: 'favorite', name: 'お気に入り板', icon: 'star', placement: 'header' },
  { id: 'style', name: '表示スタイル', icon: 'palette', placement: 'header' },
  { id: 'refresh', name: '更新', icon: 'refresh', placement: 'header' },
]

export const BAR_ACTIONS: Record<BarArea, BarActionDef[]> = { thread: THREAD_ACTIONS, list: LIST_ACTIONS }

/** 設定に保存する形。変えたものだけ持つ(あとで増えた操作は既定の置き場所になる) */
export type BarLayout = Partial<Record<BarArea, Record<string, Placement>>>

/** 操作 id → 置き場所。保存してある置き場所に、既定を足したもの */
export function resolvePlacements(area: BarArea, saved: BarLayout | undefined): Record<string, Placement> {
  const out: Record<string, Placement> = {}
  for (const a of BAR_ACTIONS[area]) out[a.id] = saved?.[area]?.[a.id] ?? a.placement
  return out
}
