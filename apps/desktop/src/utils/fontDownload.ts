// 書体の取得の状態。通信とファイルは Rust 側(src-tauri/src/fonts.rs)、ここは状態の決まりだけ

/** 書体の行の状態 */
export type FontState =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'running'; done: number; total: number; switchTo: boolean }
  | { kind: 'failed'; error: string }

export type FontStates = Readonly<Record<string, FontState>>

/** Rust からの知らせ(font-download) */
export interface FontEvent {
  key: string
  state: 'running' | 'done' | 'failed' | 'canceled'
  done: number
  total: number
  switchTo: boolean
  error?: string | null
}

/** 設定を開いたときの状態(font_status) */
export interface FontStatus {
  ready: string[]
  running: { key: string; done: number; total: number; switchTo: boolean }[]
  failed: { key: string; error: string }[]
}

/** OS の書体を使うものは取りに行かない */
export function fontNeedsDownload(key: string): boolean {
  return key !== 'system' && key !== 'custom'
}

export function reduceFontStates(states: FontStates, e: FontEvent): FontStates {
  const next = (): FontState => {
    switch (e.state) {
      case 'running':
        return { kind: 'running', done: e.done, total: e.total, switchTo: e.switchTo }
      case 'done':
        return { kind: 'ready' }
      case 'failed':
        return { kind: 'failed', error: e.error || '取得できませんでした' }
      case 'canceled':
        return { kind: 'none' }
    }
  }
  return { ...states, [e.key]: next() }
}

export function fontStatesOf(status: FontStatus): FontStates {
  const out: Record<string, FontState> = {}
  for (const key of status.ready) out[key] = { kind: 'ready' }
  for (const f of status.failed) out[f.key] = { kind: 'failed', error: f.error }
  for (const r of status.running) out[r.key] = { kind: 'running', done: r.done, total: r.total, switchTo: r.switchTo }
  return out
}

/** 進み具合(0〜100)。数がまだ分からなければ undefined(バーを流す) */
export function fontPercent(done: number, total: number): number | undefined {
  if (total <= 0) return undefined
  return Math.min(100, Math.floor((done / total) * 100))
}

/** 置き場の CSS の url("0.woff2") を、画面から読める URL に置き換える */
export function localFontCss(css: string, dir: string, toUrl: (path: string) => string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return css.replace(/url\("(\d+\.woff2)"\)/g, (_, file: string) => `url("${toUrl(`${dir}${sep}${file}`)}")`)
}
