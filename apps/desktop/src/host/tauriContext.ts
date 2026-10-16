// コネクタに渡す ConnectorContext の Tauri 版。
// 通信は plugin-http(Rust 側の reqwest)を通すので、CORS に縛られず User-Agent も設定できる。
// 読む通信(GET)は plugin-http で、書き込み(POST)は自前の通信で送る(下の post)。

import { fetch } from '@tauri-apps/plugin-http'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectorContext, HttpRequestOptions, HttpResponse } from '@bbs-browser/connectors'

// 2ch 互換の板は専ブラに Monazilla の UA を求める慣習がある
const USER_AGENT = 'Monazilla/1.00 (bbs-browser/0.1.0)'

async function request(url: string, init: RequestInit, opts?: HttpRequestOptions): Promise<HttpResponse> {
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
async function post(url: string, body: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
  const res = await invoke<{ status: number; headers: Record<string, string>; body: number[] }>('http_post', {
    url,
    body,
    headers: { 'User-Agent': USER_AGENT, ...opts?.headers },
    excludeCookies: opts?.excludeCookies ?? [],
  })
  return { status: res.status, headers: res.headers, body: new Uint8Array(res.body) }
}

export const tauriContext: ConnectorContext = {
  decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
  http: {
    get: (url, opts) => request(url, { method: 'GET' }, opts),
    post,
  },
}
