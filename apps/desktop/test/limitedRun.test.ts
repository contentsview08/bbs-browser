import { describe, expect, it } from 'vitest'
import { hostKey, runLimited, SAVE_LIMITS } from '../src/utils/limitedRun'

/** 動いている数を数えながら、少し待つ仕事 */
function tracker() {
  const now = new Map<string, number>()
  let total = 0
  const peak = { total: 0, host: 0 }
  const done: string[] = []
  const work = async (url: string) => {
    const host = hostKey(url)
    now.set(host, (now.get(host) ?? 0) + 1)
    total++
    peak.total = Math.max(peak.total, total)
    peak.host = Math.max(peak.host, now.get(host)!)
    await new Promise((r) => setTimeout(r, 1))
    now.set(host, now.get(host)! - 1)
    total--
    done.push(url)
  }
  return { peak, done, work }
}

describe('同時に動かす数', () => {
  const urls = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e'].map((h, i) => `https://${h}.test/${i}.png`)

  it('全体 3・同じホスト 1 を超えず、全部終える', async () => {
    const t = tracker()
    await runLimited(urls, { limits: SAVE_LIMITS, keyOf: hostKey, work: t.work })
    expect(t.peak.total).toBeLessThanOrEqual(3)
    expect(t.peak.host).toBe(1)
    expect(t.peak.total).toBeGreaterThan(1)
    expect(t.done).toHaveLength(urls.length)
  })

  it('混んでいるホストの後ろのほかのホストを先に始める', async () => {
    const order: string[] = []
    await runLimited(['https://a.test/1', 'https://a.test/2', 'https://b.test/3'], {
      limits: { total: 2, perHost: 1 },
      keyOf: hostKey,
      work: async (u) => {
        order.push(u)
      },
    })
    expect(order.slice(0, 2)).toEqual(['https://a.test/1', 'https://b.test/3'])
  })

  it('止めたら新しく始めない', async () => {
    const stop = new AbortController()
    const started: string[] = []
    await runLimited(urls, {
      limits: { total: 1, perHost: 1 },
      keyOf: hostKey,
      signal: stop.signal,
      work: async (u) => {
        started.push(u)
        stop.abort()
      },
    })
    expect(started).toHaveLength(1)
  })

  it('失敗しても止まらない', async () => {
    const done: string[] = []
    await runLimited(['https://a.test/1', 'https://a.test/2'], {
      limits: SAVE_LIMITS,
      keyOf: hostKey,
      work: async (u) => {
        done.push(u)
        throw new Error('失敗')
      },
    })
    expect(done).toHaveLength(2)
  })

  it('空なら何もしない', async () => {
    await expect(runLimited([], { limits: SAVE_LIMITS, keyOf: hostKey, work: async () => undefined })).resolves.toBeUndefined()
  })
})
