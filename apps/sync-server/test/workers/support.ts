// workerd の中のテストの共通の道具
import { env, SELF, runDurableObjectAlarm } from 'cloudflare:test'
import type { Env } from '../../src/config'
import { fromBase64Url, sha256, toBase64Url, toHex, utf8 } from '../../src/encoding'
import { runtime } from '../../src/runtime'
import { issueTicket } from '../../src/ticket'
import { fakeSiteverify } from '../fakeSiteverify'
import ticketFile from '../../../../packages/conformance/sync-ticket.json'

export const testEnv = env as unknown as Env
export const START = 1_800_000_000_000
export const BASE = 'https://sync.test'
export const clock = { now: START }

/** 既定の検査の外にあるものを切っておく。テストごとに必要なものだけ戻す */
export const QUIET: Record<string, string> = { POW_BITS: '0', SOURCE_LIMIT: '0', EMPTY_SPACE_DAYS: '0', RATE_PER_MINUTE: '0', RATE_PER_DAY: '0', FULL_PULL_PER_HOUR: '0' }

export function setup(overrides: Record<string, string> = {}): void {
  clock.now = START
  runtime.now = () => clock.now
  runtime.fetch = fakeSiteverify
  runtime.overrides = { ...QUIET, ...overrides }
}

export function teardown(): void {
  runtime.now = () => Date.now()
  runtime.fetch = (input, init) => fetch(input, init)
  runtime.overrides = null
  clock.now = START
}

export async function tokenOf(name: string): Promise<string> {
  return toHex(await sha256(utf8(`token:${name}`)))
}

export async function spaceIdOf(name: string): Promise<string> {
  const t = await tokenOf(name)
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
  return toHex(await sha256(bytes))
}

export const TICKET_KEY = fromBase64Url(ticketFile.key.secret) as Uint8Array
export const TICKET_KID = ticketFile.key.kid

/** 発行の手順は別のテストで見る。ほかのテストは署名した許可証をそのまま使う */
export async function ticketOf(name: string, ttlMs = 365 * 24 * 3600 * 1000): Promise<string> {
  return await issueTicket(TICKET_KEY, TICKET_KID, await spaceIdOf(name), Math.floor((runtime.now() + ttlMs) / 1000))
}

export async function recordIdOf(name: string): Promise<string> {
  return toHex(await sha256(utf8(`record:${name}`)))
}

export const cipher = (n = 272): string => toBase64Url(new Uint8Array(n))
export const NONCE = toBase64Url(new Uint8Array(24))

let ipSeq = 1
/** レート制限の数え先が混ざらないよう、テストごとに別の IP にする */
export const freshIp = (): string => `198.51.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`

export interface CallOptions {
  token?: string | null
  auth?: string
  body?: string
  headers?: Record<string, string>
  ip?: string
  base?: string
}

export async function call(method: string, path: string, o: CallOptions = {}): Promise<Response> {
  // 指定がなければ毎回別の IP にする。IP ごとの回数を見るテストだけ同じ IP を渡す
  const headers: Record<string, string> = { 'CF-Connecting-IP': o.ip ?? freshIp(), ...o.headers }
  if (o.auth !== undefined) headers.Authorization = o.auth
  else if (o.token) headers.Authorization = `Bearer ${await tokenOf(o.token)}`
  let body = o.body
  if (body === undefined && method === 'POST') body = path === '/spaces' && o.token ? JSON.stringify({ ticket: await ticketOf(o.token) }) : '{}'
  if (body !== undefined && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json'
  return await SELF.fetch(`${o.base ?? BASE}${path}`, { method, headers, ...(body !== undefined && { body }) })
}

export async function record(id: string, o: { base_version?: number; deleted?: boolean; bytes?: number } = {}) {
  return {
    record_id: await recordIdOf(id),
    base_version: o.base_version ?? 0,
    kind_tag: 'h',
    schema_version: 1,
    deleted: o.deleted ?? false,
    nonce: NONCE,
    ciphertext: cipher(o.bytes ?? 272),
  }
}

let reqSeq = 0
export const requestId = (): string => `r${String(++reqSeq).padStart(21, '0')}`

export async function push(token: string, records: unknown[], id = requestId(), o: CallOptions = {}): Promise<Response> {
  return await call('POST', '/records', { token, body: JSON.stringify({ request_id: id, records }), ...o })
}

export const ledger = () => testEnv.LEDGER.getByName('ledger')
export const spaceStub = (id: string) => testEnv.SPACE.getByName(id)

/** 時刻を進めて、その間に来ているはずの alarm を走らせる */
export async function advance(ms: number, spaces: string[] = []): Promise<void> {
  clock.now += ms
  for (const id of spaces) await runDurableObjectAlarm(spaceStub(id) as unknown as DurableObjectStub)
  await runDurableObjectAlarm(ledger() as unknown as DurableObjectStub)
}

/** 回数の窓は固定の 60 秒なので、境目をまたいでも必ず超えるよう上限の 3 倍まで送る */
export async function until429(limit: number, send: (i: number) => Promise<Response>): Promise<Response> {
  let last = await send(0)
  for (let i = 1; i < limit * 3 && last.status !== 429; i++) {
    await last.text()
    last = await send(i)
  }
  return last
}
