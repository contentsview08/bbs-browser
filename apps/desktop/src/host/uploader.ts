// 画像のアップロード。設定の上げ先(uploadHost)に 1 枚ずつ上げる。自動なら catbox.moe(公式の API https://catbox.moe/user/api.php)
// → 0x0.st → imgur(Client-ID があれば)→ uguu.se の順に試す(2026-11 に catbox・0x0.st が止まったことがあった。スマホ版と同じ)。
// 上げたファイルは公開され、匿名なら消せない。EXIF もそのまま残るので、既定では描き直して取り除いてから上げる。
// 利用規約: catbox(https://catbox.moe/legal.php)は商用でなければ使える。0x0.st(https://0x0.st)はプログラムを名乗る User-Agent で使い、
// ポルノ・グロ・暗号資産などは上げない。uguu.se(https://uguu.se)は 3 時間で消える。imgur(https://api.imgur.com)は本人が登録した Client-ID で使う。
// どれも公開されている窓口だけを使い、負荷をかけないこと

import { fetch } from '@tauri-apps/plugin-http'

const ENDPOINT = 'https://catbox.moe/user/api.php'
const NULL_POINTER = 'https://0x0.st'
const UGUU = 'https://uguu.se/upload?output=json'
const IMGUR = 'https://api.imgur.com/3/image'
const USER_AGENT = 'bbs-browser/0.1.0 (+https://red-edge.net)'
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
  /** 上げ先(設定 uploadHost)。auto は catbox → 0x0.st → imgur → uguu.se の順に試す */
  host?: UploadHost
  /** imgur の Client-ID(なければ imgur は使わない) */
  imgurClientId?: string
}

export type UploadHost = 'auto' | 'catbox' | '0x0' | 'imgur' | 'uguu'
/** 設定に出す上げ先(スマホ版の設定と同じ並び・言葉) */
export const UPLOAD_HOSTS: { key: UploadHost; name: string }[] = [
  { key: 'auto', name: '自動(catbox → 0x0.st → imgur → uguu.se の順に試す)' },
  { key: 'catbox', name: 'catbox.moe(消えない)' },
  { key: '0x0', name: '0x0.st(30 日〜1 年で消える)' },
  { key: 'imgur', name: 'imgur(消えない。Client-ID が要る)' },
  { key: 'uguu', name: 'uguu.se(3 時間で消える)' },
]

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

/** 上げた結果。host は上げ先の名前(知らせに出す) */
export interface UploadResult {
  url: string
  host: string
}

/** 置き場の返事を、人に分かる言葉にする(スマホ版の Uploader.explain と同じ) */
export function explainUploadError(status: number, text: string): string {
  const t = text.slice(0, 200)
  if (/paused/i.test(t) && /storage/i.test(t)) return `今は受け付けを止めています(置き場の不具合。「${t}」)`
  if (status === 413 || /too large/i.test(t)) return 'ファイルが大きすぎます'
  if (status === 429) return '続けて上げすぎました。少し待ってから上げてください'
  if (status >= 500) return `置き場が落ちています(HTTP ${status})`
  if (!t) return `HTTP ${status}`
  if (t.startsWith('<')) return `受け付けませんでした(HTTP ${status})`
  return `${t}(HTTP ${status})`
}

/** JSON で返事をする置き場(uguu.se・imgur)に上げる。pick で返事から URL を取り出す。だめなら、返事の文面から理由を作る */
async function postJsonTo(
  endpoint: string,
  fileField: string,
  body: Blob,
  file: File,
  headers: Record<string, string>,
  pick: (j: unknown) => string | undefined,
  errorOf: (j: unknown) => string | undefined,
): Promise<string> {
  const { bytes, contentType } = await multipart([], { name: fileField, fileName: file.name || 'image', type: body.type || file.type, data: body })
  let res: Response
  try {
    res = await fetch(endpoint, { method: 'POST', body: bytes, headers: { 'User-Agent': USER_AGENT, 'Content-Type': contentType, ...headers } })
  } catch (e) {
    throw new Error(`つながりませんでした(${e instanceof Error ? e.message : String(e)})`)
  }
  const text = await res.text()
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    j = undefined
  }
  const url = j !== undefined ? pick(j) : undefined
  if (res.ok && url?.startsWith('https://')) return url
  if (res.status === 401 || res.status === 403) throw new Error(`Client-ID が通りませんでした(${(j !== undefined && errorOf(j)) || `HTTP ${res.status}`})`)
  throw new Error(explainUploadError(res.status, (j !== undefined && errorOf(j)) || text))
}

