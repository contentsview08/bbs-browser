// 順序・重複・中断を乱数で作るシナリオ。生成した手順を sync-client-random.json に置き、スマホ版は同じ手順を流して digest まで比べる
import { Rng } from './sim'
import type { Scenario, Step } from './scenarioRunner'

const BOARD = 'https://a.5ch.io/x/'
const DEVICES = ['pc', 'phone', 'tablet']
const KEYS = ['1', '2', '3', '4', '5', '6']

const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[rng.int(xs.length)]

/** full は手元の行まで全部を比べる(ログの削除と自動整理を使わない)。そうでなければ両方にある行を比べる */
export function randomScenario(seed: number, full: boolean, ops = 70): Scenario {
  const rng = new Rng(seed * 2 + (full ? 1 : 0))
  const steps: Step[] = [{ device: 'pc', op: 'pair_first' }, { device: 'phone', op: 'pair_join', from: 'pc' }, { device: 'tablet', op: 'pair_join', from: 'pc' }]
  const seedRows: NonNullable<Scenario['seed']> = {}
  for (const d of DEVICES) {
    const threads = KEYS.filter(() => rng.int(3) === 0).map((key) => ({ board: BOARD, key, title: `t${key}`, read_no: 1 + rng.int(50), read_ago_ms: 1000 + rng.int(100000) }))
    const posts = KEYS.filter(() => rng.int(4) === 0).map((key) => ({ board: BOARD, key, title: `t${key}`, no: 1 + rng.int(50), body: `種 ${key}`, ago_ms: 200000 }))
    seedRows[d] = { threads, posts }
  }
  const bodies = ['a', 'b', 'c', 'd']
  const written = new Map<string, Set<string>>()
  for (let i = 0; i < ops; i++) {
    const device = pick(rng, DEVICES)
    const key = pick(rng, KEYS)
    const t = { device, board: BOARD, key, title: `t${key}` }
    steps.push({ op: 'advance_ms', ms: 100 + rng.int(5000) })
    switch (rng.int(full ? 11 : 13)) {
      case 0:
      case 1:
        steps.push({ ...t, op: 'open' }, { ...t, op: 'read', no: 1 + rng.int(100) })
        break
      case 2:
        steps.push({ ...t, op: 'open' }, { ...t, op: 'view' })
        break
      case 3:
        steps.push({ ...t, op: 'view_remove' })
        break
      case 4: {
        const body = `${pick(rng, bodies)}${i}`
        steps.push({ ...t, op: 'post_add', no: 1 + rng.int(100), body })
        if (!written.has(device)) written.set(device, new Set())
        ;(written.get(device) as Set<string>).add(`${key}\t${body}`)
        break
      }
      case 5: {
        const mine = [...(written.get(device) ?? [])]
        if (mine.length > 0) {
          const [k, body] = pick(rng, mine).split('\t')
          steps.push({ device, op: 'post_remove', key: k, body })
        }
        break
      }
      case 6:
      case 7:
        steps.push({ device, op: 'sync' })
        break
      case 8:
        steps.push({ device, op: rng.int(2) === 0 ? 'offline' : 'online' })
        break
      case 9:
        steps.push(rng.int(2) === 0 ? { op: 'server_drop_response', path: '/records', times: 1 } : { op: 'server_fail', status: 500, times: 1, path: rng.int(2) === 0 ? '/changes' : '/records' })
        break
      case 10:
        steps.push({ device, op: 'restart' })
        break
      case 11:
        steps.push({ ...t, op: 'log_delete' })
        break
      case 12:
        steps.push({ device, op: 'prune', older_than_ms: 60_000 })
        break
    }
  }
  for (const device of DEVICES) steps.push({ device, op: 'online' })
  steps.push({ op: 'clear_faults' }, { op: 'settle' })
  if (full) for (const device of DEVICES) for (const key of KEYS) steps.push({ device, board: BOARD, key, title: `t${key}`, op: 'open' })
  steps.push({ op: 'settle' }, { op: 'converged', full }, { op: 'summary_same', local: full })
  for (const device of DEVICES) steps.push({ op: 'expect', expect: { [device]: { pending: 0, ops: 0, needs_apply: 0 } } })
  return { name: `乱数 ${full ? '全部' : '削除あり'} ${seed}`, devices: DEVICES, seed: seedRows, steps }
}

/** 5,000 スレと 5,000 件の書き込みを持つ 2 台。半分が重なる */
export function largeJoinScenario(): Scenario {
    const threads = (from: number, to: number, ago: number) => Array.from({ length: to - from }, (_, i) => ({ board: BOARD, key: String(from + i), title: `スレ ${from + i}`, read_no: 1 + (i % 500), read_ago_ms: ago + i, post_count: 600 }))
    const posts = (from: number, to: number, ago: number) => Array.from({ length: to - from }, (_, i) => ({ board: BOARD, key: String(from + i), title: `スレ ${from + i}`, no: 1, body: `本文 ${from + i}`, ago_ms: ago + from + i }))
    return {
      name: '5,000 件の合流',
      devices: ['pc', 'phone'],
      seed: { pc: { threads: threads(0, 5000, 1000), posts: posts(0, 5000, 1000) }, phone: { threads: threads(2500, 7500, 2000), posts: posts(2500, 7500, 1000) } },
      steps: [
        { device: 'pc', op: 'pair_first' },
        { device: 'phone', op: 'pair_join', from: 'pc' },
        { op: 'settle' },
        { op: 'converged' },
        { op: 'summary_same' },
        { op: 'expect', expect: { pc: { pending: 0, ops: 0, needs_apply: 0, kinds: { last_view: 7500, read_dev: 10000, post: 7500 } } } },
      ],
    }
}
