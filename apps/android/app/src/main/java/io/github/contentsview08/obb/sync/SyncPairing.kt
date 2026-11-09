package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.engine.SyncApiError
import io.github.contentsview08.obb.sync.engine.checkServerUrl
import io.github.contentsview08.obb.sync.engine.ticketSpaceId

// 端末を足すコード。obb1.<K の Base64URL>.<サーバーの URL の Base64URL>.<許可証>。QR もコピー用のコードも同じ文字列

private const val PAIRING_PREFIX = "obb1"

class PairingCode(val k: ByteArray, val serverUrl: String, val ticket: String)

fun encodePairingCode(c: PairingCode): String = listOf(PAIRING_PREFIX, toBase64Url(c.k), toBase64Url(utf8(c.serverUrl)), c.ticket).joinToString(".")

/** 形と、許可証が K の領域のものであることだけを確かめる。署名と期限はサーバーだけが確かめる */
fun parsePairingCode(code: String, allowLocalhost: Boolean = false): PairingCode {
    val s = code.trim()
    val a = s.indexOf('.')
    val b = s.indexOf('.', a + 1)
    val c = s.indexOf('.', b + 1)
    if (a < 0 || b < 0 || c < 0 || s.substring(0, a) != PAIRING_PREFIX) throw SyncApiError("bad_code")
    val k = try {
        fromBase64Url(s.substring(a + 1, b))
    } catch (_: SyncError) {
        throw SyncApiError("bad_code")
    }
    if (k.size != KEY_BYTES) throw SyncApiError("bad_code")
    val ticket = s.substring(c + 1)
    if (ticketSpaceId(ticket) != spaceId(deriveKeys(k).authToken)) throw SyncApiError("bad_code")
    val url = try {
        fromUtf8(fromBase64Url(s.substring(b + 1, c)))
    } catch (_: SyncError) {
        throw SyncApiError("bad_code")
    }
    return PairingCode(k, checkServerUrl(url, allowLocalhost), ticket)
}

// Google ドライブの置き場の端末を足すコード(docs/sync-drive.md 5.5)。obb2.<K の Base64URL>.<更新用のトークンの UTF-8 の Base64URL>。
// PC の packages/sync/src/pairing.ts と同じ決まり。サーバーの URL・許可証・メールは入れない
private const val DRIVE_PREFIX = "obb2"
/** Google の更新用のトークンは 100 文字ほど。QR に収まる長さで切る */
private const val REFRESH_TOKEN_MAX = 512
private val REFRESH_TOKEN_FORM = Regex("[\\x21-\\x7e]+")

class DrivePairingCode(val k: ByteArray, val refreshToken: String)

private fun refreshTokenOk(t: String) = t.length in 1..REFRESH_TOKEN_MAX && REFRESH_TOKEN_FORM.matches(t)

fun encodeDrivePairingCode(c: DrivePairingCode): String {
    if (c.k.size != KEY_BYTES || !refreshTokenOk(c.refreshToken)) throw SyncApiError("bad_code")
    return listOf(DRIVE_PREFIX, toBase64Url(c.k), toBase64Url(utf8(c.refreshToken))).joinToString(".")
}

/** 形だけを確かめる。トークンが使えるかは Google に聞くまで分からない */
fun parseDrivePairingCode(code: String): DrivePairingCode {
    val parts = code.trim().split('.')
    if (parts.size != 3 || parts[0] != DRIVE_PREFIX) throw SyncApiError("bad_code")
    return try {
        val k = fromBase64Url(parts[1])
        val token = fromUtf8(fromBase64Url(parts[2]))
        if (k.size != KEY_BYTES || !refreshTokenOk(token)) throw SyncApiError("bad_code")
        DrivePairingCode(k, token)
    } catch (_: Exception) {
        throw SyncApiError("bad_code")
    }
}

/** 前の同期サーバーのコード(obb1)か。読んだら、サーバーの同期は終わった案内を出す */
fun isServerPairingCode(code: String) = code.trim().startsWith("$PAIRING_PREFIX.")

/**
 * Google ドライブの置き場の文。PC の packages/sync/src/messages.ts の DRIVE_MESSAGES・DRIVE_LABELS と同じ文言。
 * sync-ui.json へ移すまではここに置く。google_auth_failed と server_sync_ended は、スマホが Google のログインをしないので
 * 「PC で QR を出して読み直す」案内にしている(docs/sync-drive.md 5.7 のスマホの文)
 */
