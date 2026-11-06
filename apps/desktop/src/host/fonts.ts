// 書体。取得したファイルはアプリのデータフォルダに置き(src-tauri/src/fonts.rs)、次の起動からは取りに行かない。
// 既定の「Windows 標準」は OS の書体なので、何も取りに行かない。取得が終わるまでは、CSS の後ろの OS の書体で出る
import { useEffect, useSyncExternalStore } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { fontNeedsDownload, fontStatesOf, localFontCss, reduceFontStates, type FontEvent, type FontState, type FontStates, type FontStatus } from '../utils/fontDownload'

/** 取得の仕組みがあるか(web 版は false) */
export const FONT_DOWNLOADS = true
export const FONT_NOTE = '選ぶと取得を始め、終わると切り替わります。取得したものは次からすぐ使えます'

const EVENT = 'font-download'

let states: FontStates = {}
const subscribers = new Set<() => void>()
function setStates(next: FontStates) {
  states = next
  subscribers.forEach((f) => f())
}

/** このウィンドウで使う書体(取得が終わったら CSS を入れる) */
const wanted = new Set<string>()
const injected = new Map<string, Promise<boolean>>()
/** 自動の取得は起動ごとに 1 回(設定が変わるたびに取りに行かない) */
const autoTried = new Set<string>()

let started = false
function start() {
  if (started) return
  started = true
  void listen<FontEvent>(EVENT, (e) => {
    setStates(reduceFontStates(states, e.payload))
    if (e.payload.state === 'done' && wanted.has(e.payload.key)) void injectFont(e.payload.key)
  })
  void invoke<FontStatus>('font_status').then((status) => setStates({ ...fontStatesOf(status), ...states }))
}

/** 取得済みなら CSS を入れる。なければ false */
function injectFont(key: string): Promise<boolean> {
  const inFlight = injected.get(key)
  if (inFlight) return inFlight
  const p = invoke<{ css: string; dir: string } | null>('font_css', { key }).then((font) => {
    if (!font) {
      injected.delete(key)
      return false
    }
    const style = document.createElement('style')
    style.dataset.font = key
    style.textContent = localFontCss(font.css, font.dir, convertFileSrc)
    document.head.appendChild(style)
    return true
  })
  injected.set(key, p)
  p.catch(() => injected.delete(key))
  return p
}

/** 選んである書体を使えるようにする。取得済みでなければ裏で取りに行く(切り替わるのではなく、選んである書体が出るようになる) */
export function ensureFont(key: string): void {
  if (!fontNeedsDownload(key) || typeof document === 'undefined') return
  start()
  wanted.add(key)
  void injectFont(key).then((ok) => {
    if (ok || autoTried.has(key)) return
    autoTried.add(key)
    void invoke('download_font', { key, switchTo: false }).catch(() => undefined)
  })
}

/** 書体の行の状態。取得済みの行は、その書体で描けるように CSS を入れる */
export function useFontStates(): FontStates {
  const value = useSyncExternalStore(
    (f) => {
      start()
      subscribers.add(f)
      return () => subscribers.delete(f)
    },
    () => states,
  )
  useEffect(() => {
    for (const [key, st] of Object.entries(value)) if (st.kind === 'ready') void injectFont(key).catch(() => undefined)
  }, [value])
  return value
}

/**
 * 行で書体を選んだとき。使えるならすぐ useNow を呼び、なければ取得を始める(終わるとメインのウィンドウが切り替える)。
 * 前に選んで取得中のものは、選び直されたので止める
 */
export function chooseFont(key: string, useNow: () => void): void {
  const st: FontState = states[key] ?? { kind: 'none' }
  if (!fontNeedsDownload(key) || st.kind === 'ready') {
    for (const [other, s] of Object.entries(states)) if (other !== key && s.kind === 'running' && s.switchTo) cancelFontDownload(other)
    useNow()
    return
  }
  setStates({ ...states, [key]: { kind: 'running', done: 0, total: 0, switchTo: true } })
  void invoke('download_font', { key, switchTo: true }).catch((e: unknown) =>
    setStates({ ...states, [key]: { kind: 'failed', error: e instanceof Error ? e.message : String(e) } }),
  )
}

export function cancelFontDownload(key: string): void {
  void invoke('cancel_font_download', { key }).catch(() => undefined)
}

/** 選んだ書体の取得が終わったとき(メインのウィンドウだけが受けて、設定を変える) */
export function onFontSwitch(cb: (key: string) => void): Promise<UnlistenFn> {
  return listen<FontEvent>(EVENT, (e) => {
    if (e.payload.state === 'done' && e.payload.switchTo) void injectFont(e.payload.key).then(() => cb(e.payload.key))
  })
}
