// 枠 2・3 領域・各 2 台のシナリオ(docs/sync-security.md の枠 2 のシミュレーター)。偽サーバーと本物のサーバーの両方で流す
import { Rng } from './sim'
import type { Scenario, Step } from './scenarioRunner'

const BOARD = 'https://a.5ch.io/x/'
const DAY = 86_400_000
const SPACES = ['a', 'b', 'c']
const DEVICES = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']
const days = (n: number): Step => ({ op: 'advance_ms', ms: n * DAY })
const t = (device: string, key: string) => ({ device, board: BOARD, key, title: `t${key}` })
const read = (device: string, key: string, no: number): Step[] => [{ ...t(device, key), op: 'open' }, { ...t(device, key), op: 'read', no }]
const sync = (...ds: string[]): Step[] => ds.map((device) => ({ device, op: 'sync' }))
const start = (first: string, second: string): Step[] => [{ device: first, op: 'pair_first' }, { device: second, op: 'pair_join', from: first }]
const exists = (of: Record<string, boolean>): Step => ({ op: 'expect', expect: { $server: { of: Object.fromEntries(Object.entries(of).map(([k, v]) => [k, { exists: v }])) } } })
const atMost: Step = { op: 'expect', expect: { $server: { spaces_at_most: 2 } } }
const base = { devices: DEVICES, server: { space_limit: 2 } }

export const SLOT_SCENARIOS: Scenario[] = [
  {
    ...base,
    name: '押し出しの順序: 14 日空いた領域のうち一番古いものから',
    steps: [...start('a1', 'a2'), days(3), ...start('b1', 'b2'), days(17), ...start('c1', 'c2'), exists({ a1: false, b1: true, c1: true }), atMost, { op: 'expect', expect: { c1: { phase: 'idle' } } }],
  },
  {
    ...base,
    name: '使用中の領域を消さない: 報告が遅れていても 14 日以内の領域は残り、古い方が消える',
    steps: [...start('a1', 'a2'), ...start('b1', 'b2'), days(13), ...sync('a1'), days(2), { device: 'c1', op: 'pair_first' }, exists({ a1: true, b1: false, c1: true }), atMost],
  },
  {
    ...base,
    name: '満員の応答: 該当がなければ capacity_full で止まり、既存の領域の同期は止まらない',
    steps: [
      ...start('a1', 'a2'),
      ...start('b1', 'b2'),
      days(1),
      { device: 'c1', op: 'pair_first' },
      { op: 'expect', expect: { c1: { phase: 'blocked', last_error: 'capacity_full' }, $server: { spaces: 2 } } },
      { op: 'mark' },
      ...read('a1', '1', 5),
      ...sync('a1', 'a2'),
      { op: 'expect', expect: { a2: { read_no: { '1': 5 } } } },
      exists({ a1: true, b1: true }),
    ],
  },
  {
    ...base,
    name: '作り直しの合流: 押し出された領域を手元から作り直し、今のデータと同期の表が揃い、削除が復活しない',
    steps: [
      ...start('a1', 'a2'),
      ...read('a1', '1', 10),
      ...read('a1', '2', 20),
      { ...t('a1', '3'), op: 'post_add', no: 1, body: '残る' },
      days(0),
      { ...t('a1', '4'), op: 'post_add', no: 2, body: '消す' },
      { op: 'advance_ms', ms: 1000 },
      ...sync('a1', 'a2'),
      { ...t('a2', '2'), op: 'view_remove' },
      { device: 'a2', op: 'post_remove', key: '4', body: '消す' },
      { op: 'advance_ms', ms: 1000 },
      ...sync('a2', 'a1'),
      ...start('b1', 'b2'),
      days(15),
      ...start('c1', 'c2'),
      exists({ a1: false, c1: true }),
      days(15),
      { op: 'settle', devices: ['a1', 'a2'] },
      exists({ a1: true }),
      { op: 'converged', devices: ['a1', 'a2'] },
      { op: 'summary_same', devices: ['a1', 'a2'] },
      { op: 'expect', expect: { a1: { history: ['1'], post_bodies: ['残る'], pending: 0 }, a2: { history: ['1'], post_bodies: ['残る'], pending: 0 } } },
    ],
  },
  {
    ...base,
    name: '消し合いが起きない: 使っている 2 つの領域は 3 つ目が何度来ても消えない',
    steps: [
      ...start('a1', 'a2'),
      ...start('b1', 'b2'),
      ...Array.from({ length: 6 }, (_, i) => [days(10), ...read('a1', String(i), i + 1), ...read('b1', String(i), i + 1), ...sync('a1', 'b1'), { device: 'c1', op: i === 0 ? 'pair_first' : 'sync' } as Step, exists({ a1: true, b1: true }), atMost]).flat(),
      { op: 'expect', expect: { c1: { phase: 'blocked' } } },
    ],
  },
  {
    ...base,
    name: '同時の作成: 枠の数を超えず、通番が重複しない',
    steps: [
      { device: 'a1', op: 'pair_first', no_sync: true },
      { device: 'b1', op: 'pair_first', no_sync: true },
      { device: 'c1', op: 'pair_first', no_sync: true },
      { op: 'sync_together', devices: ['a1', 'b1', 'c1'] },
      atMost,
    ],
  },
  {
    ...base,
    name: '送信待ちの残る端末: 押し出されても、裏に回る瞬間の送信が切れても、未送信が失われず次の前面で届く',
    steps: [
      ...start('a1', 'a2'),
      ...start('b1', 'b2'),
      days(15),
      ...start('c1', 'c2'),
      exists({ a1: false }),
      ...read('a1', '1', 7),
      { op: 'server_unreachable', path: '/changes', times: 1 },
      { device: 'a1', op: 'sync_auto' },
      { op: 'expect', expect: { a1: { ops: 0, pending: 2 } } },
      days(15),
      { op: 'clear_faults' },
      { op: 'settle', devices: ['a1', 'a2'] },
      { op: 'expect', expect: { a2: { read_no: { '1': 7 } }, a1: { pending: 0 } } },
    ],
  },
  {
    ...base,
    name: 'オフラインの端末の復帰: 押し出しの前後に戻っても収束し、手元が消えない',
    steps: [
      ...start('a1', 'a2'),
      ...read('a1', '1', 3),
      ...sync('a1', 'a2'),
      { device: 'a2', op: 'offline' },
      ...read('a2', '2', 4),
      ...start('b1', 'b2'),
      days(15),
      ...start('c1', 'c2'),
      exists({ a1: false }),
      days(15),
      ...read('a1', '3', 5),
      { op: 'settle', devices: ['a1'] },
      { device: 'a2', op: 'online' },
      { op: 'settle', devices: ['a1', 'a2'] },
      { op: 'converged', devices: ['a1', 'a2'] },
      { op: 'expect', expect: { a2: { read_no: { '1': 3, '2': 4, '3': 5 } }, a1: { read_no: { '1': 3, '2': 4, '3': 5 } } } },
    ],
  },
]

