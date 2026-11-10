package io.github.contentsview08.obb.bbs

// スレ表示のツリー表示(カード・専ブラ風・まとめ風)の並べ方。決まりは bbs-suite の docs/style-tree.md、試験データは packages/conformance/tree.json(PC 版と共通)。
// 画面から切り離した純粋な関数にして、画面とは別のスレッドで呼ぶ

/**
 * ツリー表示の 1 行。depth は字下げの段(深さの上限で止めたもの)。parent はその行を置いた親(根は 0)。
 * ghost は 2 つ目・3 つ目のアンカー先の下に出す 2 回目以降の出現(薄く出し、子を付けず、押すとアンカーと同じポップアップでそのレスを出す)
 */
data class TreeLine(val no: Int, val depth: Int, val parent: Int = 0, val ghost: Boolean = false)

/** 2 回目以降も出すアンカー先の数の上限。これより多くアンカーしたレスは、荒らし・まとめとみなして最初の親の下だけに出す */
const val TREE_MAX_PARENTS = 3

/** ツリー表示のできる見た目(Discord 風・LINE 風は会話の形とぶつかるので、引用の出し方で代える) */
val TREE_STYLES = setOf("card", "classic", "matome")

/**
 * nos: スレのレス番号(番号の順)。anchorsOf: そのレスのアンカー先(本文に出てきた順。範囲・複数は広げたもの)。
 * aborn: NG であぼーんのレス(アンカー先としては、ないものとして扱う。自分の 2 回目以降の出現も出さない)。
 * maxDepth: 字下げの深さの上限(超えた分は上限の段のまま並べる)。
 * 親 → 子の表を 1 回で作り、手で積んだ山でたどる(1000 段のつながりでも呼び出しが深くならないように)
 */
fun threadTree(nos: List<Int>, anchorsOf: (Int) -> List<Int>, aborn: Set<Int>, maxDepth: Int): List<TreeLine> {
    val exists = HashSet<Int>(nos.size * 2).apply { addAll(nos) }
    val kids = HashMap<Int, ArrayList<TreeLine>>()
    val roots = ArrayList<Int>()
    for (no in nos) {
        // 自分より後ろ・自分・スレの外・あぼーんのレスへのアンカーは、ないものとして扱う
        val targets = LinkedHashSet<Int>()
        for (t in anchorsOf(no)) if (t < no && t in exists && t !in aborn) targets += t
        if (targets.isEmpty()) { roots += no; continue }
        val it = targets.iterator()
        kids.getOrPut(it.next()) { ArrayList() } += TreeLine(no, 0, 0, false)
        if (targets.size <= TREE_MAX_PARENTS && no !in aborn) while (it.hasNext()) kids.getOrPut(it.next()) { ArrayList() } += TreeLine(no, 0, 0, true)
    }
    val cap = maxOf(0, maxDepth)
    val out = ArrayList<TreeLine>(nos.size + 16)
    // 番号の順に足したので、親の子はもう番号の順に並んでいる
    val stack = ArrayDeque<TreeLine>()
    for (r in roots) {
        stack.addLast(TreeLine(r, 0, 0, false))
        while (stack.isNotEmpty()) {
            val cur = stack.removeLast()
            out += cur
            if (cur.ghost) continue
            val ks = kids[cur.no] ?: continue
            // 本当の深さは段の数ではなく親の深さ + 1 だが、出すのは上限で止めた段だけなので、上限に着いたら増やさない
            val d = minOf(cur.depth + 1, cap)
            for (i in ks.indices.reversed()) stack.addLast(ks[i].copy(depth = d, parent = cur.no))
        }
    }
    return out
}

/**
 * アンカーツリー(レスのポップアップ)の 1 行。ツリー表示の行(TreeLine)に、罫線を引くための印を足したもの。
 * rails: 親より上の段ごとに、縦線を下まで続けるか(その段にまだ兄弟が残っているか)。last: 同じ親の最後の子か(最後なら └、まだ兄弟がいれば ├)。
 * PC 版の AnchorTreeRow と同じ
 */
class TreeRow(val no: Int, val depth: Int, val ghost: Boolean = false, val rails: List<Boolean> = emptyList(), val last: Boolean = true, val parent: Int = 0)

/**
 * アンカーツリー: ツリー表示と同じ組み立て(threadTree の結果 lines)から、start の 1 回目の出現を含む根の部分木を切り出す
 * (並べ方・重ねて出す分・深さの上限はツリー表示と同じ。別の組み方を持たない)。start がなければ空
 */
fun anchorTreeOf(lines: List<TreeLine>, start: Int): List<TreeRow> {
    val at = lines.indexOfFirst { !it.ghost && it.no == start }
    if (at < 0) return emptyList()
    // 根(親のない 1 回目の出現)から、次の根の手前まで
    fun isRoot(l: TreeLine) = !l.ghost && l.parent == 0
    var from = at
    while (!isRoot(lines[from])) from--
    var to = from + 1
    while (to < lines.size && !isRoot(lines[to])) to++
    val part = lines.subList(from, to)
    // 後ろから見て、段ごとに「この後に(より浅い行を挟まずに)同じ段の行がまだあるか」を持つ
    val open = BooleanArray((part.maxOf { it.depth }) + 2)
    val out = arrayOfNulls<TreeRow>(part.size)
    for (i in part.indices.reversed()) {
        val l = part[i]
        val d = l.depth
        out[i] = TreeRow(l.no, d, l.ghost, if (d <= 1) emptyList() else List(d - 1) { k -> open[k + 1] }, !open[d], l.parent)
        open[d] = true
        for (k in d + 1 until open.size) open[k] = false
    }
    return out.map { it!! }
}

/** レス start のアンカーツリー(ツリー表示と同じ組み立て)。aborn・maxDepth はツリー表示と同じものを渡す */
fun anchorTree(index: PostIndex, start: Int, aborn: Set<Int>, maxDepth: Int): List<TreeRow> = anchorTreeOf(threadTree(index, aborn, maxDepth), start)

/** PostIndex から組む。アンカー先は本文に出てきた順(同じ先は 1 つに) */
fun threadTree(index: PostIndex, aborn: Set<Int>, maxDepth: Int): List<TreeLine> =
    threadTree(index.posts.map { it.no }, { no -> anchorsInOrder(index.info[no]) }, aborn, maxDepth)

/** 本文のアンカー先を、出てきた順に */
fun anchorsInOrder(info: PostInfo?): List<Int> {
    if (info == null) return emptyList()
    val out = ArrayList<Int>()
    for (s in info.spans) if (s is BodyToken.Anchor) out += s.nos
    return out
}
