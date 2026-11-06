// 別のウィンドウ(設定・NG の管理表)とのやりとり(PC 版だけ。web 版は同じ名前の空の実装で、画面の中に出す)。
// - openToolWindow: 道具のウィンドウを開く(開いていれば前に出して、出す分類を知らせる)
// - 設定の変更は settings-changed、お気に入り板・サイト・アカウントの変更は *-changed の知らせで、ウィンドウどうしが写し合う
// - 道具のウィンドウから、メインでしかできないこと(板の一覧を取る・ログイン・板を開く など)は callMain で頼む(main-rpc)
import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export type ToolKind = 'settings' | 'ng'

/** 道具のウィンドウを開けるか(PC 版は true。web 版は false で、画面の中に出す) */
export const canOpenToolWindow = true

export function windowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
}

/** 今のウィンドウが道具のウィンドウなら、その種類(URL の ?window=) */
export function toolKindOfThisWindow(): ToolKind | undefined {
  const w = new URLSearchParams(location.search).get('window')
  return w === 'settings' || w === 'ng' ? w : undefined
}

const TOOL_DEF: Record<ToolKind, { title: string; width: number; height: number }> = {
  settings: { title: '設定', width: 1000, height: 720 },
  ng: { title: 'NG の一覧', width: 960, height: 640 },
}

/** 道具のウィンドウを開く(開いていれば前に出す)。tab は設定の分類 */
export async function openToolWindow(kind: ToolKind, params: { tab?: string } = {}): Promise<void> {
  const label = kind
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.unminimize().catch(() => undefined)
    await existing.setFocus().catch(() => undefined)
    await emitTo(label, 'tool-open', params)
    return
  }
  const def = TOOL_DEF[kind]
  const q = new URLSearchParams({ window: kind, ...(params.tab ? { tab: params.tab } : {}) })
  const w = new WebviewWindow(label, { url: `index.html?${q}`, title: def.title, width: def.width, height: def.height, minWidth: 640, minHeight: 420 })
  await new Promise<void>((resolve, reject) => {
    void w.once('tauri://created', () => resolve())
    void w.once('tauri://error', (e) => reject(new Error(String(e.payload))))
  })
}

/** 道具のウィンドウが「開く分類を変えて」と言われたとき */
export function onToolOpen(cb: (params: { tab?: string }) => void): Promise<UnlistenFn> {
  return listen<{ tab?: string }>('tool-open', (e) => cb(e.payload))
}

/** すべてのウィンドウへ知らせる(自分にも届くので、from で見分ける) */
export function broadcast<T>(event: string, payload: T): Promise<void> {
  return emit(event, { from: windowLabel(), payload })
}
/** ほかのウィンドウからの知らせを受ける(自分が出したものは除く) */
export function onBroadcast<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  const me = windowLabel()
  return listen<{ from: string; payload: T }>(event, (e) => {
    if (e.payload.from !== me) cb(e.payload.payload)
  })
}

// ── 道具のウィンドウ → メイン の頼みごと ──

export interface MainRpcRequest {
  id: number
  from: string
  kind: string
  payload: unknown
}
type MainRpcDone = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }
let rpcSeq = 0

/** メインに頼んで、結果をもらう */
export async function callMain<T>(kind: string, payload?: unknown): Promise<T> {
  const id = ++rpcSeq
  let settle!: (done: MainRpcDone) => void
  const result = new Promise<T>((resolve, reject) => {
    settle = (d) => (d.ok ? resolve(d.result as T) : reject(new Error(d.error)))
  })
  const off = await listen<MainRpcDone>('main-rpc-done', (e) => {
    if (e.payload.id !== id) return
    off()
    settle(e.payload)
  })
  void emitTo('main', 'main-rpc', { id, from: windowLabel(), kind, payload } satisfies MainRpcRequest)
  return result
}

/** メインで、頼みごとを受けて返す */
export function serveMain(handlers: Record<string, (payload: never) => Promise<unknown> | unknown>): Promise<UnlistenFn> {
  return listen<MainRpcRequest>('main-rpc', async (e) => {
    const { id, from, kind, payload } = e.payload
    const h = handlers[kind]
    let done: MainRpcDone
    try {
      if (!h) throw new Error(`できない頼みごとです: ${kind}`)
      done = { id, ok: true, result: await h(payload as never) }
    } catch (err) {
      done = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    await emitTo(from, 'main-rpc-done', done)
  })
}
