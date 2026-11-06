// HLC は「壁時計(ms)12 桁の 16 進.カウンター 4 桁の 16 進.端末 ID」の文字列。文字列の比較がそのまま順序になる
import { SyncError } from './errors'

export const HLC_ZERO = '000000000000.0000.'
export const FUTURE_LIMIT_MS = 24 * 60 * 60 * 1000
const MAX_WALL = 2 ** 48 - 1
const MAX_COUNTER = 0xffff
const HLC_RE = /^([0-9a-f]{12})\.([0-9a-f]{4})\.([A-Za-z0-9_-]{1,64})$/
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface HlcParts {
  wall: number
  counter: number
  device: string
}

export function formatHlc(wall: number, counter: number, device: string): string {
  if (!Number.isSafeInteger(wall) || wall < 0 || wall > MAX_WALL || counter < 0 || counter > MAX_COUNTER || !DEVICE_ID_RE.test(device)) throw new SyncError('bad_hlc')
  return `${wall.toString(16).padStart(12, '0')}.${counter.toString(16).padStart(4, '0')}.${device}`
}

export function parseHlc(s: string): HlcParts {
  if (s === HLC_ZERO) return { wall: 0, counter: 0, device: '' }
  const m = HLC_RE.exec(s)
  if (!m) throw new SyncError('bad_hlc')
  return { wall: parseInt(m[1], 16), counter: parseInt(m[2], 16), device: m[3] }
}

export const isHlc = (s: unknown): s is string => typeof s === 'string' && HLC_RE.test(s)

export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** (wall, counter) を 1 つ進める。カウンターが尽きたら壁時計を進める */
function bump(wall: number, counter: number): [number, number] {
  return counter >= MAX_COUNTER ? [wall + 1, 0] : [wall, counter + 1]
}

/** 受け取った HLC を端末の HLC に反映する。24 時間以上先なら、時計の狂った端末に引きずられないよう進めない */
export function hlcObserve(clock: string, remote: string, nowMs: number): string {
  const r = parseHlc(remote)
  if (r.wall - nowMs >= FUTURE_LIMIT_MS) return clock
  return compareHlc(remote, clock) > 0 ? remote : clock
}

/**
 * 新しい更新の HLC を作る。floor はそのレコードの HLC で、必ずこれより大きくする(時計の狂った端末が書いた値も上書きできるように)。
 * floor が 24 時間以上先なら、更新の値だけが先へ進み、端末の HLC は引きずられない
 */
export function hlcStamp(clock: string, nowMs: number, device: string, floor?: string): { stamp: string; clock: string } {
  const c = parseHlc(clock)
  const [wall, counter] = nowMs > c.wall ? [Math.floor(nowMs), 0] : bump(c.wall, c.counter)
  const ticked = formatHlc(wall, counter, device)
  if (floor === undefined || compareHlc(ticked, floor) > 0) return { stamp: ticked, clock: ticked }
  const f = parseHlc(floor)
  const stamp = formatHlc(...bump(f.wall, f.counter), device)
  return { stamp, clock: parseHlc(stamp).wall - nowMs >= FUTURE_LIMIT_MS ? ticked : stamp }
}
