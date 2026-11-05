import { describe, expect, it } from 'vitest'
import { fetchHttpsFirst, mediaSrc, toHttps } from '../src/utils/httpsFirst'

describe('https を先に試す', () => {
  it('http の URL だけ https にする', () => {
    expect(toHttps('http://a.test/x.png?y=1')).toBe('https://a.test/x.png?y=1')
    expect(toHttps('https://a.test/x.png')).toBeUndefined()
    expect(mediaSrc('https://a.test/x.png')).toBe('https://a.test/x.png')
    expect(mediaSrc('http://b.test/x.png')).toBe('https://b.test/x.png')
  })

  it('https で取れれば http へ行かない', async () => {
    const sent: string[] = []
    const r = await fetchHttpsFirst('http://c.test/', async (u) => (sent.push(u), 200), (s) => s < 400)
    expect(r).toBe(200)
    expect(sent).toEqual(['https://c.test/'])
  })

  it('https が失敗の返事なら http で取り直す。ホストは覚えない', async () => {
    const sent: string[] = []
    const send = async (u: string) => (sent.push(u), u.startsWith('https') ? 404 : 200)
    expect(await fetchHttpsFirst('http://d.test/', send, (s) => s < 400)).toBe(200)
    expect(sent).toEqual(['https://d.test/', 'http://d.test/'])
    expect(toHttps('http://d.test/')).toBe('https://d.test/')
  })

  it('https でつながらなければ http に戻し、次から直接 http へ行く', async () => {
    const sent: string[] = []
    const send = async (u: string) => {
      sent.push(u)
      if (u.startsWith('https')) throw new Error('つながらない')
      return 200
    }
    expect(await fetchHttpsFirst('http://e.test/', send, () => true)).toBe(200)
    await fetchHttpsFirst('http://e.test/2', send, () => true)
    expect(sent).toEqual(['https://e.test/', 'http://e.test/', 'http://e.test/2'])
  })

  it('https と書いてある URL は http に戻さない', async () => {
    const sent: string[] = []
    await expect(
      fetchHttpsFirst('https://f.test/', async (u) => {
        sent.push(u)
        throw new Error('つながらない')
      }, () => true),
    ).rejects.toThrow()
    expect(sent).toEqual(['https://f.test/'])
  })
})