/** 1 つの置き場に上げる。成功すると、本文にファイルの URL だけが返る(urlPattern に合う)。それ以外はエラーの文面 */
async function postTo(endpoint: string, fields: [string, string][], fileField: string, body: Blob, file: File, urlPattern: RegExp): Promise<string> {
  const { bytes, contentType } = await multipart(fields, { name: fileField, fileName: file.name || 'image', type: body.type || file.type, data: body })
  let res: Response
  try {
    res = await fetch(endpoint, { method: 'POST', body: bytes, headers: { 'User-Agent': USER_AGENT, 'Content-Type': contentType } })
  } catch (e) {
    throw new Error(`つながりませんでした(${e instanceof Error ? e.message : String(e)})`)
  }
  const text = (await res.text()).trim()
  if (res.ok && urlPattern.test(text)) return text
  throw new Error(explainUploadError(res.status, text))
}

/**
 * 上げて、ファイルの URL と上げ先を返す。catbox → だめなら 0x0.st の順に試し、どちらもだめなら両方の理由を出す。
 * 上げた URL が本当に画像を返すかは、呼ぶ側(useMediaInput)が確かめる
 */
export async function uploadMedia(file: File, options: UploadOptions): Promise<UploadResult> {
  const problem = checkUpload(file)
  if (problem) throw new Error(problem)
  const body = await prepare(file, options)
  const catboxFields: [string, string][] = [['reqtype', 'fileupload']]
  if (options.userhash) catboxFields.push(['userhash', options.userhash])
  const clientId = options.imgurClientId?.trim()
  type J = { files?: { url?: string }[]; description?: string; data?: { link?: string; error?: string | { message?: string } } }
  const all: { key: UploadHost; host: string; up: () => Promise<string> }[] = [
    { key: 'catbox', host: 'catbox', up: () => postTo(ENDPOINT, catboxFields, 'fileToUpload', body, file, /^https:\/\/files\.catbox\.moe\/\S+$/) },
    { key: '0x0', host: '0x0.st', up: () => postTo(NULL_POINTER, [], 'file', body, file, /^https:\/\/0x0\.st\/\S+$/) },
    {
      key: 'imgur',
      host: 'imgur',
      up: () => {
        if (!clientId) return Promise.reject(new Error('Client-ID が設定されていません(設定 → 書き込み → 画像のアップロード)'))
        return postJsonTo(
          IMGUR,
          file.type.startsWith('video/') ? 'video' : 'image',
          body,
          file,
          { Authorization: `Client-ID ${clientId}` },
          (j) => (j as J).data?.link,
          (j) => {
            const e = (j as J).data?.error
            return typeof e === 'string' ? e : e?.message
          },
        )
      },
    },
    { key: 'uguu', host: 'uguu.se', up: () => postJsonTo(UGUU, 'files[]', body, file, {}, (j) => (j as J).files?.[0]?.url, (j) => (j as J).description) },
  ]
  const host = options.host ?? 'auto'
  // 自動なら上から順に試す(imgur は Client-ID があるときだけ)。選んだ上げ先だけなら、それだけ
  const tries = host === 'auto' ? all.filter((h) => h.key !== 'imgur' || !!clientId) : all.filter((h) => h.key === host)
  const reasons: string[] = []
  for (const t of tries) {
    try {
      return { url: await t.up(), host: t.host }
    } catch (e) {
      reasons.push(`${t.host}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(reasons.join(' / '))
}

/** はじめに試す上げ先(ここ以外に上げたときは、書き込み欄で知らせる) */
export const PRIMARY_HOST = 'catbox'

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
