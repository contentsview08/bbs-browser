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

    fun message(code: String): String = MESSAGES[code] ?: "同期できませんでした($code)"

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
