// 掲示板が付けた印(レスの「管理人」「認証済み」、スレの「固定」など。コネクタの Badge)。
// 色は意味(tone)で選び、配色の色で塗る(掲示板ごとに色を決めさせない)
import type { Badge } from '@bbs-browser/connectors'

const TONE: Record<NonNullable<Badge['tone']>, string> = {
  accent: 'var(--c-accent)',
  muted: 'var(--c-text-muted)',
  danger: 'var(--c-error)',
  success: 'var(--c-mark-new)',
  warning: 'var(--c-mark-fav)',
}

export default function BadgeChip({ badge }: { badge: Badge }) {
  const color = TONE[badge.tone ?? 'muted']
  return (
    <span
      className="flex-shrink-0 inline-flex items-center text-[10px] font-bold leading-none px-1.5 py-0.5 whitespace-nowrap"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        borderRadius: 'var(--chip-radius, 4px)',
      }}
      title={badge.title ?? badge.label}
    >
      {badge.label}
    </span>
  )
}
