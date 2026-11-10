// スレ表示のツリー(返信を最初のアンカー先の下に字下げして並べる)の組み立て。
// 画面には触らず、番号の並びとアンカー先だけから決める(テストは test/postTree.test.ts)。
// 決まりは bbs-suite の docs/style-tree.md。Android 版(bbs/PostTree.kt)と同じ結果にすることを packages/conformance/tree.json で確かめる。

/** ツリーの 1 行 */
export interface TreeRow {
  no: number
  /** 字下げの段(深さの上限で止めたもの。根は 0) */
  depth: number
  /** 2 つ目・3 つ目のアンカー先の下に重ねて出す、2 回目以降の出現。子は付けない */
  dup?: boolean
  /** 親のレス番号(根は undefined) */
  parent?: number
}

export interface PostTree {
  /** 画面に並べる順の行(重ねて出す分を含む) */
  rows: TreeRow[]
  /** 1 回目の出現だけの番号の並び(既読・キー操作・ミニマップの順) */
  order: number[]
}

/** 2 回目以降も重ねて出すのは、アンカー先がこの数まで。超えたら荒らし・まとめのアンカーとみなし、最初の親の下だけ */
export const TREE_SHARED_MAX = 3

/**
 * ツリーを組む。nos は番号の順のレス、targetsOf はそのレスのアンカー先(本文に出てくる順。範囲・複数は広げたもの)。
 * - アンカー先が自分より後ろ・自分・スレにない・isGone(NG であぼーん)のものは、ないものとして扱う。残らなければ根
 * - 残ったアンカー先の最初の 1 つを親にし、親の子の中では番号の順
 * - 残ったアンカー先が 2〜TREE_SHARED_MAX 個なら、2 つ目からの親の下にも重ねて出す(dup。子は付けない。あぼーんのレス自身は重ねない)
 * - 字下げは maxDepth で止める(親子の順は保つ)
 * 手間はレスとアンカーの数に比例する(親 → 子の表を 1 回で作り、深さ優先で 1 回なめる)
 */
export function buildPostTree(
  nos: readonly number[],
  targetsOf: (no: number) => readonly number[],
  o: { maxDepth: number; isGone?: (no: number) => boolean },
): PostTree {
  const has = new Set(nos)
  const maxDepth = Math.max(0, o.maxDepth)
  const kids = new Map<number, { no: number; dup: boolean }[]>()
  const addKid = (parent: number, kid: { no: number; dup: boolean }) => {
    const list = kids.get(parent)
    if (list) list.push(kid)
    else kids.set(parent, [kid])
  }
  const roots: number[] = []
  for (const no of nos) {
    const valid: number[] = []
    for (const t of targetsOf(no)) {
      if (t >= no || !has.has(t) || valid.includes(t) || o.isGone?.(t)) continue
      valid.push(t)
    }
    if (valid.length === 0) {
      roots.push(no)
      continue
    }
    addKid(valid[0], { no, dup: false })
    // あぼーんのレス自身は重ねて出さない
    if (valid.length <= TREE_SHARED_MAX && !o.isGone?.(no)) for (let k = 1; k < valid.length; k++) addKid(valid[k], { no, dup: true })
  }
  const rows: TreeRow[] = []
  const order: number[] = []
  // 再帰しない(1000 段の返信の鎖でも、呼び出しの深さを使い切らないように)
  const stack: { no: number; dup: boolean; depth: number; parent?: number }[] = []
  for (const root of roots) {
    stack.push({ no: root, dup: false, depth: 0 })
    while (stack.length > 0) {
      const cur = stack.pop()!
      const row: TreeRow = { no: cur.no, depth: Math.min(cur.depth, maxDepth) }
      if (cur.parent !== undefined) row.parent = cur.parent
      if (cur.dup) {
        row.dup = true
        rows.push(row)
        continue
      }
      rows.push(row)
      order.push(cur.no)
      const list = kids.get(cur.no)
      // 番号の若い子から出すよう、後ろから積む
      if (list) for (let k = list.length - 1; k >= 0; k--) stack.push({ ...list[k], depth: cur.depth + 1, parent: cur.no })
    }
  }
  return { rows, order }
}

/**
 * アンカーツリー(レスのポップアップ)の 1 行。ツリー表示の行に、罫線を引くための印を足したもの(スマホ版の bbs/PostTree.kt の TreeRow と同じ)
 */
export interface AnchorTreeRow extends TreeRow {
  /** 親より上の段ごとに、縦線を下まで続けるか(その段にまだ兄弟が残っているか) */
  rails: boolean[]
  /** 同じ親の最後の子か(最後なら └、まだ兄弟がいれば ├) */
  last: boolean
}

/**
 * アンカーツリー: ツリー表示と同じ組み立て(buildPostTree の結果)から、start の 1 回目の出現を含む根の部分木を切り出す
 * (並べ方・重ねて出す分・深さの上限はツリー表示と同じ。別の組み方を持たない)。start がなければ空
 */
export function anchorTreeOf(tree: PostTree, start: number): AnchorTreeRow[] {
  const lines = tree.rows
  const at = lines.findIndex((l) => !l.dup && l.no === start)
  if (at < 0) return []
  // 根(親のない 1 回目の出現)から、次の根の手前まで
  const isRoot = (l: TreeRow) => !l.dup && l.parent === undefined
  let from = at
  while (!isRoot(lines[from])) from--
  let to = from + 1
  while (to < lines.length && !isRoot(lines[to])) to++
  const part = lines.slice(from, to)
  // 後ろから見て、段ごとに「この後に(より浅い行を挟まずに)同じ段の行がまだあるか」を持つ
  const open = new Array<boolean>(Math.max(...part.map((l) => l.depth)) + 2).fill(false)
  const out = new Array<AnchorTreeRow>(part.length)
  for (let i = part.length - 1; i >= 0; i--) {
    const l = part[i]
    const d = l.depth
    out[i] = { ...l, rails: d <= 1 ? [] : Array.from({ length: d - 1 }, (_, k) => open[k + 1]), last: !open[d] }
    open[d] = true
    open.fill(false, d + 1)
  }
  return out
}
