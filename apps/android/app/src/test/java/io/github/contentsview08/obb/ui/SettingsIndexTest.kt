package io.github.contentsview08.obb.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsIndexTest {
    private fun has(page: String, label: String) = SETTINGS_INDEX.any { it.first == page && it.second == label }

    @Test fun まとまりの見出しと数の項目も索引に入る() {
        assertTrue(has("write", "定型文"))
        assertTrue(has("list", "残す日数"))
        assertTrue(has("backup", "バックアップ"))
    }

    @Test fun まとまりの説明も索引に入る() {
        assertTrue(SETTINGS_INDEX.any { it.first == "backup" && it.third.contains("1 つのファイルに書き出します") })
    }

    @Test fun 廃止した下のタブは探しても出ない() {
        assertFalse(SETTINGS_INDEX.any { it.second.contains("「履歴・未読・スレ・板」") })
    }

    @Test fun 未読を上にと履歴のタブの置き場も索引に入る() {
        assertTrue(has("list", "未読を上に"))
        assertTrue(has("history", "タブの置き場"))
    }

    @Test fun テーマと色のページも索引に入る() {
        assertTrue(has("theme", "配色"))
    }

    @Test fun 見た目ごとの設定も索引に入る() {
        assertTrue(has("theme", "ツリー表示"))
        assertTrue(has("theme", "返信先の引用"))
        assertTrue(has("thread", "細かい表示"))
    }

    // お気に入り板の並べ替えは「お気に入り板」のページにしかない。BBS メニューのページへ飛ぶと探した項目が出ない
    @Test fun お気に入り板はお気に入り板のページを開く() {
        assertTrue(has("sites", "お気に入り板"))
        assertFalse(has("menus", "お気に入り板"))
        assertTrue(has("menus", "サイト(BBS メニュー)"))
    }
}
