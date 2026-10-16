// 画像のアップロード(catbox.moe)。公式の API(https://catbox.moe/user/api.php)に、匿名で 1 枚ずつ上げる。
// 上げたファイルは公開され、匿名なら消せない。EXIF もそのまま残るので、既定では描き直して取り除いてから上げる。
// 利用規約(https://catbox.moe/legal.php): 商用でなければ使える。公開されている窓口だけを使い、負荷をかけないこと

import { fetch } from '@tauri-apps/plugin-http'

const ENDPOINT = 'https://catbox.moe/user/api.php'
const USER_AGENT = 'bbs-browser/0.1.0'
/**
 * catbox の上限は 200MB だが、plugin-http は送る中身を数値の配列(JSON)にして Rust 側へ渡すので、
 * 大きすぎると固まる。アプリ側では 50MB までにする。GIF は catbox の決まりで 20MB まで
 */
const MAX_BYTES = 50 * 1024 * 1024
const MAX_GIF_BYTES = 20 * 1024 * 1024

/** 描き直して EXIF(撮影場所など)を取り除ける形式。GIF は描き直すとアニメが崩れるので外す */
const REENCODE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** 上げる前に確かめる。だめなら理由を返す */
export function checkUpload(file: File): string | undefined {
  if (!/^(image|video)\//.test(file.type)) return '画像か動画だけを上げられます'
  if (file.type === 'image/gif' && file.size > MAX_GIF_BYTES) return 'GIF は 20MB までです(大きいアニメは webm にしてください)'
  if (file.size > MAX_BYTES) return 'このアプリから上げられるのは 50MB までです'
  return undefined
}

/** 画像を描き直して、EXIF などの付いていない同じ形式の画像にする */
async function stripMetadata(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: file.type, quality: 0.92 })
}

/** 上げて、ファイルの URL を返す */
export async function uploadToCatbox(file: File, options: { stripMetadata: boolean }): Promise<string> {
  const problem = checkUpload(file)
  if (problem) throw new Error(problem)
  const body = options.stripMetadata && REENCODE.has(file.type) ? await stripMetadata(file) : file
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', body, file.name || 'image')
  const res = await fetch(ENDPOINT, { method: 'POST', body: form, headers: { 'User-Agent': USER_AGENT } })
  const text = (await res.text()).trim()
  // 成功すると、本文にファイルの URL だけが返る。それ以外はエラーの文面
  if (res.ok && /^https:\/\/files\.catbox\.moe\/\S+$/.test(text)) return text
  throw new Error(`アップロードできませんでした: ${text || `HTTP ${res.status}`}`)
}
