// gzip で届いた本文を解く。過去ログ倉庫の dat.gz のため。
// DecompressionStream は WebView2 と Node(試験)の両方にあるので、これを使う。

/** gzip の頭(1f 8b)で始まるか。Content-Encoding で既に解かれて届いたものは、頭がふつうの文字になる */
export const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b

/** 解いた後の上限。dat は大きくても数 MB なので、これを超えるものは掲示板の中身ではない(解凍爆弾も止める) */
export const GUNZIP_MAX_BYTES = 32 * 1024 * 1024

/** gzip を解く。壊れている・上限を超えるときは undefined */
export async function gunzip(data: Uint8Array, max = GUNZIP_MAX_BYTES): Promise<Uint8Array | undefined> {
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data)
      c.close()
    },
  })
  // 型の定義(DOM・Workers)で DecompressionStream の入り口の型が違うので、Uint8Array どうしの変換として扱う
  const reader = input.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > max) {
        void reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(value)
    }
  } catch {
    return undefined
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
