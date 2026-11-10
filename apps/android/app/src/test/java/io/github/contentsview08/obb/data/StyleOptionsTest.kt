package io.github.contentsview08.obb.data

import org.junit.Assert.assertEquals
import org.junit.Test

// 見た目ごとの設定(Prefs の styleOptions)と、表示スタイルのシートのタブの読み替え
class StyleOptionsTest {
    @Test fun 何も覚えていなければ今までの動き() {
        assertEquals(StyleOptions(tree = false, treeDepth = 3, quote = "line", group = true), styleOptionsOf("{}", "card"))
        assertEquals(StyleOptions(), styleOptionsOf("", "line"))
        assertEquals(StyleOptions(), styleOptionsOf("壊れた", "line"))
    }

    @Test fun 見た目ごとに別々に覚える() {
        var json = "{}"
        json = withStyleOptions(json, "line", StyleOptions(quote = "full", group = false))
        json = withStyleOptions(json, "card", StyleOptions(tree = true, treeDepth = 5))
        assertEquals(StyleOptions(quote = "full", group = false), styleOptionsOf(json, "line"))
        assertEquals(StyleOptions(), styleOptionsOf(json, "discord"))
        assertEquals(StyleOptions(tree = true, treeDepth = 5), styleOptionsOf(json, "card"))
    }

    @Test fun PCと同じ名前で読む_決めていない項目は既定_知らない値は既定() {
        assertEquals(StyleOptions(group = false), styleOptionsOf("""{"discord":{"groupRuns":false}}""", "discord"))
        assertEquals(StyleOptions(treeDepth = 10), styleOptionsOf("""{"card":{"treeDepth":99,"quote":"x"}}""", "card"))
        assertEquals(StyleOptions(treeDepth = 1), styleOptionsOf("""{"card":{"treeDepth":-2}}""", "card"))
    }

    @Test fun シートの古いタブの値は配色に読み替える() {
        val tabs = listOf("color", "style", "size", "post")
        assertEquals("color", styleTabOf("look", tabs))
        assertEquals("size", styleTabOf("size", tabs))
        // スレ一覧から開いたときは細かい表示のタブがない
        assertEquals("color", styleTabOf("post", tabs - "post"))
    }
}
