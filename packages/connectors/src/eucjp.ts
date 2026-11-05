// 書き込みフォームを EUC-JP で URL エンコードする(したらば)。
// sjis.ts と同じく、TextDecoder('euc-jp') で 2 バイト文字を総当たりして逆引き表を作る
// (デコーダーと同じ表を使うので、読み書きで文字の対応がずれない)。補助漢字(3 バイト)は使わない

let table: Map<string, number[]> | undefined

function reverseTable(): Map<string, number[]> {
  if (table) return table
  const dec = new TextDecoder('euc-jp', { fatal: true })
  const map = new Map<string, number[]>()
  const add = (bytes: number[]) => {
    try {
      const ch = dec.decode(new Uint8Array(bytes))
      if (ch.length > 0 && !map.has(ch)) map.set(ch, bytes)
    } catch {
      // 割り当てのない符号
    }
  }
  for (let b = 0xa1; b <= 0xdf; b++) add([0x8e, b]) // 半角カナ
  for (let lead = 0xa1; lead <= 0xfe; lead++) for (let trail = 0xa1; trail <= 0xfe; trail++) add([lead, trail])
  table = map
  return map
}

/** 1 文字を EUC-JP のバイト列にする。表にない文字は &#数字; にする */
function encodeChar(ch: string): number[] {
  const code = ch.codePointAt(0)!
  if (code < 0x80) return [code]
  const bytes = reverseTable().get(ch)
  if (bytes) return bytes
  return [...`&#${code};`].map((c) => c.charCodeAt(0))
}

const UNRESERVED = /[A-Za-z0-9*\-._]/

export function encodeEucJpComponent(value: string): string {
  let out = ''
  for (const ch of value) {
    for (const b of encodeChar(ch)) {
      if (b === 0x20) out += '+'
      else if (b < 0x80 && UNRESERVED.test(String.fromCharCode(b))) out += String.fromCharCode(b)
      else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

/** フォームの本文。改行はブラウザと同じく CR LF で送る(バイト数の数え方とも同じ) */
export function encodeEucJpForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeEucJpComponent(k)}=${encodeEucJpComponent(v.replace(/\r?\n/g, '\r\n'))}`)
    .join('&')
}

/** EUC-JP で送ったときのバイト数(目安)。改行は CR LF の 2 バイトで数える */
export function eucJpByteLength(text: string): number {
  let n = 0
  for (const ch of text) n += ch === '\n' ? 2 : encodeChar(ch).length
  return n
}
