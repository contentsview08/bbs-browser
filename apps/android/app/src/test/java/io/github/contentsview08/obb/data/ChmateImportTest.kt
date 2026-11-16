package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.parseDat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** ChMate のバックアップの読み替え。PC 版の test/chmate.test.ts と同じ見本・同じ答え */
class ChmateImportTest {
    private val dat = listOf(
        "名無し<>sage<>2026/11/01(日) 09:50:14 ID:aaaa<> 1 つ目 <>てすとスレ",
        "名無し<><>2026/11/01(日) 09:51:42 ID:bbbb<> 2 つ目 <>",
        "名無し<><>2026/11/01(日) 09:52:00 ID:aaaa<> 3 つ目 <>",
    ).joinToString("\n") + "\n"

    private fun raw(): ChmateRaw = ChmateRaw(
        texts = mapOf(
            "ng/_id.json" to """[{"w":"AZUzoED80","f":18,"ct":1794819726000},{"w":"FoQ1g+Rp0","f":21,"ct":1671540174339,"b":"news4vip"}]""",
            "ng/_word.json" to """[{"w":">>1,2.\\d","f":33,"ct":1727486203978,"b":"bbs.eddibb.cc%2Fliveedge"},{"w":"","f":17,"ct":1}]""",
            "ng/_name.json" to """[{"w":"(ワッチョイW 834c-nJL5)","f":17,"ct":1645248890415,"b":"poverty"}]""",
            "ng/_title.json" to """[{"w":"^\\s*(.\\s+)+.\\s*$","f":160,"ct":1699058651915,"b":"unknownboard"}]""",
            "ng/_be.json" to """[{"w":"701569894","f":16,"ct":1767490160887,"b":"poverty"}]""",
            "files/postDataList.json" to """[
                {"url":"http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/","name":"","mail":"sage","body":"そういや","updated":1791504254597,"posted":1791504254856,"confirmed":"http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/47","targetTitle":"ワイ"},
                {"url":"http://bbs.eddibb.cc/test/read.cgi/liveedge/1791430787/","name":"","mail":"","body":"下書き","updated":1791432547990,"posted":0,"confirmed":null,"targetTitle":""}
            ]""",
            "files/keyword_group_list.json" to """{"items":[{"id":1,"flags":16,"keyword":"宮崎駿"},{"id":2,"flags":17,"keyword":" 宮崎駿 "},{"id":3,"flags":16,"keyword":""}]}""",
        ),
        dats = listOf(
            ChmateDat("bbs.eddibb.cc%2Fliveedge_1791503299.dat", dat, "1791504300000\tW/\"x\"\n2:1,3:1\n"),
            ChmateDat("livejupiter_1618048117.dat", dat, "0\tnull\n\n"),
            ChmateDat("mystery_1.dat", dat, null),
            ChmateDat("bbs.eddibb.cc%2Fliveedge_1752974175.dat", "\u0000".repeat(64), null),
            ChmateDat("bbs.p-hotair.com%2Fnews4vip_1171778428.dat", "Code = 404\n", null),
        ),
        bookmarks = listOf(
            ChmateBookmark("livejupiter", 1618048117, "橋下", """{"o":69,"n":"26","r":2,"p":1.0}""", 1785551620400, 1),
            ChmateBookmark("bbs.eddibb.cc%2Fliveedge", 1700000000, "ログのないお気に入り", """{"r":10}""", 5, 3),
            ChmateBookmark("bbs.eddibb.cc%2Fliveedge", 1700000001, "見ただけ(★なし)", """{"r":10}""", 5, 0),
        ),
        boards = mapOf("livejupiter" to "eagle.5ch.net", "news4vip" to "mi.5ch.net", "poverty" to "greta.5ch.net"),
        skipped = emptyList(),
        favoriteBoards = listOf(
            ChmateBoardRow("livejupiter", "eagle.5ch.net", "なんでも実況(ジュピター)", 1),
            ChmateBoardRow("news4vip", "mi.5ch.net", "ニュー速VIP", 5),
            ChmateBoardRow("bbs.eddibb.cc%2Fliveedge", "bbs.eddibb.cc", "エッヂ", 1),
        ),
    )

    private fun parse(now: Long = 1000) = Chmate.parse(raw(), now) { parseDat(it, 1) }

    @Test
    fun boardUrls() {
        val servers = mapOf("livejupiter" to "eagle.5ch.net")
        assertEquals("https://bbs.eddibb.cc/liveedge/", Chmate.boardUrl("bbs.eddibb.cc%2Fliveedge", servers))
        assertEquals("https://jbbs.livedoor.jp/sports/40235/", Chmate.boardUrl("jbbs.livedoor.jp%2Fsports%2F40235", servers))
        assertEquals("https://eagle.5ch.net/livejupiter/", Chmate.boardUrl("livejupiter", servers)) // 5ch.io への置き換えは UrlRoute.parse で行う
        assertNull(Chmate.boardUrl("poverty", servers))
    }

