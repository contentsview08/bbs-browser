package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.parseStrictJson

// 種類ごとのスイッチ。端末ごとの設定なので sync_state に置き、同期の許可リストに入れない

class SyncGroup(val id: String, val label: String, val default: Boolean, val kinds: List<String>)

const val SECRET_KIND = "secret"

val SYNC_GROUPS = listOf(
    SyncGroup("history", "閲覧履歴と既読", true, listOf("last_view", "read_dev", "read_reset")),
    SyncGroup("favorites", "お気に入り(スレ・板)", true, listOf("favorite", "order")),
    SyncGroup("sites", "サイト", true, listOf("site")),
    SyncGroup("posts", "書き込み履歴と自分のレスの印", true, listOf("post", "own_post")),
    SyncGroup("images", "上げた画像の履歴", true, listOf("image")),
    SyncGroup("ng", "NG", true, listOf("ng")),
    SyncGroup("settings", "設定", true, listOf("setting")),
    SyncGroup("secret", "画像の削除キー・管理トークン", false, listOf(SECRET_KIND)),
)

/** 既定と違うものだけを保存する。読めない値は既定にする(権限系が勝手にオンにならないように) */
fun parseSwitches(raw: String?): Map<String, Boolean> {
    val saved = try {
        if (raw == null) null else parseStrictJson(raw) as? Map<*, *>
    } catch (_: Exception) {
        null
    }
    return SYNC_GROUPS.associate { g -> g.id to (saved?.get(g.id) as? Boolean ?: g.default) }
}

fun offKindsOf(sw: Map<String, Boolean>): Set<String> = SYNC_GROUPS.filter { sw[it.id] != true }.flatMap { it.kinds }.toSet()

fun kindsOfGroups(groups: Collection<String>): List<String> = SYNC_GROUPS.filter { it.id in groups }.flatMap { it.kinds }

/** 明示で切ったときだけ false。切り替えを持たない端末は、使っているならオンのまま続ける */
fun masterOn(master: String?, enabled: String?): Boolean = if (master == null) enabled == "1" else master == "1"
