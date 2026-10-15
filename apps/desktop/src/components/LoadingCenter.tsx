// 読み込み中の表示。パネルの真ん中に、回る矢印と「読み込み中」を大きく出す

export default function LoadingCenter({ label = '読み込み中' }: { label?: string }) {
  return (
    <div className="flex-1 min-h-[200px] w-full flex flex-col items-center justify-center gap-3 text-c-text-muted select-none">
      <span className="material-symbols-outlined text-5xl animate-spin">autorenew</span>
      <span className="text-lg font-medium tracking-wide">{label}</span>
    </div>
  )
}
