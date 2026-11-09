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
import io.github.contentsview08.obb.sync.isServerPairingCode
import io.github.contentsview08.obb.sync.parseDrivePairingCode
import io.github.contentsview08.obb.sync.spaceId

// QR の読み書きの決まり。画面に依存しないので JVM のテストで確かめる

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
    class OtherSpace(val code: String) : SyncQrRead()
    /** 同じ同期の QR。Google の接続(トークン)だけを置き直す(取り消し・期限切れの後の配り直し) */
    class SameSpace(val code: String) : SyncQrRead()
    /** reason は SyncText.message のコード */
    class Bad(val reason: String) : SyncQrRead()
}

/** [space] は状態の領域の先頭。鍵を読めない間は null で、別の領域として確認に回す。同期サーバーのコード(obb1)は読まずに案内する */
fun readSyncQr(text: String, enabled: Boolean, space: String?): SyncQrRead {
    if (isServerPairingCode(text)) return SyncQrRead.Bad("server_code")
    val c = try {
        parseDrivePairingCode(text)
    } catch (e: SyncApiError) {
        return SyncQrRead.Bad(e.code.ifEmpty { e.kind })
    } catch (_: RuntimeException) {
        // QR の中身は外から来るので、検査の中の想定外も読めないコードとして扱う
        return SyncQrRead.Bad("bad_code")
    }
    if (!enabled) return SyncQrRead.Join(text)
    val same = space != null && spaceId(deriveKeys(c.k).authToken).startsWith(space)
    return if (same) SyncQrRead.SameSpace(text) else SyncQrRead.OtherSpace(text)
}
