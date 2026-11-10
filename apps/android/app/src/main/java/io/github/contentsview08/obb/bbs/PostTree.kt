package io.github.contentsview08.obb.bbs

// スレ表示のツリー表示(カード・専ブラ風・まとめ風)の並べ方。決まりは bbs-suite の docs/style-tree.md、試験データは packages/conformance/tree.json(PC 版と共通)。
// 画面から切り離した純粋な関数にして、画面とは別のスレッドで呼ぶ

/**
 * ツリー表示の 1 行。depth は字下げの段(深さの上限で止めたもの)。parent はその行を置いた親(根は 0)。
 * ghost は 2 つ目・3 つ目のアンカー先の下に出す 2 回目以降の出現(薄く出し、子を付けず、押すと 1 回目へ飛ぶ)
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
