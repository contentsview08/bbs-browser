// スマホ: 画像・動画を、写真の置き場(Pictures/bbs-browser・Movies/bbs-browser)へ保存する。
// 取ってくるのはアプリの通信(掲示板の画像は、ブラウザの決まり(CORS)では読めないことが多いので)、
// 書き込むのは Android の口(MainActivity の BbsAndroid.saveMedia。MediaStore を通す)
import { fetch } from '@tauri-apps/plugin-http'

interface BbsAndroid {
  saveMedia: (base64: string, fileName: string, mime: string) => string
}

/** URL の最後の部分から、ファイルの名前を作る */
function fileNameOf(url: string, mime: string): string {
  const last = url.split(/[?#]/)[0].split('/').filter(Boolean).at(-1) ?? 'image'
  if (/\.\w{2,5}$/.test(last)) return last
  return `${last}.${mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'}`
}

/** バイト列を base64 に(大きな画像でも止まらないよう、少しずつ) */
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** 保存して、保存した場所(Pictures/bbs-browser など)を返す。失敗したら理由を付けて投げる */
export async function saveMediaMobile(url: string): Promise<string> {
  const android = (window as unknown as { BbsAndroid?: BbsAndroid }).BbsAndroid
  if (!android) throw new Error('この端末では保存できません')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`画像を取れませんでした(HTTP ${res.status})`)
  const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const bytes = new Uint8Array(await res.arrayBuffer())
  const result = android.saveMedia(toBase64(bytes), fileNameOf(url, mime), mime)
  if (result.startsWith('error:')) throw new Error(result.slice(6))
  return result
}
