// 画像一覧の選択の計算(四角形・Ctrl・Shift・スクロール端)

export interface Point {
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function rectFrom(a: Point, b: Point): Rect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** 四角形に当たったものを選ぶ。Ctrl を押していれば、元の選択に対して当たったものを裏返す */
export function selectByRect(band: Rect, items: { key: string; rect: Rect }[], base: ReadonlySet<string>, additive: boolean): Set<string> {
  const next = new Set(additive ? base : [])
  for (const item of items) {
    if (!intersects(band, item.rect)) continue
    if (additive && base.has(item.key)) next.delete(item.key)
    else next.add(item.key)
  }
  return next
}

export function toggled(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** 起点から押したものまでを選ぶ。起点がなければ押したものだけ。add なら今の選択に足す */
export function selectRange(order: string[], anchor: string | undefined, target: string, selected: ReadonlySet<string>, add: boolean): Set<string> {
  const to = order.indexOf(target)
  const from = anchor === undefined ? -1 : order.indexOf(anchor)
  const next = new Set(add ? selected : [])
  if (to < 0) return next
  const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)]
  for (let i = lo; i <= hi; i++) next.add(order[i])
  return next
}

/** スクロール端の自動スクロールの速さ(1 コマあたりの px)。端に近いほど速く、枠の外は最大 */
export function edgeScrollSpeed(y: number, top: number, bottom: number, zone = 40, max = 18): number {
  if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone))
  if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - (bottom - zone)) / zone))
  return 0
}
