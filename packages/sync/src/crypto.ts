// レコードの暗号化。ノンスは毎回ここで作り、外から渡す口を作らない(テストの固定値が本番へ紛れないように)
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './bytes'
import { SyncError } from './errors'
import { canonicalJson, parseStrictJson } from './json'
import { KEY_BYTES, type SyncKeys } from './keys'
import type { SyncPayload } from './merge'
import { checkPayload } from './schema'

export const PAD_BLOCK = 256
export const NONCE_BYTES = 24
export const TAG_BYTES = 16
export const MAX_CIPHERTEXT = 16 * 1024

export type KindTag = 'h' | 's'

export interface RecordContext {
  space_id: string
  record_id: string
  kind_tag: KindTag
  schema_version: number
}

const HEX_64 = /^[0-9a-f]{64}$/

/** 中身の長さを隠す。最後に 0x80 を置いて 0 で埋める(ISO/IEC 7816-4)ので、必ず 1 バイト以上増える */
export function pad(plain: Uint8Array): Uint8Array {
  const out = new Uint8Array((Math.floor(plain.length / PAD_BLOCK) + 1) * PAD_BLOCK)
  out.set(plain)
  out[plain.length] = 0x80
  return out
}

export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length === 0 || padded.length % PAD_BLOCK !== 0) throw new SyncError('bad_padding')
  let i = padded.length - 1
  while (i >= 0 && padded[i] === 0) i--
  if (i < 0 || padded[i] !== 0x80) throw new SyncError('bad_padding')
  return padded.subarray(0, i)
}

/** 各項目の形を固定して、区切りの | を中身に混ぜられないようにする */
export function buildAad(ctx: RecordContext): Uint8Array {
  const { space_id, record_id, kind_tag, schema_version } = ctx
  if (!HEX_64.test(space_id) || !HEX_64.test(record_id) || (kind_tag !== 'h' && kind_tag !== 's') || !Number.isSafeInteger(schema_version) || schema_version < 0) {
    throw new SyncError('bad_aad')
  }
  return utf8(`${space_id}|${record_id}|${kind_tag}|${schema_version}`)
}

const keyFor = (keys: SyncKeys, tag: KindTag) => (tag === 's' ? keys.k_secret : keys.k_data)

function checkKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new SyncError('bad_key')
}

/** 公式のテストベクトルや埋め草のない暗号文も確かめられるよう、復号の中心は AAD をバイト列で受ける */
export function xchachaOpen(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  checkKey(key)
  if (nonce.length !== NONCE_BYTES) throw new SyncError('bad_nonce')
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext)
  } catch {
    throw new SyncError('decrypt_failed')
  }
}

export function sealRecord(key: Uint8Array, ctx: RecordContext, plain: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
  checkKey(key)
  const aad = buildAad(ctx)
  const padded = pad(plain)
  if (padded.length + TAG_BYTES > MAX_CIPHERTEXT) throw new SyncError('too_large')
  const nonce = randomBytes(NONCE_BYTES)
  return { nonce, ciphertext: xchacha20poly1305(key, nonce, aad).encrypt(padded) }
}

export function openRecord(key: Uint8Array, ctx: RecordContext, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const aad = buildAad(ctx)
  if (ciphertext.length > MAX_CIPHERTEXT || ciphertext.length < PAD_BLOCK + TAG_BYTES || (ciphertext.length - TAG_BYTES) % PAD_BLOCK !== 0) throw new SyncError('bad_length')
  return unpad(xchachaOpen(key, nonce, ciphertext, aad))
}

/** サーバーへ送る形。nonce・ciphertext は Base64URL(埋めの = なし) */
export function sealPayload(keys: SyncKeys, ctx: RecordContext, payload: SyncPayload): { nonce: string; ciphertext: string } {
  const { nonce, ciphertext } = sealRecord(keyFor(keys, ctx.kind_tag), ctx, utf8(canonicalJson(payload)))
  return { nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) }
}

export type OpenFailure = 'shape' | 'decrypt' | 'padding' | 'json' | 'schema'

export interface OpenedRecord {
  record_id: string
  version: number
  payload: SyncPayload
}

export interface OpenResult {
  records: OpenedRecord[]
  /** 捨てた数を画面に出すための記録。record_id は形が正しいときだけ入れ、中身は入れない */
  failed: { record_id: string | null; reason: OpenFailure }[]
}

/**
 * サーバーから来たレコードをまとめて開く。壊れたレコードはそれだけ捨てて数え、ほかを止めない。
 * 平文の deleted は改ざんできるので見ない(本当の値は暗号文の中)
 */
export function openRecords(keys: SyncKeys, spaceIdValue: string, raw: readonly unknown[]): OpenResult {
  const out: OpenResult = { records: [], failed: [] }
  for (const r of raw) {
    const o = (r !== null && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const id = typeof o.record_id === 'string' && HEX_64.test(o.record_id) ? o.record_id : null
    const fail = (reason: OpenFailure) => out.failed.push({ record_id: id, reason })
    const { version, kind_tag: tag, schema_version: schema, nonce, ciphertext } = o
    if (id === null || !Number.isSafeInteger(version) || (version as number) < 0 || (tag !== 'h' && tag !== 's') || !Number.isSafeInteger(schema) || (schema as number) < 0 || typeof nonce !== 'string' || typeof ciphertext !== 'string') {
      fail('shape')
      continue
    }
    let plain: Uint8Array
    try {
      plain = openRecord(keyFor(keys, tag), { space_id: spaceIdValue, record_id: id, kind_tag: tag, schema_version: schema as number }, fromBase64Url(nonce), fromBase64Url(ciphertext))
    } catch (e) {
      const code = e instanceof SyncError ? e.code : ''
      fail(code === 'decrypt_failed' ? 'decrypt' : code === 'bad_padding' ? 'padding' : 'shape')
      continue
    }
    let value: unknown
    try {
      value = parseStrictJson(fromUtf8(plain))
    } catch {
      fail('json')
      continue
    }
    const payload = checkPayload(value)
    if (payload === null) fail('schema')
    else out.records.push({ record_id: id, version: version as number, payload })
  }
  return out
}
