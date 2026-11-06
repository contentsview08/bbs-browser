package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.SyncSql
import java.io.File
import java.sql.Connection
import java.sql.DriverManager

// 本物のマイグレーションを流した DB に、端末と同じ SQL を流す(android.database は JVM のテストで動かない)
class JdbcSyncSql(private val c: Connection, val failing: MutableList<DbFail> = ArrayList()) : SyncSql {
    class DbFail(val match: String, var times: Int)

    private fun run(sql: String, args: List<Any?>) = c.prepareStatement(sql).use { st ->
        args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
        st.executeUpdate()
    }

    override fun exec(sql: String, args: List<Any?>) {
        run(sql, args)
    }

    override fun query(sql: String, args: List<Any?>): List<Map<String, Any?>> = c.prepareStatement(sql).use { st ->
        args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
        st.executeQuery().use { r ->
            val m = r.metaData
            buildList {
                while (r.next()) {
                    add(
                        (1..m.columnCount).associate { i ->
                            m.getColumnLabel(i) to when (val v = r.getObject(i)) {
                                is Int -> v.toLong()
                                else -> v
                            }
                        },
                    )
                }
            }
        }
    }

    override fun batch(statements: List<SqlStatement>) {
        c.autoCommit = false
        try {
            for (s in statements) {
                val f = failing.firstOrNull { it.times > 0 && s.sql.contains(it.match) }
                if (f != null) {
                    f.times--
                    throw IllegalStateException("db_fail")
                }
                run(s.sql, s.args)
            }
            c.commit()
        } catch (e: Exception) {
            c.rollback()
            throw e
        } finally {
            c.autoCommit = true
        }
    }

    fun script(sql: String) = c.createStatement().use { it.execute(sql) }

    fun close() = c.close()

    companion object {
        val migrationFiles: List<File> = File("../../../packages/logstore/migrations").listFiles()!!.filter { it.name.endsWith(".sql") }.sortedBy { it.name }

        fun open(until: String? = null): JdbcSyncSql {
            val c = DriverManager.getConnection("jdbc:sqlite::memory:")
            val db = JdbcSyncSql(c)
            for (f in migrationFiles) if (until == null || f.name < until) for (s in io.github.contentsview08.obb.data.splitSql(f.readText())) db.script(s)
            return db
        }
    }
}