object DriveText {
    val MESSAGES = mapOf(
        "google_auth_failed" to "Google との接続が切れました。PC で「端末を追加」の QR を出して、読み直してください。この端末のデータはそのまま使えます。",
        "google_other_account" to "前と違う Google アカウントです。同期のデータは前のアカウントにあります。",
        "google_unavailable" to "この版には Google の同期の設定が入っていないため、Google ドライブで同期できません。",
        "google_pairing_failed" to "このコードの Google の接続は使えなくなっています。同期している端末で「端末を追加」を出し直してください。",
        "server_sync_ended" to "同期サーバーでの同期は終わったので、この端末の同期をやめた状態に戻しました。PC で「端末を追加」の QR を出して、読み直してください。この端末のデータはそのまま使えます。",
        "server_code" to "同期サーバーのコードです。同期は Google ドライブだけになりました。PC を新しい版にして、「端末を追加」の QR を読んでください。",
    )

    val LABELS = mapOf(
        "store" to "同期の置き場",
        "store_drive" to "Google ドライブ",
        "store_note" to "Google ドライブでは、アプリ専用の見えないフォルダに暗号化したまま置きます。Google にも中身は読めません。",
        "intro" to "履歴やお気に入りを暗号化して、自分の Google ドライブを通して別の端末と同期します。実験的な機能です。この端末のデータは消えません。",
        "master_note" to "オフの間は通信も送信待ちも起きません。鍵と Google ドライブのデータは残るので、オンに戻すと続きから同期します。",
        "kinds_note" to "切った種類は送らず、受け取っても手元へ写しません。Google ドライブのデータは消えません。オンに戻すと追いつきます。",
        "secret_note" to "既定はオフです。オフの間は、この端末から送らず、届いても読みません。",
        "leave_ask" to "この端末の鍵と同期の表、Google の接続を消します。この端末のお気に入りは消えません。Google ドライブのデータとほかの端末はそのままです。",
        "join_placeholder" to "obb2.",
        "join_ask_account" to "Google アカウント: {email}",
        "usage" to "ドライブで使っている量",
        "interval" to "同期の間隔",
        "interval_note" to "ほかの端末の変更を確かめる間隔です。この端末の変更は、アプリを離れるときなどに間隔によらず送ります。変化のない間や操作のない間は、確かめる間隔を自動で延ばします。この端末だけの設定です。",
        // スマホだけ。PC の DRIVE_LABELS にはない(スマホは Google のログインをせず、PC の QR で参加する)
        "join_note" to "PC の OBB の同期の設定で「端末を追加」を押し、出た QR を読んでください。Google のログインは要りません。",
        "rescan" to "QR を読み直す",
    )

    /** 同期の間隔の選択肢の見出し。PC の SYNC_INTERVAL_LABELS と同じ。並びと既定は SyncConfig.SYNC_INTERVALS */
    val INTERVAL_LABELS = mapOf("30s" to "30 秒", "1m" to "1 分", "5m" to "5 分", "15m" to "15 分", "manual" to "手動のみ")

    fun message(code: String): String? = MESSAGES[code]
}

/** 画面に出す文。PC 版の packages/sync/src/messages.ts と packages/conformance/sync-ui.json で揃える */
object SyncText {
    private const val TICKET_AGAIN = "同期を続けるには、もう一度確認が必要です。この端末のデータはそのまま使えます。"

    /** 要約の「合わない理由」の見出し。bad_ で始まるものは捨てた数なので、理由の名前をそのまま出す */
    val NOTES = mapOf(
        "history_no_record" to "手元の履歴のうち、まだ同期の表にないもの(次の同期で送ります)",
        "history_over_shown" to "履歴の画面に出す 300 件を超える分",
        "view_old" to "ログの保持日数より古いので、手元に入れていない履歴",
        "view_unresolved" to "この端末で開けない掲示板の履歴",
        "view_reset" to "ログの削除より前の閲覧なので、手元に入れていない履歴",
        "view_other" to "手元にまだ入っていない履歴",
        "read_no_row" to "既読の記録だけがあり、手元に行のないスレ",
        "read_differs" to "手元の既読が同期の表と違うスレ",
        "ops_waiting" to "まだ処理していない操作",
    )

