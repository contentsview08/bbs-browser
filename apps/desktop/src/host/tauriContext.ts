// コネクタに渡す ConnectorContext の Tauri 版。
// 通信は plugin-http(Rust 側の reqwest)を通すので、CORS に縛られず User-Agent も設定できる。

import { fetch } from '@tauri-apps/plugin-http'
import type { ConnectorContext } from '@bbs-browser/connectors'

// 2ch 互換の板は専ブラに Monazilla の UA を求める慣習がある
const USER_AGENT = 'Monazilla/1.00 (bbs-browser/0.1.0)'

export const tauriContext: ConnectorContext = {
  decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
  http: {
    async get(url, opts) {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...opts?.headers } })
      const headers: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) }
    },
  },
}
