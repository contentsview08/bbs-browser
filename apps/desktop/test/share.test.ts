import { describe, expect, it } from 'vitest'
import { lineShareUrl, postWebUrl, shareItems, titleAndUrl, xShareUrl } from '../src/utils/share'

describe('共有の URL', () => {
  it('レスの番号を付ける', () => {
    expect(postWebUrl('https://eagle.5ch.net/test/read.cgi/livejupiter/1700000000/', 12)).toBe('https://eagle.5ch.net/test/read.cgi/livejupiter/1700000000/12')
    expect(postWebUrl('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/1700000000/', 3)).toBe('https://jbbs.shitaraba.net/bbs/read.cgi/game/123/1700000000/3')
    expect(postWebUrl('https://red-edge.net/boards/livejupter/6aefe762-1722-4b73-80f5-59db564142c7', 5)).toBe('https://red-edge.net/boards/livejupter/6aefe762-1722-4b73-80f5-59db564142c7/5')
  })

  it('番号で開けない掲示板はスレの URL のまま', () => {
    expect(postWebUrl('https://may.2chan.net/b/res/123.htm', 5)).toBe('https://may.2chan.net/b/res/123.htm')
    expect(postWebUrl('https://red-edge.net/boards/livejupter/', 5)).toBe('https://red-edge.net/boards/livejupter/')
  })

  it('外部の共有画面の URL は文字をエンコードする', () => {
    expect(xShareUrl('題 & 名', 'https://a.test/?x=1')).toBe('https://x.com/intent/post?text=%E9%A1%8C%20%26%20%E5%90%8D&url=https%3A%2F%2Fa.test%2F%3Fx%3D1')
    expect(lineShareUrl('題', 'https://a.test/')).toBe('https://social-plugins.line.me/lineit/share?url=https%3A%2F%2Fa.test%2F&text=%E9%A1%8C')
  })

  it('本文は含めず、スレタイと URL だけ', () => {
    expect(titleAndUrl('題', 'https://a.test/')).toBe('題\nhttps://a.test/')
    expect(titleAndUrl('', 'https://a.test/')).toBe('https://a.test/')
  })

  it('項目の並びと動き。投稿は共有画面を開くだけ', () => {
    const copied: string[] = []
    const opened: string[] = []
    const items = shareItems({ title: '題', url: 'https://a.test/', copy: (t) => copied.push(t), open: (u) => opened.push(u) })
    expect(items.map((i) => i.label)).toEqual(['リンクをコピー', 'スレタイとリンクをコピー', 'X に投稿', 'LINE で送る', 'ブラウザで開く'])
    items.forEach((i) => i.onClick())
    expect(copied).toEqual(['https://a.test/', '題\nhttps://a.test/'])
    expect(opened[0]).toContain('x.com/intent/post')
    expect(opened[1]).toContain('social-plugins.line.me')
    expect(opened[2]).toBe('https://a.test/')
  })
})
