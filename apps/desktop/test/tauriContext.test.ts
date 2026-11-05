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
