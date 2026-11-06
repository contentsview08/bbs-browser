export default function LoadingCenter() {
  return (
    <div className="flex-1 min-h-[200px] w-full flex flex-col items-center justify-center gap-3 text-c-text-muted select-none">
      <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
      <span className="text-sm">読み込み中</span>
    </div>
  )
}
