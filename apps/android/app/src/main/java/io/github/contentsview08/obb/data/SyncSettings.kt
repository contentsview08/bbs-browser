package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.sync.adapters.BOARD_META_KEY
import io.github.contentsview08.obb.sync.adapters.SettingAllowlist
import io.github.contentsview08.obb.sync.adapters.SettingOp
import io.github.contentsview08.obb.sync.adapters.SettingsHost

// スマホの設定の置き場(Prefs)と同期の表のあいだ

const val SETTING_OPS_DELAY_MS = 400L

/** Prefs を同期の口にする。値は PC の settings 表と同じ形で渡す */
class PrefsSettingsHost(private val prefs: Prefs, private val allow: SettingAllowlist) : SettingsHost {
    override val device = "phone"

    override fun read(): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        for (item in allow.items) prefs.syncedValue(item)?.let { out[item.name] = it }
        for ((url, fields) in prefs.boardMetaFields()) out[allow.boardMetaPrefix + url] = fields
        return out
    }

    /** 今の値。板ごとの設定は板 URL → 項目 */
    fun current(key: String): Any? = if (key == BOARD_META_KEY) prefs.boardMetaFields() else allow.item(key)?.let(prefs::syncedValue)

    @Suppress("UNCHECKED_CAST")
    override fun apply(changes: Map<String, Any?>) {
        val metas = LinkedHashMap<String, Map<String, Any?>>()
        for ((name, value) in changes) {
            if (name.startsWith(allow.boardMetaPrefix)) metas[name.substring(allow.boardMetaPrefix.length)] = value as Map<String, Any?>
            else allow.item(name)?.let { prefs.applyRemote(it, value) }
        }
        if (metas.isNotEmpty()) prefs.applyRemoteBoardMeta(metas)
    }
}

/** 変わった設定の名前を溜めて、最後の値をまとめて操作にする。SharedPreferences と DB は同じトランザクションにできないので、落ちた分は次の起動の照合で直す */
class SettingOpQueue(private val allow: SettingAllowlist, private val current: (String) -> Any?) {
    constructor(allow: SettingAllowlist, host: PrefsSettingsHost) : this(allow, host::current)

    private val before = LinkedHashMap<String, Any?>()

    /** 許可リストの項目なら true。前の値は溜め始めのものを残す(板ごとの設定は変わった板を見分けるのに使う) */
    @Synchronized
    fun note(key: String, was: Any?): Boolean {
        if (!allow.watches(key)) return false
        if (key !in before) before[key] = was
        return true
    }

    @Synchronized
    fun drain(): List<SettingOp> {
        val out = before.flatMap { (key, was) -> allow.opsOf(key, current(key), was) }
        before.clear()
        return out
    }
}

/**
 * 適用のあとの、開いているスレの既読。上がったときだけ上げる。
 * 下げると読んでいる最中に「読んだ」の判定が動くので、下がった分は閉じて開き直したときに反映する
 */
fun openReadNoAfterSync(open: Int, inDb: Int?): Int = maxOf(open, inDb ?: open)
