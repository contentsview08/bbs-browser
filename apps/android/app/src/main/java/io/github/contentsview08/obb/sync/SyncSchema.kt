package io.github.contentsview08.obb.sync

// 復号後の値の検査。AEAD を通っても、乗っ取られた端末が書いた値かもしれないので、型と長さを確かめる

private sealed class Rule(val req: Boolean) {
    class Str(val max: Int, req: Boolean = false, val nullable: Boolean = false, val min: Int = 0) : Rule(req)
    class Url(req: Boolean = false) : Rule(req)
    class Int_(req: Boolean = false) : Rule(req)
    class Bool(req: Boolean = false) : Rule(req)
    class Order(req: Boolean = false) : Rule(req)
    class Scalar(req: Boolean = false) : Rule(req)
    class Steps(req: Boolean = false) : Rule(req)
}

private const val URL_MAX = 2048
private const val MAX_STEPS_ACCEPTED = 64
private const val SCALAR_MAX = 4096
private const val TITLE_MAX = 1024
private const val NAME_MAX = 256
private const val THREAD_MAX = 256
private const val ID_MAX = 64
private const val NG_ID_MAX = 128
private const val NOTE_MAX = 1024
private const val DATE_MAX = 10
const val POST_BODY_MAX = 4096
// 板ごとの設定は名前に板 URL を含む
private const val SETTING_KEY_MAX = 128 + URL_MAX
private const val MAX_SAFE = 9007199254740991L

private val BOARD = Rule.Url(true)
private val THREAD = Rule.Str(THREAD_MAX, true, min = 1)
private val INT = Rule.Int_()
private val BOOL = Rule.Bool()

private val SCHEMAS: Map<String, Map<String, Rule>> = mapOf(
    "read_reset" to mapOf("board_url" to BOARD, "thread" to THREAD, "id" to Rule.Str(ID_MAX, true), "target_res" to Rule.Int_(true)),
    "read_dev" to mapOf("board_url" to BOARD, "thread" to THREAD, "base_reset_id" to Rule.Str(ID_MAX, nullable = true), "pos" to Rule.Int_(true), "steps" to Rule.Steps(true)),
    "last_view" to mapOf("board_url" to BOARD, "thread" to THREAD, "title" to Rule.Str(TITLE_MAX), "board_name" to Rule.Str(NAME_MAX), "created_at" to INT, "last_viewed_at" to Rule.Int_(true)),
    "favorite" to mapOf("board_url" to BOARD, "thread" to Rule.Str(THREAD_MAX), "title" to Rule.Str(TITLE_MAX), "board_name" to Rule.Str(NAME_MAX), "created_at" to INT),
    "order" to mapOf("board_url" to BOARD, "thread" to Rule.Str(THREAD_MAX), "key" to Rule.Order(true)),
    "post" to mapOf("post_id" to Rule.Str(ID_MAX, true, min = 1), "board_url" to BOARD, "thread" to THREAD, "title" to Rule.Str(TITLE_MAX), "no" to INT, "body" to Rule.Str(POST_BODY_MAX, true), "posted_at" to Rule.Int_(true)),
    "image" to mapOf("url" to Rule.Url(true), "file_name" to Rule.Str(TITLE_MAX), "size" to INT, "uploaded_at" to INT),
    "ng" to mapOf(
        "id" to Rule.Str(NG_ID_MAX, true, min = 1),
        "type" to Rule.Str(ID_MAX, true),
        "value" to Rule.Str(SCALAR_MAX, true),
        "is_regex" to BOOL,
        "enabled" to BOOL,
        "expires_on" to Rule.Str(DATE_MAX),
        "board_url" to Rule.Url(),
        "board_name" to Rule.Str(NAME_MAX),
        "note" to Rule.Str(NOTE_MAX),
        "created_at" to INT,
    ),
    "setting" to mapOf("key" to Rule.Str(SETTING_KEY_MAX, true), "value" to Rule.Scalar(true)),
    "site" to mapOf("menu_url" to Rule.Url(true), "name" to Rule.Str(NAME_MAX)),
    "secret" to mapOf("url" to Rule.Url(true), "value" to Rule.Str(SCALAR_MAX, true)),
)

private val KIND_RE = Regex("[a-z_]{1,32}")

// http と https だけを通す。javascript: などはここで落ちる。表示の前の安全確認は別にかける
private val HTTP_URL = Regex("https?://[^\\x00-\\x20\\x7f]+", RegexOption.IGNORE_CASE)

private fun isIndex(v: Any?) = v is Long && v in 0..MAX_SAFE

/** 数は整数だけにする(小数の書き方は言語で違い、並べた JSON が PC とスマホで変わる) */
private fun onlySafeNumbers(v: Any?): Boolean = when (v) {
    is Long -> v in -MAX_SAFE..MAX_SAFE
    is Number -> false
    is List<*> -> v.all(::onlySafeNumbers)
    is Map<*, *> -> v.values.all(::onlySafeNumbers)
    else -> true
}

private fun checkRule(rule: Rule, v: Any?): Boolean = when (rule) {
    is Rule.Str -> (rule.nullable && v == null) || (v is String && v.length in rule.min..rule.max)
    is Rule.Url -> v is String && v.length <= URL_MAX && HTTP_URL.matches(v)
    is Rule.Int_ -> isIndex(v)
    is Rule.Bool -> v is Boolean
    is Rule.Order -> isOrderKey(v)
    is Rule.Scalar -> v is Boolean || isIndex(v) || (v is String && v.length <= SCALAR_MAX)
    is Rule.Steps -> v is List<*> && v.size <= MAX_STEPS_ACCEPTED && v.all { it is Map<*, *> && Hlc.isHlc(it["at"]) && isIndex(it["pos"]) }
}

/** 正しければ payload を返し、違えば null。知らない種類とフィールドは、型の決まりの外なので通して持ち続ける */
@Suppress("UNCHECKED_CAST")
fun checkPayload(v: Any?): SyncPayload? {
    if (v !is Map<*, *> || !onlySafeNumbers(v)) return null
    val kind = v["kind"]
    val hlc = v["hlc"]
    val device = v["device_id"]
    if (kind !is String || !KIND_RE.matches(kind)) return null
    if (device !is String || !Hlc.DEVICE_ID.matches(device) || !Hlc.isHlc(hlc) || Hlc.parse(hlc as String).device != device) return null
    if (v.containsKey("deleted") && v["deleted"] !is Boolean) return null
    val deleted = v["deleted"] == true
    if (v.containsKey("trim") && (v["trim"] != true || !deleted)) return null
    if (v.containsKey("body") && v["body"] !is Map<*, *>) return null
    val body = v["body"] as Map<*, *>?
    val schema = SCHEMAS[kind]
    if (schema != null) {
        if (body == null && !deleted) return null
        for ((name, rule) in schema) {
            if (body != null && body.containsKey(name)) {
                if (!checkRule(rule, body[name])) return null
            } else if (rule.req && !deleted) {
                return null
            }
        }
    }
    return v as SyncPayload
}
