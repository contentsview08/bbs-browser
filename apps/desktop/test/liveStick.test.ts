// 実況モードのライブの段で、上へ動かしたら一番下へ引き戻されずに外れるか(hooks/useAutoScroll.ts の寄せ方)。
// 画面(DOM)はないので、スクロールする箱を小さく真似て、毎コマの見張りと「レスを 1 件出した直後の寄せ」の両方を
// liveStickAction で決めて回す。前の作り(出した直後はいつも寄せる)も同じ真似で回し、引き戻されていたことも確かめる
import { describe, expect, it } from 'vitest'
import { liveStickAction } from '../src/utils/autoScroll'

const FRAME = 16
const GRACE = 300 // useAutoScroll の TOUCH_GRACE_MS
const POST_H = 60
const CLIENT_H = 600
/** レスが出る間(0.1〜0.5 秒) */
const GAPS = [120, 350, 100, 480, 230, 160, 410, 100, 290, 140]
/** 0.1〜0.15 秒ごとに出るとき(触り終えてからの待ちの間に、必ず次のレスが出る) */
const FAST_GAPS = [100, 150, 120, 140, 110]

type How = 'wheel' | 'finger' | 'key'

function run(how: How, policy: 'new' | 'old', gaps = GAPS) {
  let height = 3000
  let top = height - CLIENT_H
  let written = top
  let live = true
  let touchedAt = -Infinity
  /** これから当たる、利用者の動き(なめらかなスクロール・指を離した後の惰性・キーの runMove)。プログラムが位置を書くと打ち消される */
  let pending: { at: number; dy: number; key?: boolean }[] = []
  const max = () => height - CLIENT_H
  const write = (v: number) => {
    top = v
    written = v
    pending = []
  }
  const moving = () => pending.some((p) => p.key)
  const decide = (now: number) =>
    liveStickAction({ rest: max() - top, moved: Math.abs(top - written) >= 1, touching: moving() || now - touchedAt < GRACE })

  let nextPost = 0
  let gap = 0
  // コマの区切りに合わせる
  const start = 63 * FRAME
  for (let now = 0; now < 4000; now += FRAME) {
    // 利用者の動き
    if (how === 'wheel' && now >= start && now < start + 400 && (now - start) % 48 === 0) {
      // ホイール 1 ノッチ: イベントのあと、少し遅れて何コマかに分けて動く
      touchedAt = now
      for (let i = 1; i <= 8; i++) pending.push({ at: now + i * FRAME, dy: -12 })
    }
    if (how === 'finger' && now >= start && now < start + 200) {
      // 指でなぞっている間は、毎コマ touchmove が来る
      touchedAt = now
      pending.push({ at: now + FRAME, dy: -15 })
      // 離したら惰性で動く(イベントは来ない)
      if (now + FRAME >= start + 200) for (let i = 2; i <= 30; i++) pending.push({ at: now + i * FRAME, dy: -8 })
    }
    if (how === 'key' && now === start) for (let i = 1; i <= 15; i++) pending.push({ at: now + i * FRAME, dy: -40, key: true })
    for (const p of pending.filter((p) => p.at <= now)) top = Math.max(0, Math.min(max(), top + p.dy))
    pending = pending.filter((p) => p.at > now)

    // ライブの段で、レスを 1 件出す(描いた直後の寄せ)
    if (now >= nextPost) {
      nextPost = now + gaps[gap++ % gaps.length]
      height += POST_H
      if (live) {
        if (policy === 'old') write(max())
        else {
          const a = decide(now)
          if (a === 'leave') live = false
          else if (a === 'stick') write(max())
        }
      }
    }
    // 毎コマの見張り(キーで動かし中は触ったことにして見送る)
    if (moving()) {
      touchedAt = now
      continue
    }
    if (live) {
      // 前の作りは、触った直後なら動いたかを見る前に見送っていた
      const a = policy === 'old' && now - touchedAt < GRACE ? 'wait' : decide(now)
      if (a === 'leave') live = false
      else if (a === 'stick' && max() - top > 0) write(max())
    }
  }
  return { live, rest: max() - top }
}

describe('実況モードのライブの段: 上へ動かしたら外れる(レスが 0.1〜0.5 秒ごとに出るとき)', () => {
  for (const how of ['wheel', 'finger', 'key'] as const) {
    it(`${how}: ライブの段から外れ、一番下へ引き戻されない`, () => {
      for (const gaps of [GAPS, FAST_GAPS]) {
        const r = run(how, 'new', gaps)
        expect(r.live).toBe(false)
        expect(r.rest).toBeGreaterThan(100)
      }
    })
    it(`${how}: 前の作り(出した直後はいつも寄せる)では、速く出ると引き戻されていた`, () => {
      expect(run(how, 'old', FAST_GAPS).live).toBe(true)
    })
  }

  it('触らなければ、出したレスに合わせて一番下にくっついたまま', () => {
    expect(liveStickAction({ rest: POST_H, moved: false, touching: false })).toBe('stick')
  })

  it('一番下でホイールを回しても(動かない)、外れずに触り終わってから寄せる', () => {
    expect(liveStickAction({ rest: POST_H, moved: false, touching: true })).toBe('wait')
    expect(liveStickAction({ rest: 10, moved: true, touching: false })).toBe('stick')
  })
})
