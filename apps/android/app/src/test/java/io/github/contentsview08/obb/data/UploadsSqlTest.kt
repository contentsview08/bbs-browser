package io.github.contentsview08.obb.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.io.File
import java.sql.Connection
import java.sql.DriverManager

// 本物のマイグレーションを流した DB に、LogDb と同じ SQL を流す
class UploadsSqlTest {
    private lateinit var db: Connection

    @Before fun open() {
        db = DriverManager.getConnection("jdbc:sqlite::memory:")
        val files = File("../../../packages/logstore/migrations").listFiles()!!.filter { it.name.endsWith(".sql") }.sortedBy { it.name }
        db.createStatement().use { st -> for (f in files) for (sql in splitSql(f.readText())) st.execute(sql) }
    }

    @After fun close() = db.close()

    private fun exec(sql: String, args: Array<Any?>) = db.prepareStatement(sql).use { st ->
        args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
        st.executeUpdate()
    }

    private fun add(u: UploadRecord, now: Long) = exec(UploadSql.ADD, UploadSql.addArgs(u, now))

    private fun list(): List<UploadRecord> = db.prepareStatement(UploadSql.LIST).use { st ->
        st.executeQuery().use { r ->
            buildList {
                while (r.next()) add(UploadRecord(r.getString(1), r.getString(2), r.getLong(3), r.getLong(4), r.getInt(5) == 1, r.getString(6), r.getString(7)))
            }
        }
    }

    private fun find(hash: String): String? = db.prepareStatement(UploadSql.FIND_BY_HASH).use { st ->
        st.setString(1, hash)
        st.executeQuery().use { r -> if (r.next()) r.getString(1) else null }
    }

    private fun rec(url: String, hash: String? = null, deleteUrl: String? = null) = UploadRecord(url, "n", 3, 0, false, hash, deleteUrl)

    @Test fun 新しい順に読める() {
        add(rec("a"), 1)
        add(rec("b"), 2)
        assertEquals(listOf("b", "a"), list().map { it.url })
        assertEquals(2L, list()[0].uploadedAt)
    }

    @Test fun 件数の上限がない() {
        for (i in 0 until 150) add(rec("u$i"), i.toLong())
        assertEquals(150, list().size)
    }

    @Test fun 同じURLは1行で時刻が新しくなる() {
        add(rec("a"), 1)
        add(rec("b"), 2)
        add(rec("a"), 3)
        assertEquals(listOf("a", "b"), list().map { it.url })
    }

    @Test fun 渡さなければハッシュと消すページを残し渡せば置き換える() {
        add(rec("a", "h1", "d1"), 1)
        add(rec("a"), 2)
        assertEquals("h1", list()[0].hash)
        assertEquals("d1", list()[0].deleteUrl)
        add(rec("a", "h2", "d2"), 3)
        assertEquals("h2", list()[0].hash)
        assertEquals("d2", list()[0].deleteUrl)
    }

    @Test fun ハッシュからいちばん新しいURLを引く() {
        add(rec("a", "h"), 1)
        add(rec("b", "h"), 2)
        assertEquals("b", find("h"))
        assertNull(find("none"))
    }

    @Test fun 消せる() {
        add(rec("a", "h"), 1)
        exec(UploadSql.REMOVE, arrayOf("a"))
        assertEquals(emptyList<UploadRecord>(), list())
        assertNull(find("h"))
    }

    @Test fun バックアップからは足すだけで手元の行を置き換えない() {
        add(rec("a", "h1"), 5)
        exec(UploadSql.IMPORT, UploadSql.importArgs(UploadRecord("a", "old", 1, 1, false, "old", null)))
        exec(UploadSql.IMPORT, UploadSql.importArgs(UploadRecord("b", "b.png", 2, 9, true, "h2", "d2")))
        assertEquals(listOf("b", "a"), list().map { it.url })
        assertEquals("h1", list()[1].hash)
        assertEquals(UploadRecord("b", "b.png", 2, 9, true, "h2", "d2"), list()[0])
    }

    @Test fun 既定の値はPCと同じ() {
        exec("INSERT INTO uploads (url, name, size, uploaded_at) VALUES (?, ?, ?, ?)", arrayOf("a", "n", 1, 1))
        assertEquals(false, list()[0].withAccount)
        assertNull(list()[0].hash)
    }
}
