package io.github.contentsview08.obb.data

import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder
import io.github.contentsview08.obb.sync.deriveKeys
import io.github.contentsview08.obb.sync.engine.SyncApiError
import io.github.contentsview08.obb.sync.parsePairingCode
import io.github.contentsview08.obb.sync.spaceId
import java.net.URI

// QR の読み書きと、同期を始める窓の移動の決まり。画面に依存しないので JVM のテストで確かめる

/** 点の並び。外の余白 2 マスを含む(PC と同じ) */
fun qrMatrix(text: String, border: Int = 2): Array<BooleanArray> {
    val m = Encoder.encode(text, ErrorCorrectionLevel.L, mapOf(EncodeHintType.CHARACTER_SET to "UTF-8")).matrix
    val n = m.width + border * 2
    return Array(n) { y -> BooleanArray(n) { x -> x >= border && y >= border && x < n - border && y < n - border && m.get(x - border, y - border).toInt() == 1 } }
}

/** 明るさの面から読む。写っていなければ null */
fun decodeQrLuma(luma: ByteArray, width: Int, height: Int, rowStride: Int): String? = try {
    val source = PlanarYUVLuminanceSource(luma, rowStride, height, 0, 0, width, height, false)
    QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), mapOf(DecodeHintType.TRY_HARDER to true)).text
} catch (_: ReaderException) {
    null
} catch (_: RuntimeException) {
    // 細工した QR で zxing が落ちても、カメラの処理を止めない
    null
}

/** 読み取ったコードの扱い。同じ領域の判定は K から出した領域の ID で行う */
sealed class SyncQrRead {
    class Join(val code: String) : SyncQrRead()
    class OtherSpace(val code: String, val serverUrl: String) : SyncQrRead()
    data object SameSpace : SyncQrRead()
    /** reason は SyncText.message のコード */
    class Bad(val reason: String) : SyncQrRead()
}

/** [space] は状態の領域の先頭。鍵を読めない間は null で、別の領域として確認に回す */
fun readSyncQr(text: String, enabled: Boolean, space: String?, allowLocalhost: Boolean = false): SyncQrRead {
    val c = try {
        parsePairingCode(text, allowLocalhost)
    } catch (e: SyncApiError) {
        return SyncQrRead.Bad(e.code.ifEmpty { e.kind })
    } catch (_: RuntimeException) {
        // QR の中身は外から来るので、検査の中の想定外も読めないコードとして扱う
        return SyncQrRead.Bad("bad_code")
    }
    if (!enabled) return SyncQrRead.Join(text)
    val same = space != null && spaceId(deriveKeys(c.k).authToken).startsWith(space)
    return if (same) SyncQrRead.SameSpace else SyncQrRead.OtherSpace(text, c.serverUrl)
}

sealed class SyncStartNav {
    class Ticket(val value: String) : SyncStartNav()
    data object Allow : SyncStartNav()
    data object Block : SyncStartNav()
}

private const val TICKET_HOST = "obb-sync.invalid"
private const val TURNSTILE_HOST = "challenges.cloudflare.com"

private fun portOf(u: URI) = if (u.port >= 0) u.port else when (u.scheme) {
    "https" -> 443
    "http" -> 80
    else -> -1
}

/** 窓の中で動ける先は、同期サーバーと確認の部品だけ。PC の sync_start.rs と同じ決まり */
fun syncStartNav(target: String, startUrl: String): SyncStartNav {
    if (target == "about:blank" || target == "about:srcdoc") return SyncStartNav.Allow
    val u = runCatching { URI(target) }.getOrNull() ?: return SyncStartNav.Block
    val server = runCatching { URI(startUrl) }.getOrNull() ?: return SyncStartNav.Block
    if (u.scheme == "https" && u.host == TICKET_HOST && u.path == "/ticket") {
        val ticket = u.rawQuery?.split('&')?.firstOrNull { it.startsWith("ticket=") }?.removePrefix("ticket=") ?: return SyncStartNav.Block
        return SyncStartNav.Ticket(java.net.URLDecoder.decode(ticket, "UTF-8"))
    }
    val sameServer = u.scheme == server.scheme && u.host == server.host && portOf(u) == portOf(server)
    return if (sameServer || (u.scheme == "https" && u.host == TURNSTILE_HOST)) SyncStartNav.Allow else SyncStartNav.Block
}
