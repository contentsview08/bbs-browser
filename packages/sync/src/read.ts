// 既読。リセット(スレごと・LWW)と端末ごとの記録(持ち主だけが書く・LWW)に分ける
import { compareHlc, HLC_ZERO } from './hlc'
import type { SyncPayload } from './merge'

export const MAX_STEPS = 8
export const RESET_KIND = 'read_reset'
export const DEV_KIND = 'read_dev'

export interface ReadStep {
  at: string
  pos: number
  [key: string]: unknown
}

const resetId = (r: SyncPayload | null): string | null => (r?.body?.id as string | undefined) ?? null
const resetAt = (r: SyncPayload | null): string => r?.hlc ?? HLC_ZERO
const resetTarget = (r: SyncPayload | null): number => (r?.body?.target_res as number | undefined) ?? 0
const stepsOf = (d: SyncPayload | null | undefined): ReadStep[] => (d?.body?.steps as ReadStep[] | undefined) ?? []

/** 後ろの要素以下の位置は要らない(どの時刻で引いても後ろの要素が同じ答えを返す)。at が進むほど pos が小さい並びになる */
export function pushStep(steps: readonly ReadStep[], at: string, pos: number): ReadStep[] {
  return [...steps.filter((s) => s.pos > pos), { at, pos }].slice(-MAX_STEPS)
}

/**
 * 読んだ記録。stamp は hlcStamp に dev.hlc を floor として渡して作る。
 * 新しいリセットを知った時点でも、そのリセットより後に読んだ分は引き継ぐ(既読位置が読み直しで下がらないように)。
 * 今の読みも必ず steps に足す(まだ知らない次のリセットより後の読みかもしれない)
 */
export function recordRead(dev: SyncPayload | null, latest: SyncPayload | null, pos: number, stamp: string, deviceId: string): SyncPayload {
  const id = resetId(latest)
  const after = resetAt(latest)
  const live = stepsOf(dev).filter((s) => compareHlc(s.at, after) > 0)
  const known = dev !== null && ((dev.body?.base_reset_id as string | null | undefined) ?? null) === id
  const prior = known ? ((dev.body?.pos as number | undefined) ?? 0) : Math.max(0, ...live.map((s) => s.pos))
  return {
    ...dev,
    kind: DEV_KIND,
    hlc: stamp,
    device_id: deviceId,
    body: { ...dev?.body, base_reset_id: id, pos: Math.max(prior, pos), steps: pushStep(live, stamp, pos) },
  }
}

/** リセットの floor。知っている読みより必ず後にする(先の日時の読みが残ると未読に戻せない) */
export function resetFloor(latest: SyncPayload | null, devs: Iterable<SyncPayload>): string {
  let floor = resetAt(latest)
  for (const d of devs) {
    if (compareHlc(d.hlc, floor) > 0) floor = d.hlc
    for (const s of stepsOf(d)) if (compareHlc(s.at, floor) > 0) floor = s.at
  }
  return floor
}

/** 未読に戻す。stamp は hlcStamp に resetFloor の値を floor として渡して作る。id はランダムな値 */
export function makeReset(existing: SyncPayload | null, id: string, targetRes: number, stamp: string, deviceId: string): SyncPayload {
  return { ...existing, kind: RESET_KIND, hlc: stamp, device_id: deviceId, body: { ...existing?.body, id, target_res: targetRes } }
}

export function readPosition(latest: SyncPayload | null, devs: Iterable<SyncPayload>): number {
  const id = resetId(latest)
  const after = resetAt(latest)
  let best = resetTarget(latest)
  for (const d of devs) {
    if (((d.body?.base_reset_id as string | null | undefined) ?? null) === id) {
      best = Math.max(best, (d.body?.pos as number | undefined) ?? 0)
    } else {
      for (const s of stepsOf(d)) if (compareHlc(s.at, after) > 0) best = Math.max(best, s.pos)
    }
  }
  return best
}
