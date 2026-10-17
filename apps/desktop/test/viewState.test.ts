import { describe, expect, it } from 'vitest'
import { canBack, canForward, initialView, nextAfterClose, selectQuietly, showList, showThread, step, type ViewState } from '../src/utils/viewState'

type V = { type: 'list' | 'thread'; id: string }
const list = (id = 'board') => ({ key: `list:${id}`, value: { type: 'list' as const, id } })
const thread = (id: string) => ({ key: `thread:${id}`, value: { type: 'thread' as const, id } })
const where = (s: ViewState<V>) => s.stack[s.index]?.key

/** 戻る・進むを、App と同じように行き先を見せる(記録しない)ところまで再現する */
function go(s: ViewState<V>, d: -1 | 1): ViewState<V> {
  const r = step(s, d)
  if (!r) return s
  const v = r.entry.value
  return v.type === 'thread' ? showThread(r.state, v.id, undefined) : showList(r.state, undefined)
}

describe('viewState: 画面の状態', () => {
  it('一覧 → スレ A → 戻る → スレ B → 戻る で、一覧に戻る', () => {
    let s = showList(initialView<V>(), list())
    s = showThread(s, 'A', thread('A'))
    s = go(s, -1)
    expect(s.listOpen).toBe(true)
    expect(s.activeId).toBe('A') // 裏では A を選んだまま
    s = showThread(s, 'B', thread('B'))
    expect(canForward(s)).toBe(false) // A への「進む」は捨てる
    s = go(s, -1)
    expect(s.listOpen).toBe(true)
    expect(where(s)).toBe('list:board')
  })

  it('一覧を出しているときにタブを選ぶと、スレを見せて履歴にも積む(一覧のまま積まない)', () => {
    let s = showList(selectQuietly(initialView<V>(), 'A'), list())
    s = showThread(s, 'A', thread('A'))
    expect(s.listOpen).toBe(false)
    expect(where(s)).toBe('thread:A')
  })

  it('スレタイの ← で一覧に戻り、別のスレを開いて戻ると一覧', () => {
    let s = showList(initialView<V>(), list())
    s = showThread(s, 'A', thread('A'))
    s = showList(s, list()) // ← で一覧へ
    s = showThread(s, 'B', thread('B'))
    s = go(s, -1)
    expect(s.listOpen).toBe(true)
    expect(where(s)).toBe('list:board')
  })

  it('同じものが続いたら 1 つにまとめ、戻る・進むの途中は積まない', () => {
    let s = showList(initialView<V>(), list())
    s = showList(s, list())
    expect(s.stack).toHaveLength(1)
    expect(canBack(s)).toBe(false)
    s = showThread(s, 'A', thread('A'))
    s = go(s, -1)
    s = go(s, 1)
    expect(s.stack.map((e) => e.key)).toEqual(['list:board', 'thread:A'])
    expect(s.listOpen).toBe(false)
  })

  it('閉じたタブの右隣、なければ左隣へ移る。選んでいないタブを閉じても変えない', () => {
    expect(nextAfterClose('B', ['A', 'B', 'C'], ['B'])).toEqual({ id: 'C', changed: true })
    expect(nextAfterClose('C', ['A', 'B', 'C'], ['C'])).toEqual({ id: 'B', changed: true })
    expect(nextAfterClose('A', ['A'], ['A'])).toEqual({ id: undefined, changed: true })
    expect(nextAfterClose('A', ['A', 'B'], ['B'])).toEqual({ id: 'A', changed: false })
  })
})
