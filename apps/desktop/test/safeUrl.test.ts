import { describe, expect, it } from 'vitest'
import { isAutoLoadable } from '../src/utils/safeUrl'

describe('isAutoLoadable: 押さずに読みに行ってよい URL か', () => {
  it.each([
    'https://i.imgur.com/abc.jpg',
    'http://example.com/a.png',
    'https://video.twimg.com/x/y.mp4',
    'https://8.8.8.8/a.jpg',
  ])('ふつうのサイトは読む: %s', (url) => {
    expect(isAutoLoadable(url)).toBe(true)
  })

  it.each([
    'http://192.168.1.1/cgi-bin/reboot?.jpg',
    'http://10.0.0.1/a.png',
    'http://172.20.3.4/a.png',
    'http://127.0.0.1/a.jpg',
    'http://localhost/a.jpg',
    'http://[::1]/a.jpg',
    'http://169.254.169.254/latest/meta-data.jpg',
    'http://router/a.jpg',
    'http://nas.local/a.jpg',
    'http://example.com:8080/a.jpg',
    'http://0x7f.1/a.jpg',
    'http://2130706433/a.jpg',
    'file:///C:/a.jpg',
  ])('家の中・自分の PC・変わった書き方は読まない: %s', (url) => {
    expect(isAutoLoadable(url)).toBe(false)
  })
})
