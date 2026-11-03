// 上げた画像の「同じ画像ならもう一度上げない」ための引き当て。
// App が DB(アップロード履歴の hash 列)を結び付け、useMediaInput が上げる前に引く(部品に DB を渡して回さなくて済むように、ここに置く)

let lookup: ((hash: string) => Promise<string | undefined>) | undefined

/** App が DB を開いたら結び付ける(閉じたら undefined) */
export function setUploadLookup(fn: typeof lookup) {
  lookup = fn
}

/** 同じ中身の画像を前に上げていれば、その URL */
export async function lookupUploaded(hash: string): Promise<string | undefined> {
  try {
    return await lookup?.(hash)
  } catch {
    return undefined
  }
}

/** ファイルの中身の SHA-256(16 進)。読めなければ undefined */
export async function hashFile(file: File): Promise<string | undefined> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}
