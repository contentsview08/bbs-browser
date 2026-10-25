package io.github.yumekui8.bbsnative.bbs

// 掲示板の形(専ブラの packages/connectors/src/types.ts にあたる)。いまは 2ch 互換だけ

/** 板。url が板を一意に表すキー(例: https://bbs.eddibb.cc/liveedge/) */
data class Board(val url: String, val name: String, val category: String? = null)

/** スレ一覧の 1 行 */
data class ThreadSummary(
    val boardUrl: String,
    /** 板の中でスレを表すキー(dat 番号) */
    val key: String,
    val title: String,
    val postCount: Int,
    /** subject.txt の並び順 */
    val order: Int,
    /** スレが立った時刻(ミリ秒)。dat 番号から分かるときだけ */
    val createdAt: Long?,
    /** 立てた人の ID(エッジの subject-metadent.txt) */
    val authorId: String? = null,
    /** 運営のお知らせ(番号がわざと未来になっているスレ)。一覧の一番下に回す */
    val announcement: Boolean = false,
) {
    val id: String get() = "$boardUrl$key"
}

/** レス。no はスレの中の番号(1 から、すき間なく) */
data class Post(
    val no: Int,
    val name: String,
    val mail: String,
    val date: String,
    val id: String?,
    val body: String,
)

/**
 * dat の差分取得の続き。専ブラ(TypeScript)の DatCursor と同じ形の JSON で DB に入れる
 * (bytes: 読み終えたバイト数(最後の改行まで)、postCount、lastModified、kako: 過去ログから取った)
 */
data class DatCursor(val bytes: Long, val postCount: Int, val lastModified: String?, val kako: Boolean = false)

enum class FetchStatus { UPDATED, NOT_MODIFIED, RESET, ARCHIVED }

class FetchResult(
    val status: FetchStatus,
    /** UPDATED は新着だけ、RESET は全件 */
    val posts: List<Post>,
    val cursor: DatCursor?,
    val title: String? = null,
    /** dat 落ちしたが、過去ログからレスを取れた */
    val archived: Boolean = false,
)
