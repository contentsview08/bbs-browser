// 画面を組み立てている途中で投げられた例外を受け止める囲い。
// 受け止めないと React が画面全体を外して真っ白になり、アプリが落ちたように見える(何が起きたかも分からない)。
// ここでは何が起きたかを出し、読み込み直せるようにする
import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('画面の組み立てで例外', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-c-base text-c-text-body">
        <div className="max-w-xl w-full bg-c-surface border border-c-border rounded-2xl p-5 shadow-xl">
          <h1 className="text-base font-bold text-c-text-strong mb-2">画面を組み立てられませんでした</h1>
          <p className="text-sm mb-3">下の内容を知らせてもらえれば直せます。読み込み直すと、開いていたタブは戻ります</p>
          <pre className="text-xs p-3 bg-c-surface2 rounded-[var(--card-radius)] whitespace-pre-wrap break-words max-h-64 overflow-y-auto custom-scrollbar">
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
          <div className="mt-4 flex justify-end">
            <button type="button" className="h-9 px-4 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)]" onClick={() => location.reload()}>
              読み込み直す
            </button>
          </div>
        </div>
      </div>
    )
  }
}
