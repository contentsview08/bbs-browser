// 画面の状態: どのタブを選んでいるか・1 画面でスレ一覧を出しているか・戻る/進むの履歴。
// この 3 つはいっしょに変わらないとずれる(タブを選んだのに一覧のまま、履歴にだけ積まれる など)ので、
// 変え方をここの関数だけに決めておく。App はこれを呼ぶだけで、3 つを別々に書き換えない

export interface NavEntry<T> {
  /** 同じものかどうか(同じものが続けて来たら 1 つにまとめる) */
  key: string
  value: T
}

export interface ViewState<T> {
  /** 選んでいるタブ。1 画面でスレ一覧を出しているときも、裏で選んだまま持つ */
  activeId?: string
  /** 1 画面のとき、スレ一覧を(スレ表示の代わりに)出しているか */
  listOpen: boolean
  /** 戻る・進むの履歴と、いまの位置 */
  stack: NavEntry<T>[]
  index: number
}

/** 履歴に覚えておく数 */
export const NAV_MAX = 50

export function initialView<T>(): ViewState<T> {
  return { listOpen: false, stack: [], index: -1 }
}

/** 見たものを履歴に足す。いまの場所より先(進むで行けた分)は捨てる。entry がなければ足さない(戻る・進むの途中など) */
function record<T>(s: ViewState<T>, entry: NavEntry<T> | undefined): ViewState<T> {
  if (!entry) return s
  if (s.stack[s.index]?.key === entry.key) {
    // 同じものが続いたら、中身(スレの情報など)だけ新しくする
    const stack = s.stack.slice()
    stack[s.index] = entry
    return { ...s, stack }
  }
  const stack = [...s.stack.slice(0, s.index + 1), entry].slice(-NAV_MAX)
  return { ...s, stack, index: stack.length - 1 }
}

/** スレ一覧を見せる(板・閲覧履歴・お気に入りのスレを開いた、一覧へ戻った) */
export function showList<T>(s: ViewState<T>, entry: NavEntry<T> | undefined): ViewState<T> {
  return record({ ...s, listOpen: true }, entry)
}

/** スレを見せる(タブを選んだ、スレを開いた)。1 画面ならスレ表示に切り替わる */
export function showThread<T>(s: ViewState<T>, id: string, entry: NavEntry<T> | undefined): ViewState<T> {
  return record({ ...s, activeId: id, listOpen: false }, entry)
}

/** 見せ方も履歴も変えずに、選んでいるタブだけ変える(起動時に戻したタブ、一覧に残ったまま閉じたタブの隣) */
export function selectQuietly<T>(s: ViewState<T>, id: string | undefined): ViewState<T> {
  return { ...s, activeId: id }
}

/**
 * タブを閉じたあとに選ぶタブ。選んでいたタブを閉じたなら右隣(なければ左隣)、そうでなければいまのまま。
 * order は閉じる前のタブの並び
 */
export function nextAfterClose(activeId: string | undefined, order: string[], closing: string[]): { id?: string; changed: boolean } {
  if (!activeId || !closing.includes(activeId)) return { id: activeId, changed: false }
  const rest = order.filter((id) => !closing.includes(id))
  const idx = order.indexOf(activeId)
  return { id: rest[Math.min(idx, rest.length - 1)], changed: true }
}

/** 戻る(-1)・進む(+1)。動けたら、新しい状態と行き先を返す。行き先を見せるのは呼んだ側(記録はしない) */
export function step<T>(s: ViewState<T>, d: -1 | 1): { state: ViewState<T>; entry: NavEntry<T> } | undefined {
  const index = s.index + d
  const entry = s.stack[index]
  if (!entry) return undefined
  return { state: { ...s, index }, entry }
}

export const canBack = (s: ViewState<unknown>) => s.index > 0
export const canForward = (s: ViewState<unknown>) => s.index < s.stack.length - 1