/** 読む・足す・外す・同期する・切る・戻る・時計を進める・同時に送る。どの順でも枠を超えず、各領域の 2 台が揃う */
export function randomSlotScenario(seed: number, long = false): Scenario {
  // long は 90 日を超えて進める。片づいた tombstone は端末で残り方が違うので、生きている値だけを比べる
  const ops = long ? 60 : 40
  const rng = new Rng(seed)
  const steps: Step[] = []
  for (const s of SPACES) steps.push({ device: `${s}1`, op: 'pair_first' }, { device: `${s}2`, op: 'pair_join', from: `${s}1` })
  const removed = new Map<string, string[]>()
  for (let i = 0; i < ops; i++) {
    const device = DEVICES[rng.int(DEVICES.length)]
    const key = String(1 + rng.int(4))
    steps.push({ op: 'advance_ms', ms: 1000 + (long ? rng.int(4) * rng.int(5) : rng.int(2) * rng.int(4)) * DAY })
    switch (rng.int(9)) {
      case 0:
      case 1:
        steps.push(...read(device, key, 1 + rng.int(99)))
        break
      case 2:
        steps.push({ ...t(device, key), op: 'view_remove' })
        break
      case 3: {
        const body = `本文 ${i}`
        steps.push({ ...t(device, key), op: 'post_add', no: 1 + rng.int(99), body })
        removed.set(device, [...(removed.get(device) ?? []), `${key}\t${body}`])
        break
      }
      case 4: {
        const mine = removed.get(device) ?? []
        if (mine.length > 0) {
          const [k, body] = mine[rng.int(mine.length)].split('\t')
          steps.push({ device, op: 'post_remove', key: k, body })
        }
        break
      }
      case 5:
        steps.push({ device, op: 'sync' })
        break
      case 6:
        steps.push({ device, op: rng.int(2) === 0 ? 'offline' : 'online' })
        break
      case 7:
        steps.push({ op: 'sync_together', devices: [DEVICES[rng.int(6)], DEVICES[rng.int(6)]].filter((x, j, a) => a.indexOf(x) === j) })
        break
      case 8:
        steps.push({ op: 'server_unreachable', path: '/records', times: 1 }, { device, op: 'sync' })
        break
    }
    // 確かめの通信が多いと、Windows で一時ポートが尽きて接続に失敗する
    if (i % 10 === 0) steps.push(atMost)
  }
  for (const device of DEVICES) steps.push({ device, op: 'online' })
  steps.push({ op: 'clear_faults' })
  // 枠が 2 なので、14 日ずつ空けて順に作り直し、領域ごとに揃うことを見る
  for (const s of SPACES) {
    const pair = [`${s}1`, `${s}2`]
    steps.push(days(16), { op: 'settle', devices: pair }, atMost, { op: 'converged', devices: pair, full: false, ignore_tombstones: long })
    if (!long) steps.push({ op: 'summary_same', devices: pair, local: false })
    steps.push({ op: 'expect', expect: { [`${s}1`]: { pending: 0, ops: 0, needs_apply: 0 }, [`${s}2`]: { pending: 0, ops: 0, needs_apply: 0 } } })
  }
  return { name: `枠 2 の乱数 ${long ? '長い ' : ''}${seed}`, devices: DEVICES, server: { space_limit: 2 }, steps }
}
