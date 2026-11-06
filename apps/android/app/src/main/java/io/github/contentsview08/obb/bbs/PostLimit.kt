package io.github.contentsview08.obb.bbs

// 書き込む前に、板の上限(SETTING.TXT)を超えていないか確かめる。PC 版の utils/postLimit.ts を Kotlin に写したもの

/** 板の書き込みの上限(PC 版の PostLimits と同じ形) */
data class PostLimits(
    val messageBytes: Int? = null,
    val lines: Int? = null,
    val nameBytes: Int? = null,
    val mailBytes: Int? = null,
    val subjectBytes: Int? = null,
)

/** SETTING.TXT の中身から上限を読む。5ch の BBS_LINE_NUMBER は行数の半分を書くので 2 倍する */
fun postLimitsOf(setting: Map<String, String>) = PostLimits(
    messageBytes = setting["BBS_MESSAGE_COUNT"]?.toIntOrNull(),
    lines = setting[TwoCh.MAX_LINES_KEY]?.toIntOrNull() ?: setting["BBS_LINE_NUMBER"]?.toIntOrNull()?.let { it * 2 },
    nameBytes = setting["BBS_NAME_COUNT"]?.toIntOrNull(),
    mailBytes = setting["BBS_MAIL_COUNT"]?.toIntOrNull(),
    subjectBytes = setting["BBS_SUBJECT_COUNT"]?.toIntOrNull(),
)

/** 超えているものの説明(なければ空) */
fun postLimitOver(limits: PostLimits, byteLength: (String) -> Int, body: String, name: String, mail: String, subject: String? = null): List<String> {
    val over = ArrayList<String>()
    val messageBytes = byteLength(body)
    val lines = if (body.isEmpty()) 0 else body.count { it == '\n' } + 1
    if (limits.messageBytes != null && messageBytes > limits.messageBytes) over += "本文が長すぎます($messageBytes / ${limits.messageBytes} バイト)"
    if (limits.lines != null && lines > limits.lines) over += "本文の行が多すぎます($lines / ${limits.lines} 行)"
    fun check(label: String, text: String?, max: Int?) {
        if (text == null || max == null) return
        val n = byteLength(text)
        if (n > max) over += "${label}が長すぎます($n / $max バイト)"
    }
    check("名前", name, limits.nameBytes)
    check("メール", mail, limits.mailBytes)
    check("スレタイ", subject, limits.subjectBytes)
    return over
}
