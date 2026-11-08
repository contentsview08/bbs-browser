// コネクタに渡す ConnectorContext の Tauri 版。
// 通信は plugin-http(Rust 側の reqwest)を通すので、CORS に縛られず User-Agent も設定できる。
// 読む通信(GET)は plugin-http で、書き込み(POST)は自前の通信で送る(下の post)。

import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectorContext, HttpRequestOptions, HttpResponse } from '@bbs-browser/connectors'
import { fetchHttpsFirst } from '../utils/httpsFirst'
import { readCapped } from '../utils/cappedBody'
import { isRedirectStatus, MAX_REDIRECTS, redirectAllowed } from '../utils/safeUrl'
import { MONAZILLA_UA as USER_AGENT } from './userAgent'

const READ_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 180_000
/** 応答の大きさの上限(スマホ版の Http.kt の READ_MAX_BYTES と同じ)。大きな dat でも数 MB に収まる */
export const READ_MAX_BYTES = 16 * 1024 * 1024

async function request(url: string, init: RequestInit, opts?: HttpRequestOptions): Promise<HttpResponse> {
  // ファイルを付けた multipart の本文(バイト列)も、そのまま送る
  // 返事のないサーバーで、更新や書き込みが止まったままにならないように。ファイルを送るときは長めに待つ
  const limit = init.body ? UPLOAD_TIMEOUT_MS : READ_TIMEOUT_MS
  const signal = AbortSignal.timeout(limit)
  const headers = { 'User-Agent': USER_AGENT, ...opts?.headers }
  try {
    let res: Response
    if (init.method === 'GET') {
      // GET のリダイレクトは 1 段ずつたどり、行き先を確かめる(noRedirect なら 3xx をそのまま返す)
      const send = (u: string) => fetch(u, { ...init, headers, signal, maxRedirections: 0 })
      let current = url
      res = await send(current)
      for (let i = 0; !opts?.noRedirect && isRedirectStatus(res.status); i++) {
        const location = res.headers.get('location')
        if (!location) break
        const next = new URL(location, current).href
        if (i >= MAX_REDIRECTS) throw new Error(`リダイレクトが多すぎます: ${url}`)
        if (!redirectAllowed(current, next)) throw new Error(`家の中・自分の PC のアドレスへのリダイレクトは読みません: ${next}`)
        void res.body?.cancel().catch(() => undefined)
        current = next
        res = await send(current)
      }
    } else {
      res = await fetch(url, { ...init, headers, signal })
    }
    const out: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
    return { status: res.status, headers: out, body: await readCapped(res, READ_MAX_BYTES) }
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error(`サーバーから返事がありません(${limit / 1000} 秒)`)
    throw e
  }
}

/**
 * POST(書き込み・アカウントのログイン)は、Rust 側の自前の通信(post_http.rs)で送る。
 * Cookie もそこが持ち、書き込みごとに一部(BE の Cookie など)を外して送れるようにするため
 */
async function post(url: string, body: string | Uint8Array, opts?: HttpRequestOptions): Promise<HttpResponse> {
  // 読む通信と同じ Cookie の置き場で送る(ふたば: ページを見たときに渡された Cookie を、書き込みに付ける)
  if (opts?.sameCookiesAsGet) return request(url, { method: 'POST', body: body as BodyInit }, opts)
  if (typeof body !== 'string') throw new Error('ファイルを付けた書き込みは、この送り方では送れません')
  const res = await invoke<{ status: number; headers: Record<string, string>; body: number[] }>('http_post', {
    url,
    body,
    headers: { 'User-Agent': USER_AGENT, ...opts?.headers },
    excludeCookies: opts?.excludeCookies ?? [],
  })
  return { status: res.status, headers: res.headers, body: new Uint8Array(res.body) }
}

/**
 * 同じ URL を同時に、またはすぐ続けて取りに行かないよう、条件なしの GET の結果を少しのあいだ使い回す。
 * 板があるかの確かめ → 板を開く、のように、すぐ続けて同じスレ一覧や板の設定を取ることがあるため。
 * Range や If-Modified-Since を付けた GET(差分の取得)は使い回さない
 */
const REUSE_MS = 3000
const recent = new Map<string, { at: number; res: Promise<HttpResponse> }>()
/** 読む通信は https から試し、取れなければ http に戻す */
const getHttpsFirst = (url: string, opts?: HttpRequestOptions) => fetchHttpsFirst(url, (u) => request(u, { method: 'GET' }, opts), (res) => res.status < 400)

function get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
  if (opts?.headers && Object.keys(opts.headers).length > 0) return getHttpsFirst(url, opts)
  const now = Date.now()
  // たどらない取り方は結果が違うので、別に覚える
  const key = opts?.noRedirect ? `noRedirect ${url}` : url
  const hit = recent.get(key)
  if (hit && now - hit.at < REUSE_MS) return hit.res
  const res = getHttpsFirst(url, opts)
  recent.set(key, { at: now, res })
  // 失敗したものは使い回さない
  res.catch(() => recent.delete(key))
  // 古いものを捨てる
  for (const [k, v] of recent) if (now - v.at >= REUSE_MS) recent.delete(k)
  return res
}

export const tauriContext: ConnectorContext = {
  decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
  http: {
    get,
    post,
  },
}
