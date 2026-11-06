import { describe, expect, it } from 'vitest'
import { fetchCheckingRedirects, isAutoLoadable, isRedirectStatus } from '../src/utils/safeUrl'

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

describe('isAutoLoadable: 境目と書き方の違い', () => {
  it.each([
    // 家の中の範囲のすぐ外は、ふつうのサイト
    'https://9.255.255.255/a.jpg',
    'https://11.0.0.1/a.jpg',
    'https://172.15.0.1/a.jpg',
    'https://172.32.0.1/a.jpg',
    'https://192.167.0.1/a.jpg',
    'https://192.169.0.1/a.jpg',
    'https://100.63.0.1/a.jpg',
    'https://100.128.0.1/a.jpg',
    'https://169.253.0.1/a.jpg',
    'https://223.255.255.255/a.jpg',
    // 標準のポートを書いただけなら、書いていないのと同じ
    'https://example.com:443/a.jpg',
    'http://example.com:80/a.jpg',
    // 名前に local などを含むだけのサイト
    'https://local.example.com/a.jpg',
    'https://localhost.example.com/a.jpg',
    'https://example.local.com/a.jpg',
    // パスや問い合わせに書いてあるだけ
    'https://example.com/http://127.0.0.1/',
    'https://example.com/?u=192.168.0.1',
  ])('読む: %s', (url) => {
    expect(isAutoLoadable(url)).toBe(true)
  })

  it.each([
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.0.0/',
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    // 大文字や省略した書き方でも、同じアドレスとして見る
    'http://LOCALHOST/',
    'http://LocalHost./',
    'http://127.1/',
    'http://0177.0.0.1/',
    'http://0x7f.0.0.1/',
    'http://１２７.０.０.１/',
    // ユーザー名の後ろが本当の行き先
    'http://example.com@127.0.0.1/',
    'http://example.com:pw@192.168.0.1/',
    // IPv6(IPv4 を埋め込んだ形も)
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[2606:4700:4700::1111]/',
    // 家の中の名前
    'http://foo.localhost/',
    'http://printer.lan/',
    'http://a.home.arpa/',
    'http://a.INTERNAL/',
    // 標準以外のポート
    'https://example.com:80/',
    'http://example.com:443/',
    // http・https 以外と、URL でないもの
    'ftp://example.com/a.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'blob:https://example.com/x',
    '',
    'example.com/a.jpg',
    '/a.jpg',
  ])('読まない: %s', (url) => {
    expect(isAutoLoadable(url)).toBe(false)
  })
})

describe('fetchCheckingRedirects: 行き先のないリダイレクト', () => {
  it('location のないリダイレクトは null', async () => {
    expect(await fetchCheckingRedirects('https://example.com/', async () => new Response(null, { status: 302 }))).toBeNull()
  })

  it('読めない行き先は null', async () => {
    const send = async () => new Response(null, { status: 302, headers: { location: 'http://[bad/' } })
    expect(await fetchCheckingRedirects('https://example.com/', send)).toBeNull()
  })

  it('リダイレクトでなければ、失敗の応答もそのまま返す', async () => {
    expect((await fetchCheckingRedirects('https://example.com/', async () => new Response(null, { status: 404 })))?.status).toBe(404)
  })

  it.each([301, 302, 303, 307, 308])('%i はリダイレクト', (status) => {
    expect(isRedirectStatus(status)).toBe(true)
  })

  it.each([200, 204, 304, 404])('%i はリダイレクトではない', (status) => {
    expect(isRedirectStatus(status)).toBe(false)
  })
})
