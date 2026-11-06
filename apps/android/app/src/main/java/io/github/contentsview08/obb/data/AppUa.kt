package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.BuildConfig

/** 外へ名乗る User-Agent。形は PC 版の host/userAgent.ts と同じ */
internal object AppUa {
    private val APP = "OBB/${BuildConfig.VERSION_NAME}"

    /** 2ch 互換の板は専ブラに Monazilla の UA を求める慣習がある */
    val MONAZILLA = "Monazilla/1.00 ($APP)"

    /** ふつうのブラウザに近い名乗り(OGP を返さないサイトがあるため) */
    val BROWSER_LIKE = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) $APP"

    /** 画像の置き場へ */
    val UPLOADER = "$APP (+https://red-edge.net)"
}
