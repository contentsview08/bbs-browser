// サーバーとの通信の口。実物の HTTP は差し替えで渡す。https 以外とリダイレクトはここで断る(トークンが別の先へ渡らないように)
import { HTTP_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../config'
import { parseStrictJson } from '../json'

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

/** 実装はリダイレクトをたどらず Cookie を持たない。通信できないときは例外を投げる */
export interface SyncTransport {
  send(req: SyncRequest): Promise<SyncResponse>
}

export type SyncFailureKind = 'bad_url' | 'network' | 'redirect' | 'too_large' | 'bad_response' | 'no_progress' | 'http'

export class SyncApiError extends Error {
  constructor(readonly kind: SyncFailureKind, readonly status = 0, readonly code = '') {
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

export class SyncApi {
  private readonly base: string

  constructor(serverUrl: string, private readonly tokenHex: string, private readonly transport: SyncTransport, allowLocalhost = false) {
    this.base = checkServerUrl(serverUrl, allowLocalhost)
  }

  private async call(method: SyncRequest['method'], path: string, body?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.tokenHex}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
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
    } catch {
      throw new SyncApiError('network')
    }
    if (res.status >= 300 && res.status < 400) throw new SyncApiError('redirect', res.status)
    if (res.body.length > MAX_RESPONSE_BYTES) throw new SyncApiError('too_large')
    let parsed: unknown
    try {
      parsed = parseStrictJson(res.body)
    } catch {
      parsed = null
    }
    if (res.status < 200 || res.status >= 300) throw new SyncApiError('http', res.status, isObject(parsed) && typeof parsed.error === 'string' ? parsed.error.slice(0, 64) : '')
    if (!isObject(parsed)) throw bad()
    return parsed
  }

  async createSpace(): Promise<{ epoch: string }> {
    const r = await this.call('POST', '/spaces', {})
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
