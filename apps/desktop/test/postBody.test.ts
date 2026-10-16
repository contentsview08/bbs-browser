import { describe, expect, it } from 'vitest'
import { hasVideo, linkUrlsIn, splitBeIcon, videoFileUrlsIn, youtubeEmbedUrl } from '../src/utils/postBody'

describe('splitBeIcon: BE のアイコン', () => {
  it('1 行目の sssp:// を https:// の画像にし、その行を本文から除く', () => {
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif\n本文です')).toEqual({ icon: 'https://img.5ch.io/ico/nida.gif', body: '本文です' })
  })

  it('アイコンだけのレス', () => {
    expect(splitBeIcon('sssp://img.5ch.net/ico/u_giko_ebi.gif')).toEqual({ icon: 'https://img.5ch.net/ico/u_giko_ebi.gif', body: '' })
  })

  it('1 行目でなければ、本文のまま', () => {
    expect(splitBeIcon('本文\nsssp://img.5ch.io/ico/nida.gif')).toEqual({ body: '本文\nsssp://img.5ch.io/ico/nida.gif' })
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif ほかの文字')).toEqual({ body: 'sssp://img.5ch.io/ico/nida.gif ほかの文字' })
  })
})

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
