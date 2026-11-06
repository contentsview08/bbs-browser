import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/utils/thread'

describe('相対時刻(スマホ版の relativeTime と同じ言葉)', () => {
  const now = new Date(2026, 10, 6, 12, 0).getTime()
  const ago = (sec: number) => relativeTime(new Date(now - sec * 1000), now)
  it('区切りごとの言葉', () => {
    expect(ago(0)).toBe('たった今')
    expect(ago(59)).toBe('たった今')
    expect(ago(60)).toBe('1分前')
    expect(ago(3599)).toBe('59分前')
    expect(ago(3600)).toBe('1時間前')
    expect(ago(86399)).toBe('23時間前')
    expect(ago(86400)).toBe('1日前')
    expect(ago(86400 * 29)).toBe('29日前')
    expect(ago(86400 * 30)).toBe('約1か月前')
    expect(ago(86400 * 364)).toBe('約12か月前')
    expect(ago(86400 * 365)).toBe('約1年前')
  })
  it('時計がずれて未来の時刻でも、たった今', () => {
    expect(ago(-120)).toBe('たった今')
  })
})
