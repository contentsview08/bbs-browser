package io.github.contentsview08.obb.ui

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
}
