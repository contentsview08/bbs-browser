// 乱数のシナリオと件数の多い合流。件数の多い方は所要時間を出す
import { describe, expect, it } from 'vitest'
import { largeJoinScenario, randomScenario } from './randomScenario'
import { runScenario } from './scenarioRunner'
import { fitPostBody, POST_BODY_JSON_BYTES, postIdOf } from '../src/index'


describe('順序・重複・中断', () => {
  it('300 シード: 削除なしは手元の行まで全部揃う', async () => {
    for (let seed = 100; seed < 400; seed++) await runScenario(randomScenario(seed, true))
  }, 600_000)
  it('300 シード: ログの削除と自動整理があっても、同期の表と両方にある行が揃う', async () => {
    for (let seed = 100; seed < 400; seed++) await runScenario(randomScenario(seed, false))
  }, 600_000)
})

describe('件数の多い合流', () => {
  it('5,000 スレと 5,000 件の書き込みを持つ 2 台が合流する', async () => {
    const c = largeJoinScenario()
    const at = Date.now()
    await runScenario(c)
    console.log(`合流 2 台(閲覧 7,500・書き込み 7,500・レコード 25,000): ${Date.now() - at} ms`)
  }, 600_000)
})

describe('書き込みの ID と切り方', () => {
  it('文字の途中で切らず、エスケープで膨らんでもバイトの上限に収まる', () => {
    expect(fitPostBody('a'.repeat(4095) + '😀')).toBe('a'.repeat(4095))
    expect(fitPostBody('😀'.repeat(3000)).length).toBe(4096)
    expect(fitPostBody('\u0001'.repeat(5000)).length).toBe(POST_BODY_JSON_BYTES / 6)
    expect(fitPostBody('短い')).toBe('短い')
  })
  it('切る前の本文でも切った後の本文でも同じ ID', () => {
    const full = 'あ'.repeat(5000)
    expect(postIdOf('a.5ch.io/x/', '1', 5, full)).toBe(postIdOf('a.5ch.io/x/', '1', 5, fitPostBody(full)))
    expect(postIdOf('a.5ch.io/x/', '1', 5, 'x')).not.toBe(postIdOf('a.5ch.io/x/', '1', 6, 'x'))
    expect(postIdOf('a.5ch.io/x/', '1', 5, 'x')).toMatch(/^[0-9a-f]{32}$/)
  })
})
