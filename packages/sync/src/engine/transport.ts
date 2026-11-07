// サーバーとの通信の口。実物の HTTP は差し替えで渡す。https 以外とリダイレクトはここで断る(トークンが別の先へ渡らないように)
import { HTTP_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../config'
import { parseStrictJson } from '../json'
import { checkPowChallenge, solvePow } from './pow'
import type { SyncPace } from './scheduler'

export interface SyncRequest {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string
  /** 読みながら数えて、超えたら打ち切る */
  maxBytes: number
  timeoutMs: number
}

export interface SyncResponse {
  status: number
  headers?: Record<string, string>
  body: string
}

/** 応答が上限を超えた。通信の失敗と分ける(オフラインに見せない) */
export class SyncResponseTooLarge extends Error {}

/** 実装はリダイレクトをたどらず Cookie を持たない。通信できないときは例外を投げる */
export interface SyncTransport {
  send(req: SyncRequest): Promise<SyncResponse>
}

export type SyncFailureKind = 'bad_url' | 'bad_ticket' | 'bad_code' | 'network' | 'redirect' | 'too_large' | 'bad_response' | 'no_progress' | 'http'

export class SyncApiError extends Error {
  constructor(readonly kind: SyncFailureKind, readonly status = 0, readonly code = '', readonly detail: Record<string, unknown> | null = null) {
    super(code ? `${kind}:${code}` : kind)
    this.name = 'SyncApiError'
  }
}

const HTTPS_URL = /^https:\/\/[^/?#@\s\\]+(?:\/[^?#\s\\]*)?$/
const LOCAL_URL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]+)?(?:\/[^?#\s\\]*)?$/

/** 利用者名・パスワード・クエリ・フラグメントを拒否する。localhost は開発の版だけ */
export function checkServerUrl(url: string, allowLocalhost = false): string {
  if (!HTTPS_URL.test(url) && !(allowLocalhost && LOCAL_URL.test(url))) throw new SyncApiError('bad_url')
  return url.replace(/\/+$/, '')
}

const TICKET_FORM = /^v1\.([0-9a-f]{64})\.[0-9]{1,12}\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{43}$/

/** 許可証の結び付く領域。形が違えば null。署名と期限はサーバーだけが確かめる(端末の時計を信用しない) */
export function ticketSpaceId(ticket: string): string | null {
  return TICKET_FORM.exec(ticket)?.[1] ?? null
}

export interface ChangesPage {
  records: Record<string, unknown>[]
  head: number
  more: boolean
  epoch: string
  gc_floor: number
}

export interface PushResult {
  record_id: string
  status: number
  version?: number
  record?: Record<string, unknown>
}

export interface PushResponse {
  results: PushResult[]
  epoch: string
  gc_floor: number
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const bad = () => new SyncApiError('bad_response')

function checkEpoch(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 128) throw bad()
  return v
}

export interface HeadResult {
  /** 304 なら null */
  version: number | null
  epoch?: string
  gc_floor?: number
}

export class SyncApi {
  private readonly base: string
  /** 応答に書いてあった「最低これだけ空ける」。古いサーバーは書かない */
  pace: SyncPace | null = null

  constructor(serverUrl: string, private readonly tokenHex: string, private readonly transport: SyncTransport, allowLocalhost = false) {
    this.base = checkServerUrl(serverUrl, allowLocalhost)
  }

  private async call(method: SyncRequest['method'], path: string, body?: unknown, etag?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.tokenHex}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (etag !== undefined) headers['If-None-Match'] = etag
    let res: SyncResponse
    try {
      res = await this.transport.send({
        method,
        url: this.base + path,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: HTTP_TIMEOUT_MS,
      })
    } catch (e) {
      throw new SyncApiError(e instanceof SyncResponseTooLarge ? 'too_large' : 'network')
    }
    if (res.status >= 300 && res.status < 400) throw new SyncApiError('redirect', res.status)
    if (res.body.length > MAX_RESPONSE_BYTES) throw new SyncApiError('too_large')
    let parsed: unknown
    try {
      parsed = parseStrictJson(res.body)
    } catch {
      parsed = null
    }
    if (res.status < 200 || res.status >= 300) throw new SyncApiError('http', res.status, isObject(parsed) && typeof parsed.error === 'string' ? parsed.error.slice(0, 64) : '', isObject(parsed) ? parsed : null)
    if (!isObject(parsed)) throw bad()
    if (isObject(parsed.pace)) this.pace = parsed.pace as SyncPace
    return parsed
  }

  /** 同じ ETag なら 304。Cookie も本文もないので一番軽い確認になる */
  async head(etag: string | null): Promise<HeadResult> {
    try {
      const r = await this.call('GET', '/head', undefined, etag ?? undefined)
      if (!isCount(r.version) || !isCount(r.gc_floor)) throw bad()
      return { version: r.version, epoch: checkEpoch(r.epoch), gc_floor: r.gc_floor }
    } catch (e) {
      if (e instanceof SyncApiError && e.kind === 'redirect' && e.status === 304) return { version: null }
      throw e
    }
  }

  async createSpace(ticket: string): Promise<{ epoch: string }> {
    let r: Record<string, unknown>
    try {
      r = await this.call('POST', '/spaces', { ticket })
    } catch (e) {
      if (!(e instanceof SyncApiError && e.status === 403 && e.code === 'pow_required')) throw e
      let pow
      try {
        pow = checkPowChallenge(e.detail?.pow)
      } catch {
        throw bad()
      }
      // 解いて 1 回だけ送り直す。断られたら、ほかの 403 と同じくエンジンが止まる
      r = await this.call('POST', '/spaces', { ticket, pow: { challenge: pow.challenge, nonce: await solvePow(pow.challenge, pow.bits) } })
    }
    return { epoch: checkEpoch(r.epoch) }
  }

  async changes(since: number): Promise<ChangesPage> {
    const r = await this.call('GET', `/changes?since=${since}`)
    if (!Array.isArray(r.records) || !r.records.every(isObject) || !isCount(r.head) || typeof r.more !== 'boolean' || !isCount(r.gc_floor)) throw bad()
    return { records: r.records, head: r.head, more: r.more, epoch: checkEpoch(r.epoch), gc_floor: r.gc_floor }
  }

  async pushRecords(requestId: string, records: Record<string, unknown>[]): Promise<PushResponse> {
    const r = await this.call('POST', '/records', { request_id: requestId, records })
    if (!Array.isArray(r.results) || !isCount(r.gc_floor)) throw bad()
    const results = r.results.map((x): PushResult => {
      if (!isObject(x) || typeof x.record_id !== 'string' || (x.status !== 200 && x.status !== 409)) throw bad()
      if (x.status === 200 && !isCount(x.version)) throw bad()
      if (x.status === 409 && !isObject(x.record)) throw bad()
      return x as unknown as PushResult
    })
    return { results, epoch: checkEpoch(r.epoch), gc_floor: r.gc_floor }
  }
}
