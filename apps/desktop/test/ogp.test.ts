import { describe, expect, it } from 'vitest'
import { parseOgp } from '../src/utils/ogp'

describe('parseOgp', () => {
  it.each(['&#99999999;', '&#x110000;', '&#99999999999999999999;'])('範囲外の数値文字参照 %s でも例外にせず、ほかの情報を読む', (ref) => {
    const html = `<meta property="og:title" content="題 ${ref}"><meta property="og:description" content="説明">`
    const o = parseOgp(html, 'https://example.com/')
    expect(o.title).toBe('題 \ufffd')
    expect(o.description).toBe('説明')
  })

  it('ふつうの数値文字参照は文字に戻す', () => {
    expect(parseOgp('<meta property="og:title" content="&#x3042;&#12356;">', 'https://example.com/').title).toBe('あい')
  })
})
