// 応答の本文を、決めた大きさまでだけ読む。相手のサーバーが巨大な応答を返しても、メモリに全部読まないように

export class ResponseTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`応答が大きすぎます(${Math.floor(limit / 1024 / 1024)}MB まで)`)
    this.name = 'ResponseTooLarge'
  }
}

/** Content-Length が上限を超えていれば読まずに断る。書いていなければ読みながら数え、超えたところで切る */
export async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) {
    void res.body?.cancel().catch(() => undefined)
    throw new ResponseTooLarge(limit)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer())
    if (all.length > limit) throw new ResponseTooLarge(limit)
    return all
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.length
    if (size > limit) {
      void reader.cancel().catch(() => undefined)
      throw new ResponseTooLarge(limit)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
