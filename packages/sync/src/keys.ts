// 鍵の導出とレコード ID
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { toBase64Url, toHex, utf8 } from './bytes'
import { SyncError } from './errors'

export const KEY_BYTES = 32

export interface SyncKeys {
  auth_token: Uint8Array
  k_data: Uint8Array
  k_secret: Uint8Array
  k_id: Uint8Array
}

export const generateMasterKey = (): Uint8Array => randomBytes(KEY_BYTES)

const DEVICE_ID_BYTES = 16
export const generateDeviceId = (): string => toBase64Url(randomBytes(DEVICE_ID_BYTES))

export type DeviceCheck = 'none' | 'ok' | 'clear' | 'rejoin'

/**
 * 起動時に鍵保管と DB の device_id を比べる。DB を別の端末から入れると同じ device_id の端末が 2 台でき、read_dev がぶつかる。
 * clear は同期の表を消して使っていない状態へ、rejoin は同期の表を消し、新しい device_id で合流し直す
 */
export function checkDeviceId(stored: string | null, inDb: string | null): DeviceCheck {
  if (stored === null) return inDb === null ? 'none' : 'clear'
  return stored === inDb ? 'ok' : 'rejoin'
}

export function deriveKeys(k: Uint8Array): SyncKeys {
  if (k.length !== KEY_BYTES) throw new SyncError('bad_key')
  const d = (info: string) => hkdf(sha256, k, new Uint8Array(0), utf8(info), KEY_BYTES)
  return { auth_token: d('obb-sync/auth'), k_data: d('obb-sync/data'), k_secret: d('obb-sync/secret'), k_id: d('obb-sync/record-id') }
}

/** Worker は Bearer の 16 進をバイト列に戻して同じ計算をする */
export const spaceId = (authToken: Uint8Array): string => toHex(sha256(authToken))

const FIVE_CH_NET = /^((?:[a-z0-9]+\.)?)5ch\.net$/
const URL_RE = /^https?:\/\/(?:[^/?#@]*@)?(\[[^\]/?#]+\]|[^/?#:@]+)(?::([0-9]*))?([^?#]*)(?:[?#][\s\S]*)?$/i
const EDGE_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g
const MAX_URL = 2048

/**
 * 板 URL の同一性の決まり。スキームを除いた「ホスト[:ポート]/道/」にする(コネクタの boardKey と同じ形)。
 * http と https、5ch.net と 5ch.io、大文字のホスト、末尾の /、既定のポートの違いをなくす。道の大文字は板の名前なので変えない。
 * 掲示板の URL でなければ null
 */
export function normalizeBoardUrl(url: string): string | null {
  const s = url.replace(EDGE_SPACE, '')
  // eslint-disable-next-line no-control-regex
  if (s.length > MAX_URL || /[\x00-\x20\x7f]/.test(s)) return null
  const m = URL_RE.exec(s)
  if (!m) return null
  const host = m[1].toLowerCase().replace(/\.$/, '').replace(FIVE_CH_NET, '$15ch.io')
  if (!host) return null
  const port = m[2] && !['80', '443'].includes(m[2]) ? `:${m[2]}` : ''
  const path = `/${m[3]}/`.replace(/\/{2,}/g, '/')
  return host + port + path
}

/** 区切りの : を中身と混同しないようにする(細目に URL などが入っても、別のレコードと同じ ID にならない) */
const escapePart = (s: string) => s.replace(/%/g, '%25').replace(/:/g, '%3A')

/** HMAC にかける文字列。板のないレコード(設定など)は boardUrl を null にする */
export function recordIdInput(kind: string, boardUrl: string | null, thread?: string | null, detail?: string | null): string {
  const board = boardUrl === null ? '' : normalizeBoardUrl(boardUrl)
  if (board === null || !/^[a-z_]{1,32}$/.test(kind)) throw new SyncError('bad_id')
  const head = `${kind}:${escapePart(board)}:${escapePart(thread ?? '')}`
  return detail === undefined || detail === null ? head : `${head}:${escapePart(detail)}`
}

export function recordId(kId: Uint8Array, kind: string, boardUrl: string | null, thread?: string | null, detail?: string | null): string {
  return toHex(hmac(sha256, kId, utf8(recordIdInput(kind, boardUrl, thread, detail))))
}
