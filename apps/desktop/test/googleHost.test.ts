import { describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))

const { googleAccessToken, googleDrive, GOOGLE_TOKEN_SLOT } = await import('../src/host/google')

describe('Google ドライブの置き場の PC の部品', () => {
  it('画面には本物のトークンを返さず、目印だけを渡す', async () => {
    invoke.mockResolvedValueOnce(undefined)
    expect(await googleAccessToken(true)).toBe(GOOGLE_TOKEN_SLOT)
    expect(invoke).toHaveBeenLastCalledWith('google_access_token', { fresh: true })
  })

  it('取り直しの失敗を、ログインし直し・オフライン・それ以外に分ける', async () => {
    invoke.mockRejectedValueOnce('google_auth_failed')
    await expect(googleAccessToken(false)).rejects.toMatchObject({ kind: 'http', status: 401, code: 'google_auth_failed' })
    invoke.mockRejectedValueOnce('network')
    await expect(googleAccessToken(false)).rejects.toMatchObject({ kind: 'network' })
    invoke.mockRejectedValueOnce('key_store_unavailable')
    await expect(googleAccessToken(false)).rejects.toMatchObject({ kind: 'http', status: 503 })
  })

  it('ログインの失敗はコードで返し、クライアントのないビルドでは理由を返す', async () => {
    invoke.mockRejectedValueOnce('google_login_timeout')
    await expect(googleDrive.login(null)).rejects.toMatchObject({ code: 'google_login_timeout' })
    expect(invoke).toHaveBeenLastCalledWith('google_login', { expect: null })
    invoke.mockResolvedValueOnce(false)
    expect(await googleDrive.unavailable()).toBe('google_unavailable')
    // 1 回だけ聞く
    expect(await googleDrive.unavailable()).toBe('google_unavailable')
    expect(invoke.mock.calls.filter((c) => c[0] === 'google_available')).toHaveLength(1)
  })
})
