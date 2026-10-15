// コネクタに渡す ConnectorContext の Tauri 版。
// 通信は plugin-http(Rust 側の reqwest)を通すので、CORS に縛られず User-Agent も設定できる。
// Cookie も Rust 側の Cookie 置き場が持ち、アプリの終了時にファイルへ保存される(書き込みの認証が続くように)。

import { fetch } from '@tauri-apps/plugin-http'
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

export const tauriContext: ConnectorContext = {
  decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
  http: {
    get: (url, opts) => request(url, { method: 'GET' }, opts),
    post: (url, body, opts) => request(url, { method: 'POST', body }, opts),
  },
}
