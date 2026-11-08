import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const ok = () => new Response('body', { status: 200 })

describe('読む通信', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ok())
  })

  it('https の URL はそのまま取る', async () => {
    const { tauriContext } = await import('../src/host/tauriContext')
    const res = await tauriContext.http.get('https://egg.5ch.io/software/subject.txt')
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://egg.5ch.io/software/subject.txt'])
  })

  it('http の URL は https から試す', async () => {
    const { tauriContext } = await import('../src/host/tauriContext')
    await tauriContext.http.get('http://kenmo.org/poverty/subject.txt')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://kenmo.org/poverty/subject.txt'])
  })
})

describe('読む通信のリダイレクトと大きさ', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } })

  it('リダイレクトは 1 段ずつたどる。家の中のアドレスへ向けられたら、そこへは通信しない', async () => {
    const { tauriContext } = await import('../src/host/tauriContext')
    fetchMock.mockImplementation(async (u: string) => (u.endsWith('/a') ? redirect('https://example.com/b') : u.endsWith('/b') ? ok() : redirect('http://192.168.0.1/admin')))
    expect((await tauriContext.http.get('https://example.com/a')).status).toBe(200)
    expect(fetchMock.mock.calls.every((c) => c[1].maxRedirections === 0)).toBe(true)
    fetchMock.mockClear()
    await expect(tauriContext.http.get('https://example.com/c')).rejects.toThrow('家の中')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://example.com/c'])
  })

  it('noRedirect なら 3xx をそのまま返す', async () => {
    const { tauriContext } = await import('../src/host/tauriContext')
    fetchMock.mockImplementation(async () => redirect('https://example.com/dead.html'))
    const res = await tauriContext.http.get('https://example.com/test/dat/1.dat', { noRedirect: true })
    expect(res.status).toBe(302)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('上限を超える応答は読まずに断る', async () => {
    const { tauriContext, READ_MAX_BYTES } = await import('../src/host/tauriContext')
    fetchMock.mockImplementation(async () => new Response('x', { status: 200, headers: { 'content-length': String(READ_MAX_BYTES + 1) } }))
    await expect(tauriContext.http.get('https://example.com/huge1')).rejects.toThrow('大きすぎ')
    // 長さを書かずに送ってくるものは、読みながら数えて切る
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(READ_MAX_BYTES + 1), { status: 200 }))
    await expect(tauriContext.http.get('https://example.com/huge2')).rejects.toThrow('大きすぎ')
  })
})
