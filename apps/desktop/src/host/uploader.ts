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

export interface UploadOptions {
  /** 描き直して EXIF(撮影場所など)を取り除く */
  stripMetadata: boolean
  /** 長い辺がこれを超える画像は縮小する(px)。0 なら縮小しない */
  maxDimension: number
  /** catbox のアカウント(userhash)。あればアカウントで上げる(あとでサーバー上でも消せる) */
  userhash?: string
}

/**
 * 画像を描き直す。EXIF などは描き直すと付かなくなり、大きすぎる画像はついでに縮める。
 * 描き直す必要がなければ(EXIF を残してよく、縮める必要もない)元のファイルのまま返す
 */
async function prepare(file: File, o: UploadOptions): Promise<Blob> {
  if (!REENCODE.has(file.type)) return file
  const bitmap = await createImageBitmap(file)
  const long = Math.max(bitmap.width, bitmap.height)
  const scale = o.maxDimension > 0 && long > o.maxDimension ? o.maxDimension / long : 1
  if (!o.stripMetadata && scale === 1) {
    bitmap.close()
    return file
  }
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.convertToBlob({ type: file.type, quality: 0.9 })
}

/**
 * multipart/form-data の中身を自分で組み立てる。Android の plugin-http に FormData をそのまま渡すと、
 * 区切り(boundary)の付いた Content-Type が届かず、catbox が中身を読めずに空の返事(HTTP 200)を返していた
 */
async function multipart(fields: [string, string][], file: { name: string; fileName: string; type: string; data: Blob }) {
  const boundary = `----bbs-browser-${crypto.randomUUID()}`
  const enc = new TextEncoder()
  const quote = (v: string) => v.replace(/["\r\n]/g, '_')
  const parts: Uint8Array[] = []
  for (const [k, v] of fields) parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${quote(file.fileName)}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    ),
  )
  parts.push(new Uint8Array(await file.data.arrayBuffer()))
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`))
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return { bytes, contentType: `multipart/form-data; boundary=${boundary}` }
}

/** 上げて、ファイルの URL を返す */
export async function uploadToCatbox(file: File, options: UploadOptions): Promise<string> {
  const problem = checkUpload(file)
  if (problem) throw new Error(problem)
  const body = await prepare(file, options)
  const fields: [string, string][] = [['reqtype', 'fileupload']]
  if (options.userhash) fields.push(['userhash', options.userhash])
  const { bytes, contentType } = await multipart(fields, { name: 'fileToUpload', fileName: file.name || 'image', type: body.type || file.type, data: body })
  const res = await fetch(ENDPOINT, { method: 'POST', body: bytes, headers: { 'User-Agent': USER_AGENT, 'Content-Type': contentType } })
  const text = (await res.text()).trim()
  // 成功すると、本文にファイルの URL だけが返る。それ以外はエラーの文面
  if (res.ok && /^https:\/\/files\.catbox\.moe\/\S+$/.test(text)) return text
  throw new Error(`アップロードできませんでした: ${text || `HTTP ${res.status}`}`)
}

/**
 * アカウントで上げたファイルを、サーバー上から消す。消せるのは、そのアカウント(userhash)で上げたものだけ。
 * catbox の API は、ファイル名(files.catbox.moe/ の後ろ)を受け取る
 */
export async function deleteFromCatbox(url: string, userhash: string): Promise<void> {
  const name = /^https:\/\/files\.catbox\.moe\/([^/?#]+)$/.exec(url)?.[1]
  if (!name) throw new Error('catbox のファイルではありません')
  // FormData は Android の plugin-http で区切りが落ちるので、ふつうのフォームの形で送る(uploadToCatbox の multipart を参照)
  const form = new URLSearchParams({ reqtype: 'deletefiles', userhash, files: name })
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    body: form.toString(),
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const text = (await res.text()).trim()
  if (!res.ok || !/success/i.test(text)) throw new Error(`消せませんでした: ${text || `HTTP ${res.status}`}`)
}
