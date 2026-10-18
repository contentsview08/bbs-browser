import { describe, expect, it } from 'vitest'
import { allConnectors, demoConnector, findConnector, registerConnector, twoChConnector, unregisterConnector } from '../src'

const ctx = {
  http: {
    get: async () => {
      throw new Error('お試しの掲示板は通信しない')
    },
    post: async () => {
      throw new Error('お試しの掲示板は通信しない')
    },
  },
  decode: () => '',
}

describe('お試しの掲示板と、コネクタを足す仕組み', () => {
  it('足したコネクタは、2ch 互換より先に URL を受け持つ', () => {
    registerConnector(demoConnector)
    const url = 'https://demo.bbs-browser.invalid/board/'
    expect(allConnectors().find((c) => c.canHandle(url))?.id).toBe('demo')
    expect(allConnectors().at(-1)).toBe(twoChConnector)
    expect(findConnector('demo')).toBe(demoConnector)
    unregisterConnector('demo')
    expect(findConnector('demo')).toBeUndefined()
  })

  it('スレの印・レスの印・反応の数を返し、反応を押すと数が増える', async () => {
    const [pinned] = await demoConnector.listThreads({ connectorId: 'demo', url: 'https://demo.bbs-browser.invalid/board/', name: '' }, ctx)
    expect(pinned.badges?.[0].label).toBe('固定')
    const r = await demoConnector.fetchPosts(pinned, null, ctx)
    expect(r.posts[0].badges?.[0].label).toBe('管理人')
    expect(r.reactions?.['1'].like).toBe(12)
    expect(await demoConnector.react!(pinned, r.posts[0], 'like', ctx)).toBe(13)
    expect((await demoConnector.fetchPosts(pinned, r.cursor, ctx)).status).toBe('notModified')
  })

  it('レスへの操作は、確かめる文を持ち、結果の文を返す', async () => {
    expect(demoConnector.postActions?.find((a) => a.id === 'report')?.confirm).toBeTruthy()
    const [t] = await demoConnector.listThreads({ connectorId: 'demo', url: '', name: '' }, ctx)
    const r = await demoConnector.runPostAction!(t, { no: 2, name: '', mail: '', date: '', body: '' }, 'report', ctx)
    expect(r.status).toBe('ok')
  })
})