    val MESSAGES = mapOf(
        "auth_failed" to "この端末の鍵が使えなくなりました。もう一度つないでください。",
        "capacity_full" to "同期は満員です。枠が空くまで作れません。この端末のデータはそのまま使えます。",
        "creation_closed" to "同期の新規作成を止めています。この端末のデータはそのまま使えます。",
        "ticket_required" to TICKET_AGAIN,
        "ticket_expired" to TICKET_AGAIN,
        "ticket_invalid" to TICKET_AGAIN,
        "bad_ticket" to "確認の結果を受け取れませんでした。もう一度お試しください。",
        "key_store_unavailable" to "この環境では鍵を安全に保存できないため、同期を使えません。",
        "bad_url" to "サーバーの URL が正しくありません。https の URL だけを使えます。",
        "bad_code" to "コードが正しくありません。",
        "already_on" to "同期を使っています。先にこの端末で同期をやめてください。",
        "cancelled" to "同期を始めるのをやめました。",
        "network" to "オフライン",
        "redirect" to "サーバーが別の場所へ移るよう返したので、送りませんでした。",
        "too_large" to "サーバーの応答が大きすぎるので読みませんでした。",
        "http_429" to "少し待ってから同期します。",
        "rate_limited" to "少し待ってから同期します。",
        "too_many_rebases" to "サーバーの状態が何度も変わったので、同期を止めました。",
        "quota_exceeded" to "同期の容量がいっぱいです。",
        "sync_off" to "先に「同期を使う」をオンにしてください。",
    )

    fun message(code: String): String = MESSAGES[code] ?: DriveText.message(code) ?: "同期できませんでした($code)"

    val LABELS = mapOf(
        "section" to "同期(実験的)",
        "intro" to "履歴やお気に入りを暗号化して、別の端末と同期します。実験的な機能です。サーバーは保管庫ではなく、端末の間の中継の置き場なので、しばらく使わないとサーバーのデータは消えます。この端末のデータは消えません。",
        "master" to "同期を使う",
        "master_note" to "オフの間は通信も送信待ちも起きません。鍵とサーバーのデータは残るので、オンに戻すと続きから同期します。",
        "kinds" to "同期するもの",
        "kinds_note" to "切った種類は送らず、受け取っても手元へ写しません。サーバーのデータは消えません。オンに戻すと追いつきます。",
        "kinds_resume_note" to "切っていた間に手元で消したものは、オンに戻すと同期のデータから戻ります。",
        "secret_ask_title" to "画像の削除キー・管理トークンを同期しますか?",
        "secret_ask_body" to "上げた画像を置き場から消すための値を、暗号化して同期します。これを持つ人はその画像を消せます。同期につないだ端末のどれかが漏れると、値も漏れたものと考えてください。暗号化の鍵を変えても守れません。ほかの端末には自動で広がりません。使う端末ごとにオンにしてください。",
        "secret_ask_ok" to "危険を理解してオンにする",
        "secret_note" to "既定はオフです。オフの間は、この端末からサーバーへ送らず、届いても読みません。",
        "advanced" to "詳しい設定",
        "leave_ask" to "この端末の鍵と同期の表を消します。この端末のお気に入りは消えません。サーバーのデータはそのままです。",
        "server_ask" to "新しいサーバーに認証の情報を送ります。",
        "join_ask" to "この端末の閲覧履歴・お気に入り・書き込み履歴・自分のレスの印・上げた画像の履歴・設定が、この同期へ送られます。相手の鍵で読めるので、自分の端末の QR 以外は読まないでください。",
        "join_ask_server" to "同期サーバー: {host}(ふだんと違います)",
        "join_ok" to "参加する",
        "join_cancel" to "やめる",
        "search_note" to "履歴・お気に入り・NG などを別の端末と同期(端末を追加・コードで参加)",
        "start" to "同期を始める",
        "add_device" to "端末を追加",
        "join" to "コードで参加",
        "sync_now" to "今すぐ同期",
        "leave" to "この端末で同期をやめる",
        "server_url" to "サーバーの URL",
        "status_space" to "領域",
        "status_pending" to "送信待ち",
        "status_error" to "最後のエラー",
        "pairing_warning" to "他の人に見せないでください。このコードがあれば、同期のデータをすべて読めます。",
        "copy" to "コピー",
        "scan" to "QR を読む",
    )

}
