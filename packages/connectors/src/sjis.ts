// 書き込みフォームを Shift_JIS で URL エンコードする。
// TextEncoder は UTF-8 しか作れないので、TextDecoder('shift_jis') で 2 バイト文字を総当たりして逆引き表を作る
// (デコーダーと同じ表を使うので、読み書きで文字の対応がずれない)。

let table: Map<string, number[]> | undefined

function reverseTable(): Map<string, number[]> {
  if (table) return table
  const dec = new TextDecoder('shift_jis', { fatal: true })
  const map = new Map<string, number[]>()
  const add = (bytes: number[]) => {
    try {
      const ch = dec.decode(new Uint8Array(bytes))
      // 同じ文字に複数の符号がある(NEC 選定 IBM 拡張など)ときは、先に見つかった方を使う
      if (ch.length > 0 && !map.has(ch)) map.set(ch, bytes)
    } catch {
      // 割り当てのない符号
    }
  }
  for (let b = 0xa1; b <= 0xdf; b++) add([b]) // 半角カナ
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail !== 0x7f) add([lead, trail])
    }
  }
  table = map
  return map
}

/** 1 文字を Shift_JIS のバイト列にする。表にない文字は &#数字; にする */
function encodeChar(ch: string): number[] {
  const code = ch.codePointAt(0)!
  if (code < 0x80) return [code]
  const bytes = reverseTable().get(ch)
  if (bytes) return bytes
  return [...`&#${code};`].map((c) => c.charCodeAt(0))
}

/**
 * Shift_JIS で送ったときのバイト数(書き込む前に長すぎないか確かめる目安)。
 * 表にない文字(絵文字など)は &#数字; の長さで、改行はブラウザと同じく CR LF の 2 バイトで数える
 */
export function shiftJisByteLength(text: string): number {
  let n = 0
  for (const ch of text) n += ch === '\n' ? 2 : encodeChar(ch).length
  return n
}

const UNRESERVED = /[A-Za-z0-9*\-._]/

/** application/x-www-form-urlencoded の 1 つの値(Shift_JIS)。空白は + にする */
export function encodeShiftJisComponent(value: string): string {
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

export function encodeShiftJisForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeShiftJisComponent(k)}=${encodeShiftJisComponent(v)}`)
    .join('&')
}
