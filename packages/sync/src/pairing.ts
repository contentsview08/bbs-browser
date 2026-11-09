// 端末を足すコード。obb1.<K の Base64URL>.<サーバーの URL の Base64URL>.<許可証>。QR もコピー用のコードも同じ文字列
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './bytes'
import { deriveKeys, KEY_BYTES, spaceId } from './keys'
import { checkServerUrl, SyncApiError, ticketSpaceId } from './engine/transport'

const PREFIX = 'obb1'

export interface PairingCode {
  k: Uint8Array
  serverUrl: string
  ticket: string
}

export function encodePairingCode(c: PairingCode): string {
  return [PREFIX, toBase64Url(c.k), toBase64Url(utf8(c.serverUrl)), c.ticket].join('.')
}

/** 形と、許可証が K の領域のものであることだけを確かめる。署名と期限はサーバーだけが確かめる */
export function parsePairingCode(code: string, allowLocalhost = false): PairingCode {
  const s = code.trim()
  const a = s.indexOf('.')
  const b = s.indexOf('.', a + 1)
  const c = s.indexOf('.', b + 1)
  if (a < 0 || b < 0 || c < 0 || s.slice(0, a) !== PREFIX) throw new SyncApiError('bad_code')
  try {
    const k = fromBase64Url(s.slice(a + 1, b))
    if (k.length !== KEY_BYTES) throw new SyncApiError('bad_code')
    const ticket = s.slice(c + 1)
    if (ticketSpaceId(ticket) !== spaceId(deriveKeys(k).auth_token)) throw new SyncApiError('bad_code')
    return { k, serverUrl: checkServerUrl(fromUtf8(fromBase64Url(s.slice(b + 1, c))), allowLocalhost), ticket }
  } catch (e) {
    if (e instanceof SyncApiError && e.kind === 'bad_url') throw e
    throw new SyncApiError('bad_code')
  }
}

// Google ドライブの置き場の端末を足すコード(docs/sync-drive.md 5.5)。obb2.<K の Base64URL>.<更新用のトークンの UTF-8 の Base64URL>。
// サーバーの URL・許可証・メールは入れない(読んだ端末が Google に聞いて確かめる)
const DRIVE_PREFIX = 'obb2'
/** Google の更新用のトークンは 100 文字ほど。QR に収まる長さで切る */
const REFRESH_TOKEN_MAX = 512

export interface DrivePairingCode {
  k: Uint8Array
  refreshToken: string
}

const refreshTokenOk = (t: string) => t.length > 0 && t.length <= REFRESH_TOKEN_MAX && /^[\x21-\x7e]+$/.test(t)

export function encodeDrivePairingCode(c: DrivePairingCode): string {
  if (c.k.length !== KEY_BYTES || !refreshTokenOk(c.refreshToken)) throw new SyncApiError('bad_code')
  return [DRIVE_PREFIX, toBase64Url(c.k), toBase64Url(utf8(c.refreshToken))].join('.')
}

/** 形だけを確かめる。トークンが使えるかは Google に聞くまで分からない */
export function parseDrivePairingCode(code: string): DrivePairingCode {
  const parts = code.trim().split('.')
  if (parts.length !== 3 || parts[0] !== DRIVE_PREFIX) throw new SyncApiError('bad_code')
  try {
    const k = fromBase64Url(parts[1])
    const refreshToken = fromUtf8(fromBase64Url(parts[2]))
    if (k.length !== KEY_BYTES || !refreshTokenOk(refreshToken)) throw new SyncApiError('bad_code')
    return { k, refreshToken }
  } catch {
    throw new SyncApiError('bad_code')
  }
}
