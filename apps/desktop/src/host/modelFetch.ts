// 判定モデルのファイルを取る(workers/aiNgWorker.ts の頼みで)。アプリの通信はすべて plugin-http(Rust の側)を通す
import { fetch } from '@tauri-apps/plugin-http'

export async function fetchModelFile(url: string): Promise<{ ok: boolean; status: number; headers: [string, string][]; body: ArrayBuffer }> {
  const res = await fetch(url, { method: 'GET' })
  const body = await res.arrayBuffer()
  return { ok: res.ok, status: res.status, headers: [...res.headers.entries()], body }
}
