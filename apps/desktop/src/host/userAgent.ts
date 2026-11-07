// 外へ名乗る User-Agent。版は npm run version:set が書き換える
const APP = 'OBB/0.1.4'

/** 2ch 互換の板は専ブラに Monazilla の UA を求める慣習がある */
export const MONAZILLA_UA = `Monazilla/1.00 (${APP})`
/** ふつうのブラウザに近い名乗り(OGP を返さないサイトがあるため) */
export const BROWSER_LIKE_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${APP}`
/** 画像の置き場へ */
export const UPLOADER_UA = `${APP} (+https://red-edge.net)`
