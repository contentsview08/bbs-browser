import { describe, expect, it } from 'vitest'
import { imageUrlsIn, isAppBoardUrl, isAppThreadUrl, isVideoFileUrl, toImageUrl } from '../src/utils/postBody'

describe('isAppThreadUrl: アプリで開けるスレの URL か', () => {
  it.each([
    'https://mi.5ch.io/test/read.cgi/news4vip/1792148654/',
    'https://mi.5ch.io/test/read.cgi/news4vip/1792148654/l50',
    'https://jbbs.shitaraba.net/bbs/read.cgi/computer/351/1600000000/',
  ])('スレ: %s', (url) => {
    expect(isAppThreadUrl(url)).toBe(true)
  })

  it.each(['https://mi.5ch.io/news4vip/', 'https://jbbs.shitaraba.net/computer/351/', 'https://example.com/a/b', 'https://youtu.be/abc', 'nanika'])(
    'スレではない: %s',
    (url) => {
      expect(isAppThreadUrl(url)).toBe(false)
    },
  )
})

describe('isAppBoardUrl: 板の URL かもしれない形か', () => {
  it.each(['https://mi.5ch.io/news4vip/', 'https://mi.5ch.io/news4vip/subject.txt', 'https://jbbs.shitaraba.net/computer/351/'])('板かもしれない: %s', (url) => {
    expect(isAppBoardUrl(url)).toBe(true)
  })

  it.each([
    // スレの URL は板ではない
    'https://mi.5ch.io/test/read.cgi/news4vip/1792148654/',
    // ファイルらしい URL
    'https://example.com/a.jpg',
    'https://mi.5ch.io/news4vip/index.html',
    // パスのない URL・URL でないもの
    'https://example.com/',
    'nanika',
  ])('板ではない: %s', (url) => {
    expect(isAppBoardUrl(url)).toBe(false)
  })
})

describe('toImageUrl: 画像として出す URL', () => {
  it('拡張子で分かるものは、そのまま(大文字・問い合わせ付きも)', () => {
    expect(toImageUrl('https://a.test/x.jpg')).toBe('https://a.test/x.jpg')
    expect(toImageUrl('https://a.test/x.PNG')).toBe('https://a.test/x.PNG')
    expect(toImageUrl('https://a.test/x.webp?w=100')).toBe('https://a.test/x.webp?w=100')
  })

  it('imgur の画像ページは、画像そのものの URL に読み替える', () => {
    expect(toImageUrl('https://imgur.com/abcd123')).toBe('https://i.imgur.com/abcd123.jpg')
    expect(toImageUrl('http://m.imgur.com/abcd123')).toBe('https://i.imgur.com/abcd123.jpg')
  })

  it('imgur のアルバムやほかのページは画像にしない', () => {
    expect(toImageUrl('https://imgur.com/a/abcd123')).toBeUndefined()
    expect(toImageUrl('https://imgur.com/gallery/abcd123')).toBeUndefined()
    expect(toImageUrl('https://notimgur.com/abcd123')).toBeUndefined()
  })

  it('X の画像は format で分かる', () => {
    const url = 'https://pbs.twimg.com/media/ABC?format=jpg&name=small'
    expect(toImageUrl(url)).toBeTruthy()
    expect(toImageUrl('https://pbs.twimg.com/media/ABC')).toBeUndefined()
  })

  it('画像でないものは undefined(パスの途中に .jpg があるだけのものも)', () => {
    expect(toImageUrl('https://a.test/x.html')).toBeUndefined()
    expect(toImageUrl('https://a.test/x.jpg/page')).toBeUndefined()
  })

  it('本文の崩した書き方も開ける形に直す', () => {
    expect(imageUrlsIn('ttp://a.test/x.jpg')).toEqual(['http://a.test/x.jpg'])
    expect(imageUrlsIn('ttps://a.test/x.jpg')).toEqual(['https://a.test/x.jpg'])
    expect(imageUrlsIn('https://a.test/x.jpg と https://a.test/y.html')).toEqual(['https://a.test/x.jpg'])
  })
})

describe('isVideoFileUrl: 動画のファイル', () => {
  it.each(['https://a.test/x.mp4', 'https://a.test/x.WEBM', 'https://a.test/x.mov?t=1', 'https://a.test/x.m4v#t=1'])('動画: %s', (url) => {
    expect(isVideoFileUrl(url)).toBe(true)
  })

  it.each(['https://a.test/x.mp4/page', 'https://a.test/x.mp3', 'https://a.test/mp4'])('動画ではない: %s', (url) => {
    expect(isVideoFileUrl(url)).toBe(false)
  })
})
