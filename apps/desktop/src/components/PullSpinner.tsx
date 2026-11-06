interface PullSpinnerProps {
  iconRef: React.RefObject<HTMLSpanElement | null>
}

/**
 * プルリフレッシュのインジケーター中身（X/Twitter風の丸い回転矢印）。
 * 見た目だけのコンポーネントで、実際の位置/不透明度/回転は呼び出し側がrefを直接操作する。
 * スマホ(タッチ)・PC(ホイール)の両方で共通して使う。
 */
export default function PullSpinner({ iconRef }: PullSpinnerProps) {
  return (
    <div className="w-[42px] h-[42px] rounded-full bg-c-surface border border-c-border shadow flex items-center justify-center">
      <span ref={iconRef} className="material-symbols-outlined text-2xl text-c-accent leading-none">
        refresh
      </span>
    </div>
  )
}
