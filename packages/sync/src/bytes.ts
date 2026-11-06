// バイト列と文字列の変換。サーバーから来た値を読むので、どれも正しい形だけを受け付ける
import { SyncError } from './errors'

export function toHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) throw new SyncError('bad_encoding')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toBase64Url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 余りのビットが立った別表記も拒否する(同じバイト列に複数の書き方を許さない) */
export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new SyncError('bad_encoding')
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  if (toBase64Url(out) !== s) throw new SyncError('bad_encoding')
  return out
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** BOM も JSON の外の文字として残し、解析で落とす(スマホ版と同じ結果にするため) */
export function fromUtf8(b: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b)
  } catch {
    throw new SyncError('bad_utf8')
  }
}
