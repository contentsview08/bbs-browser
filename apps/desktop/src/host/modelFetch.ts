// 判定モデルのファイルを取る(workers/aiNgWorker.ts の頼みで)。アプリの通信はすべて plugin-http(Rust の側)を通す
import { fetch } from '@tauri-apps/plugin-http'

export async function fetchModelFile(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; headers: [string, string][]; body: ArrayBuffer }> {
  const res = await fetch(url, { method: 'GET', signal })
  // 少しずつ読み、取れた量を知らせる(モデルは 339MB あるので、取っている間の進み具合を出す)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body?.getReader()
  if (!reader) return { ok: res.ok, status: res.status, headers: [...res.headers.entries()], body: await res.arrayBuffer() }
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (signal?.aborted) {
      void reader.cancel().catch(() => {})
      throw new Error('取るのをやめました')
    }
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.(loaded, total)
  }
  const body = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    body.set(c, at)
    at += c.byteLength
  }
  return { ok: res.ok, status: res.status, headers: [...res.headers.entries()], body: body.buffer }
}
