// hono-bbs-merge packages/web/src/utils/pullRefresh.ts から複製
// X/Twitter風プルリフレッシュの共通定数とイージング関数。
// スマホ(タッチ)・PC(ホイール)の両方で同じ見た目/挙動になるよう共有する。

// 指を離した瞬間/しきい値に達した瞬間、確定位置へ素早く戻るためのトランジション
export const PULL_SNAP_TRANSITION = 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)'
// 収納するときのトランジション（こちらは少しゆっくり）
export const PULL_SETTLE_TRANSITION = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease-out'
// アイコンが完全に隠れている位置(ヘッダー/コンテンツの裏)/確定してドッキングする位置
// (くるくる回る位置)のtranslateY。コンテンツの高さを一切変えず、アイコンだけが
// 独立して降りてくる/上がってくるようにするため、高さアニメーションではなく
// transformで動かす。
export const PULL_HIDDEN_Y = -70
export const PULL_REVEAL_Y = 20
// 引っ張れる見た目上の上限(これ以上は指/ホイールを動かしても近づいていくだけで到達しない)
export const PULL_MAX_Y = 110
// どんなにデータ取得が速くても、最低でもこの時間はくるくる回してから確定表示する(ms)
export const MIN_SPIN_MS = 800

// 移動量(dy)に対して、閾値(threshold)に達した時点でちょうどPULL_REVEAL_Yになり、
// それ以上引っ張っても徐々に速度が落ちながらPULL_MAX_Yに漸近する「ゴムひも」カーブ。
export function dampedPullY(dy: number, threshold: number): number {
  const t = dy / (dy + threshold) // dy=0→0, dy=threshold→0.5, dy→∞→1
  return PULL_HIDDEN_Y + (PULL_MAX_Y - PULL_HIDDEN_Y) * t
}
