// 帯の端の、つかんで高さを変える所(マウスを乗せると強調色の線が出る)。ダブルクリックで既定の高さに戻す

import { isMobile } from '../utils/platform'

export default function DragEdge(props: { edge: 'top' | 'bottom'; onMouseDown: (e: React.MouseEvent) => void; onReset: () => void }) {
  // スマホにはマウスでつまむ操作がない(長押しすると、つかみ所の線が光るだけだった)ので出さない
  if (isMobile) return null
  return (
    <div
      className={`absolute left-0 right-0 ${props.edge === 'bottom' ? '-bottom-1' : '-top-1'} h-2 z-20 cursor-row-resize group/edge`}
      onMouseDown={props.onMouseDown}
      onDoubleClick={props.onReset}
      title="ドラッグで高さを変える(ダブルクリックで元に戻す)"
    >
      <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 bg-c-accent opacity-0 group-hover/edge:opacity-60 transition-opacity" />
    </div>
  )
}
