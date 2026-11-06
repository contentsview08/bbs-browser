// 引っぱって更新の定数と動きの式。スマホ(タッチ)と PC(ホイール)で共有する

// 指を離した・しきい値に達したときに、確定位置へ素早く戻る
export const PULL_SNAP_TRANSITION = 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)'
// しまうとき(少しゆっくり)
export const PULL_SETTLE_TRANSITION = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease-out'
// アイコンが隠れている位置と、確定して回る位置の translateY。
// 中身の高さを変えずアイコンだけを動かすので、transform で動かす
export const PULL_HIDDEN_Y = -70
export const PULL_REVEAL_Y = 20
// 見た目の上限(近づくだけで届かない)
export const PULL_MAX_Y = 110
// 取得が速くても、最低これだけ回す(ms)
export const MIN_SPIN_MS = 800

// ゴムひものような動き。引くほど遅くなり、PULL_MAX_Y に近づく
export function dampedPullY(dy: number, threshold: number): number {
  const t = dy / (dy + threshold) // dy=0→0, dy=threshold→0.5, dy→∞→1
  return PULL_HIDDEN_Y + (PULL_MAX_Y - PULL_HIDDEN_Y) * t
}
