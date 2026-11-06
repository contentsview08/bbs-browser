import { describe, expect, it } from 'vitest'
import { exportFileName, threadToHtml, threadToText } from '../src/utils/exportThread'

const src = {
  title: 'テスト<スレ>',
  url: 'https://x.5ch.io/test/read.cgi/a/1/',
  savedAt: new Date(2026, 9, 17, 12, 0),
  posts: [
    { no: 1, name: '名無し', mail: 'sage', date: '2026/10/17', id: 'abc', body: '本文 <b>\nhttps://example.com/a' },
    { no: 2, name: '名無し', mail: '', date: '2026/10/17', body: '二つ目' },
  ],
}

describe('スレの書き出し', () => {
  it('HTML のリンクは、URL の直後の記号を取り込まない', () => {
    const html = (body: string) => threadToHtml({ ...src, posts: [{ no: 1, name: 'n', mail: '', date: '', body }] })
    expect(html('<https://a.com>')).toContain('&lt;<a href="https://a.com">https://a.com</a>&gt;')
    expect(html('"https://a.com"')).toContain('&quot;<a href="https://a.com">https://a.com</a>&quot;')
    expect(html('https://a.com/?x=1&y=2')).toContain('<a href="https://a.com/?x=1&amp;y=2">')
  })

  it('テキストは見出しの行と本文を並べる', () => {
    const t = threadToText(src)
    expect(t).toContain('1 名無し [sage] 2026/10/17 ID:abc\n本文 <b>\nhttps://example.com/a\n')
    expect(t).toContain('2 名無し 2026/10/17\n二つ目')
  })

  it('HTML は文字を逃がし、URL だけリンクにする', () => {
    const h = threadToHtml(src)
    expect(h).toContain('<title>テスト&lt;スレ&gt;</title>')
    expect(h).toContain('本文 &lt;b&gt;')
    expect(h).toContain('<a href="https://example.com/a">https://example.com/a</a>')
    expect(h).not.toContain('<b>\n')
  })

  it('ファイル名に使えない文字を除く', () => {
    expect(exportFileName('a/b:c?', 'html')).toBe('a_b_c_.html')
  })
})
