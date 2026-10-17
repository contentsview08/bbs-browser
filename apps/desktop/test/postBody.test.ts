import { describe, expect, it } from 'vitest'
import { anchorTargets, anchorTree, anchorsIn, countAnchors, hasVideo, makeAnchorResolver, quoteLinksOf, quotedText, imageUrlsIn, linkUrlsIn, videoFileUrlsIn, youtubeEmbedUrl } from '../src/utils/postBody'

describe('videoFileUrlsIn: 動画のファイル', () => {
  it('mp4・webm・mov を拾い、リンクのカードには回さない', () => {
    const body = 'これ https://example.com/a.mp4 と https://example.com/b.webm?x=1 と https://example.com/page'
    expect(videoFileUrlsIn(body)).toEqual(['https://example.com/a.mp4', 'https://example.com/b.webm?x=1'])
    expect(linkUrlsIn(body)).toEqual(['https://example.com/page'])
    expect(hasVideo(body)).toBe(true)
    expect(hasVideo('https://example.com/a.jpg')).toBe(false)
  })
})

describe('youtubeEmbedUrl', () => {
  it('ふつうの URL・短い URL・ショート・始める位置', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1&rel=0')
    expect(youtubeEmbedUrl('https://youtu.be/abcDEF12345?t=90')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1&rel=0&start=90')
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=abcDEF12345&t=1m30s')).toContain('&start=90')
    expect(youtubeEmbedUrl('https://www.youtube.com/shorts/abcDEF12345')).toContain('/embed/abcDEF12345')
    expect(youtubeEmbedUrl('https://example.com/watch?v=abcDEF12345')).toBeUndefined()
  })
})

describe('imageUrlsIn: 画像', () => {
  it('URL の直後の見えない文字(U+2060 など)は URL に含めない', () => {
    const body = 'https://i.imgur.com/LMIhKea.jpg⁠\nhttps://example.com/b.png​続き'
    expect(imageUrlsIn(body)).toEqual(['https://i.imgur.com/LMIhKea.jpg', 'https://example.com/b.png'])
  })
})

describe('anchorsIn: アンカー', () => {
  it('並び・範囲・> 1 つの書き方を拾う', () => {
    expect(anchorsIn('>>98,100')).toEqual([98, 100])
    expect(anchorsIn('>>98-100')).toEqual([98, 99, 100])
    expect(anchorsIn('>>98-100,105')).toEqual([98, 99, 100, 105])
    expect(anchorsIn('>1,2,3,4,5')).toEqual([1, 2, 3, 4, 5])
    expect(anchorsIn('＞＞7，8')).toEqual([7, 8])
  })
  it('式や URL の中の > は拾わない', () => {
    expect(anchorsIn('2>1 なので')).toEqual([])
    expect(anchorsIn('a=>3')).toEqual([])
    expect(anchorsIn('>>5、10年前')).toEqual([5])
  })
})

describe('アンカーの読み替え(AnchorResolver)', () => {
  const post = (no: number, body: string, ref?: number) => ({ no, name: '', mail: '', date: '', body, ...(ref !== undefined && { ref }) })
  it('2ch: 番号がそのまま。6 桁以上はアンカーにしない', () => {
    expect(anchorTargets('>>12 >>123456')).toEqual([12])
  })
  it('4chan など: 板の本当の番号(ref)から、スレの中の番号(no)に読み替える', () => {
    const posts = [post(1, 'OP', 98765400), post(2, '>>98765400 そうだね', 98765411), post(3, '>>98765411 >>11111111', 98765422)]
    const resolve = makeAnchorResolver(posts, 'ref')
    expect(anchorTargets(posts[2].body, resolve)).toEqual([2])
    expect(countAnchors(posts, resolve).get(1)).toBe(1)
    expect(anchorTree(1, posts, resolve)).toEqual([1, 2, 3])
  })
  it('ref を使わない掲示板では、ref があっても番号のまま', () => {
    expect(makeAnchorResolver([post(1, '', 555)], 'no')(3)).toBe(3)
  })
})

describe('文章の引用(ふたば)', () => {
  const post = (no: number, body: string) => ({ no, name: '', mail: '', date: '', body })
  it('引用の行と、アンカーだけの行を見分ける', () => {
    expect(quotedText('>コズミックイラって何？')).toBe('コズミックイラって何？')
    expect(quotedText('>>宇宙世紀も')).toBe('>宇宙世紀も')
    expect(quotedText('>1003')).toBeUndefined()
    expect(quotedText('ふつうの行')).toBeUndefined()
  })
  it('引用した文を書いた本人のレスにつなぐ(同じ文を引用しただけのレスにはつながない)', () => {
    const posts = [
      post(1, 'https://may.2chan.net/b/src/111.jpg\nスレの本文'),
      post(2, 'コズミックイラって何？'),
      post(3, '>コズミックイラって何？\n年号'),
      post(4, '>コズミックイラって何？\nアンテナ低いね'),
      post(5, '>>コズミックイラって何？\nそこ引用する？'),
      post(6, '>111.jpg\nこの画像いいね'),
    ]
    const links = quoteLinksOf(posts)
    expect(links.get(3)?.get('>コズミックイラって何？')).toBe(2)
    expect(links.get(4)?.get('>コズミックイラって何？')).toBe(2)
    // 引用の引用は、その引用の行があるレス
    expect(links.get(5)?.get('>>コズミックイラって何？')).toBe(4)
    // 画像のファイル名の引用は、その画像を貼ったレス
    expect(links.get(6)?.get('>111.jpg')).toBe(1)
    expect(countAnchors(posts, undefined, links).get(2)).toBe(2)
    expect(anchorTree(2, posts, undefined, links)).toEqual([2, 3, 4, 5])
  })
})