    @Test
    fun namesAndIdx() {
        assertEquals("bbs.eddibb.cc%2Fliveedge" to "1791503299", Chmate.splitDatName("bbs.eddibb.cc%2Fliveedge_1791503299.dat"))
        assertEquals("livejupiter" to "1618048117", Chmate.splitDatName("livejupiter_1618048117.idx"))
        assertEquals(1766689441000L to listOf(7, 15), Chmate.parseIdx("1766689441000\t\n7:1,15:1,7:2\n"))
        assertEquals(0L to listOf(482), Chmate.parseIdx("0\tnull\n482:1\n"))
        assertEquals(0L to emptyList<Int>(), Chmate.parseIdx(null))
        assertEquals("https://bbs.eddibb.cc/liveedge/" to "1791503299", Chmate.splitThreadUrl("http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/"))
    }

    @Test
    fun threads() {
        val r = parse()
        val edge = r.threads.first { it.key == "1791503299" }
        assertEquals("https://bbs.eddibb.cc/liveedge/", edge.boardUrl)
        assertEquals("てすとスレ", edge.title)
        assertEquals(3, edge.posts.size)
        assertEquals(3, edge.readNo)
        assertEquals(listOf(2, 3), edge.ownNos)
        assertFalse(edge.favorite)
        assertEquals(1791504300000L, edge.viewedAt)
        val jup = r.threads.first { it.key == "1618048117" }
        assertEquals("https://eagle.5ch.net/livejupiter/", jup.boardUrl)
        assertTrue(jup.favorite)
        assertEquals(3, jup.readNo) // ChMate の読んだ位置は使わず、全部読んだことにする
        assertEquals(1785551620400L, jup.viewedAt)
        val noLog = r.threads.first { it.key == "1700000000" }
        assertTrue(noLog.favorite)
        assertEquals(0, noLog.posts.size)
        assertEquals("ログのないお気に入り", noLog.title)
        assertFalse(r.threads.any { it.key == "1" })
        assertTrue(r.notes.any { it.contains("mystery") })
        // ★ のない行はログがなければ入れない
        assertFalse(r.threads.any { it.key == "1700000001" })
    }

    @Test
    fun favoriteBoards() {
        assertEquals(
            listOf("https://eagle.5ch.net/livejupiter/" to "なんでも実況(ジュピター)", "https://mi.5ch.net/news4vip/" to "ニュー速VIP", "https://bbs.eddibb.cc/liveedge/" to "エッヂ"),
            parse().favoriteBoards.map { it.url to it.name },
        )
    }

    @Test
    fun ng() {
        val r = parse()
        assertEquals(
            listOf(
                listOf("posterId", "AZUzoED80", false, null),
                listOf("posterId", "FoQ1g+Rp0", false, "https://mi.5ch.net/news4vip/"),
                listOf("content", ">>1,2.\\d", true, "https://bbs.eddibb.cc/liveedge/"),
                listOf("posterName", "(ワッチョイW 834c-nJL5)", false, "https://greta.5ch.net/poverty/"),
                listOf("threadTitle", "^\\s*(.\\s+)+.\\s*$", true, null),
            ),
            r.ngRules.map { listOf(it.target, it.pattern, it.isRegex, it.boardUrl) },
        )
        assertTrue(r.ngRules.all { it.enabled && it.note == "ChMate から" })
        assertTrue(r.notes.any { it.contains("BE の NG 1 件") })
    }

    @Test
    fun postsAndKeywords() {
        val r = parse()
        assertEquals(1, r.posts.size)
        val p = r.posts[0]
        assertEquals(listOf("https://bbs.eddibb.cc/liveedge/", "1791503299", "ワイ", 47, "", "sage", "そういや", 1791504254856L), listOf(p.boardUrl, p.key, p.title, p.no, p.name, p.mail, p.body, p.at))
        assertEquals(listOf("宮崎駿"), r.keywords)
    }

    @Test
    fun brokenDats() {
        assertTrue(Chmate.looksLikeDat(dat))
        assertFalse(Chmate.looksLikeDat("\u0000\u0000"))
        assertFalse(Chmate.looksLikeDat("Code = 404\n"))
        assertFalse(Chmate.looksLikeDat(""))
        val r = parse()
        assertFalse(r.threads.any { it.key == "1752974175" || it.key == "1171778428" })
        assertTrue(r.notes.any { it.contains("壊れていて") && it.contains("2 本") })
    }

    @Test
    fun emptyRaw() {
        val r = Chmate.parse(ChmateRaw(emptyMap(), emptyList(), emptyList(), emptyMap(), listOf("x")), 1) { parseDat(it, 1) }
        assertTrue(r.threads.isEmpty())
        assertTrue(r.ngRules.isEmpty())
        assertEquals(listOf("x"), r.notes)
    }
}
