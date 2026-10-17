import { describe, expect, it } from 'vitest'
import { hasVideo, imageUrlsIn, linkUrlsIn, videoFileUrlsIn, youtubeEmbedUrl } from '../src/utils/postBody'

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
