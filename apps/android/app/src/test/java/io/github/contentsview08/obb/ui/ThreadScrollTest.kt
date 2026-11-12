package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.ScrollPos
import org.junit.Assert.assertEquals
import org.junit.Test

// 開いたときの行き先。PC 版 test/threadScroll.test.ts の「同期で既読が進んだとき」と同じ場面
class ThreadScrollTest {
    private fun open(saved: ScrollPos?, found: Boolean, readNo: Int, hasUnread: Boolean, position: String = "unread") =
        openTarget(saved, found, position, readNo, readNo + 1, hasUnread)

    @Test fun 覚えたときより既読が先なら既読の次から() {
        val saved = ScrollPos(95, 0, false, readNo = 100)
        assertEquals(OpenTarget.Unread(201), open(saved, true, 200, true))
    }

    @Test fun 既読の次がまだ手元になければ一番下で新着を待つ() {
        val saved = ScrollPos(95, 0, false, readNo = 100)
        assertEquals(OpenTarget.Bottom(pendingUnread = true), open(saved, true, 200, false))
    }

    @Test fun 覚えたときの既読が今と同じなら覚えた位置() {
        val saved = ScrollPos(95, -12, false, readNo = 100)
        assertEquals(OpenTarget.Saved(saved), open(saved, true, 100, true))
    }

    @Test fun 覚えた位置の方が先なら覚えた位置() {
        // 読み進めたが、既読の書き込みがまだ追いついていない
        val saved = ScrollPos(115, 0, false, readNo = 120)
        assertEquals(OpenTarget.Saved(saved), open(saved, true, 100, true))
    }

    @Test fun どちらもなければ先頭() {
        assertEquals(OpenTarget.Top, open(null, false, 0, false))
    }

    @Test fun 覚えた位置のレスが手元になければ既読の次() {
        // ログを取り直して、覚えた位置が今のレス数より大きい
        val saved = ScrollPos(500, 0, false, readNo = 500)
        assertEquals(OpenTarget.Unread(501), open(saved, false, 500, true))
    }

    @Test fun 覚えた位置が見つからず既読も0なら先頭() {
        assertEquals(OpenTarget.Top, open(ScrollPos(500, 0, false, readNo = 500), false, 0, false))
    }

    @Test fun 既読を添えていない古い覚えはそのまま使う() {
        val saved = ScrollPos(95, 0, false)
        assertEquals(OpenTarget.Saved(saved), open(saved, true, 200, true))
    }

    @Test fun 一番下で閉じたなら一番下だが既読が進んでいれば未読を待つ() {
        assertEquals(OpenTarget.Bottom(pendingUnread = false), open(ScrollPos(95, 0, true, readNo = 100), true, 100, false))
        assertEquals(OpenTarget.Bottom(pendingUnread = true), open(ScrollPos(95, 0, true, readNo = 100), true, 200, false))
    }

    @Test fun 設定が先頭や一番下なら覚えた位置が使えないときはそのとおり() {
        val saved = ScrollPos(95, 0, false, readNo = 100)
        assertEquals(OpenTarget.Top, open(saved, true, 200, true, position = "top"))
        assertEquals(OpenTarget.Bottom(pendingUnread = false), open(saved, true, 200, true, position = "bottom"))
    }

    // PC 版 test/autoRefresh.test.ts と同じ場面
    @Test fun 自動の取得はdat落ちと上限に届いたスレと見えていないときは行かない() {
        assertEquals(true, shouldAutoRefresh(true, false, 999, AUTO_REFRESH_MAX_POSTS))
        assertEquals(false, shouldAutoRefresh(true, false, 1000, AUTO_REFRESH_MAX_POSTS))
        assertEquals(false, shouldAutoRefresh(true, true, 10, AUTO_REFRESH_MAX_POSTS))
        assertEquals(false, shouldAutoRefresh(false, false, 10, AUTO_REFRESH_MAX_POSTS))
        // 上限のない掲示板(hono-bbs)は数では止めない
        assertEquals(true, shouldAutoRefresh(true, false, 5000, null))
    }

    @Test fun ツリーの並びでもそのレスの行を探し見つからなければ後ろで一番近い番号の行() {
        // ツリー: 1, 4(1 の子), 2, 4 の 2 回目(0), 3
        val rows = listOf(1, 4, 2, 0, 3)
        assertEquals(1, rowIndexOf(rows, 4))
        assertEquals(4, rowIndexOf(rows, 3))
        assertEquals(-1, rowIndexOf(rows, 9))
        // 番号の順なら、最初の no 以上の行(前と同じ)
        assertEquals(2, rowIndexOf(listOf(1, 3, 5, 7), 4))
    }

    @Test fun ツリーの既読は1番から途切れずに出し終えた所まで() {
        val all = (1..10).toSet()
        // 1〜3 と 5〜8 が出た: 4 がまだなので 3 まで
        assertEquals(3, readHead(0, 10, setOf(1, 2, 3, 5, 6, 7, 8), all))
        // 4 が出たら 8 まで一気に進む
        assertEquals(8, readHead(3, 10, setOf(1, 2, 3, 4, 5, 6, 7, 8), all))
        // 前の既読から先だけを見る(前に読んだ分はもう出なくてよい)
        assertEquals(6, readHead(5, 10, setOf(6), all))
        // 手元にない番号(飛んだ番号)は数えない
        assertEquals(10, readHead(0, 10, (1..10).toSet() - 4, all - 4))
        // 最後のレスより先へは進めない。後ろへは戻さない
        assertEquals(10, readHead(10, 10, emptySet(), all))
    }

    // 飛んだレスを見える範囲の縦の真ん中に置く(bbs-suite の docs/thread-scroll.md)
    @Test fun 飛んだレスは見える範囲の真ん中に() {
        // 見える範囲 1000px にレス 200px: 上の端から 400px の所に頭が来ると、真ん中(500)にレスの真ん中(400 + 100)が重なる
        assertEquals(400, centerOffset(1000, 200))
        assertEquals(0, centerOffset(1000, 1000))
    }

    @Test fun 画面より高いレスは頭を上に() {
        assertEquals(0, centerOffset(1000, 1500))
        // 高さがまだ分からない(0)なら、頭を真ん中に
        assertEquals(500, centerOffset(1000, 0))
    }
}
