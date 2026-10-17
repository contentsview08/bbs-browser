// コネクタに渡す ConnectorContext の Tauri 版。
// 通信は plugin-http(Rust 側の reqwest)を通すので、CORS に縛られず User-Agent も設定できる。
// 読む通信(GET)は plugin-http で、書き込み(POST)は自前の通信で送る(下の post)。

import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectorContext, HttpRequestOptions, HttpResponse } from '@bbs-browser/connectors'

// 2ch 互換の板は専ブラに Monazilla の UA を求める慣習がある
const USER_AGENT = 'Monazilla/1.00 (bbs-browser/0.1.0)'

async function request(url: string, init: RequestInit, opts?: HttpRequestOptions): Promise<HttpResponse> {
  // ファイルを付けた multipart の本文(バイト列)も、そのまま送る
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...opts?.headers } })
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) }
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
function get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
  if (opts?.headers && Object.keys(opts.headers).length > 0) return request(url, { method: 'GET' }, opts)
  const now = Date.now()
  const hit = recent.get(url)
  if (hit && now - hit.at < REUSE_MS) return hit.res
  const res = request(url, { method: 'GET' }, opts)
  recent.set(url, { at: now, res })
  // 失敗したものは使い回さない
  res.catch(() => recent.delete(url))
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
