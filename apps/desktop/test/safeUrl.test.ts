import { describe, expect, it } from 'vitest'
import { fetchCheckingRedirects, isAutoLoadable } from '../src/utils/safeUrl'

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
    'http://localhost./a.jpg',
    'http://localhost../a.jpg',
    'http://router.local./a.jpg',
    'http://router./a.jpg',
  ])('家の中・自分の PC・変わった書き方は読まない: %s', (url) => {
    expect(isAutoLoadable(url)).toBe(false)
  })
})

describe('fetchCheckingRedirects: リダイレクトの行き先も確かめる', () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  it('家の中へのリダイレクトは、そこへ通信せずに null', async () => {
    const sent: string[] = []
    const res = await fetchCheckingRedirects('https://example.com/a', async (u) => {
      sent.push(u)
      return redirect('http://192.168.0.1/')
    })
    expect(res).toBeNull()
    expect(sent).toEqual(['https://example.com/a'])
  })

  it('ふつうのサイトへのリダイレクトは、相対の行き先もたどる', async () => {
    const sent: string[] = []
    const res = await fetchCheckingRedirects('https://example.com/a', async (u) => {
      sent.push(u)
      return u.endsWith('/b') ? new Response('ok') : redirect('/b')
    })
    expect(res?.status).toBe(200)
    expect(sent).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('たどりすぎは null', async () => {
    let n = 0
    const res = await fetchCheckingRedirects('https://example.com/0', async () => redirect(`/${++n}`))
    expect(res).toBeNull()
    expect(n).toBe(6)
  })
})
