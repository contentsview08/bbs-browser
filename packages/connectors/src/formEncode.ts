// 書き込みフォームの URL エンコード(application/x-www-form-urlencoded)。文字コードごとの違いは「1 文字 → バイト列」の関数だけ

export type CharBytes = (ch: string) => Iterable<number> & ArrayLike<number>

const UNRESERVED = /[A-Za-z0-9*\-._]/

/** 1 つの値。空白は + にする */
export function formComponent(value: string, bytesOf: CharBytes): string {
  let out = ''
  for (const ch of value) {
    for (const b of bytesOf(ch)) {
      if (b === 0x20) out += '+'
      else if (b < 0x80 && UNRESERVED.test(String.fromCharCode(b))) out += String.fromCharCode(b)
      else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

/** フォームの本文。改行はブラウザと同じく CR LF で送る(バイト数の数え方とも同じ) */
export function formBody(fields: Record<string, string>, bytesOf: CharBytes): string {
  return Object.entries(fields)
    .map(([k, v]) => `${formComponent(k, bytesOf)}=${formComponent(v.replace(/\r?\n/g, '\r\n'), bytesOf)}`)
    .join('&')
}

/** 送ったときのバイト数(書き込む前に長すぎないか確かめる目安)。改行は CR LF の 2 バイトで数える */
export function formByteLength(text: string, bytesOf: CharBytes): number {
  let n = 0
  for (const ch of text) n += ch === '\n' ? 2 : bytesOf(ch).length
  return n
}

/**
 * TextDecoder で符号を総当たりして作る逆引き表で符号化する関数(デコーダーと同じ表を使うので、読み書きで文字の対応がずれない)。
 * 同じ文字に複数の符号があるときは先に見つかった方を使う。表は最初に使うときに作る。表にない文字は &#数字; にする
 */
export function tableEncoder(label: string, eachCode: (add: (bytes: number[]) => void) => void): CharBytes {
  let table: Map<string, number[]> | undefined
  const build = () => {
    const dec = new TextDecoder(label, { fatal: true })
    const map = new Map<string, number[]>()
    eachCode((bytes) => {
      try {
        const ch = dec.decode(new Uint8Array(bytes))
        if (ch.length > 0 && !map.has(ch)) map.set(ch, bytes)
      } catch {
        // 割り当てのない符号
      }
    })
    return map
  }
  return (ch) => {
    const code = ch.codePointAt(0)!
    if (code < 0x80) return [code]
    const bytes = (table ??= build()).get(ch)
    if (bytes) return bytes
    return [...`&#${code};`].map((c) => c.charCodeAt(0))
  }
}
