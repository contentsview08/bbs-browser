// dat や subject.txt に混ざる HTML を、表示用のプレーンテキストに直す。
// UI 側で innerHTML を使わずに済むよう、コネクタの段階でテキストにしてしまう。

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hearts: '♥',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return NAMED[code] ?? m
  })
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\s*<br\s*\/?>\s?/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  ).replace(/^ | $/g, '') // dat の本文は前後に空白が 1 つずつ入っている
}
