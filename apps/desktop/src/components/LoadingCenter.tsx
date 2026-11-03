// 読み込み中の表示。パネルの真ん中に、回る印と「読み込み中」を小さく出す

export default function LoadingCenter({ label = '読み込み中' }: { label?: string }) {
  return (
    <div className="flex-1 min-h-[200px] w-full flex flex-col items-center justify-center gap-3 text-c-text-muted select-none">
      <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
      <span className="text-sm">{label}</span>
    </div>
  )
}
