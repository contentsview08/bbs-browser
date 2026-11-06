// Ctrl + ホイールで文字の大きさを変える(PC)
import { useEffect, useRef, type MutableRefObject } from 'react'
import { FONT_PX_MAX, FONT_PX_MIN, applyCssVar, baseFontPx, type AppSettings, type UpdateSetting } from '../ui/settings'

/** 回し終えてから、文字の大きさを設定に書くまで待つ時間 */
const WHEEL_ZOOM_COMMIT_MS = 300
/** 大きさの表示を、回し終えてから消すまでの時間 */
const WHEEL_ZOOM_HINT_MS = 900

/**
 * Ctrl + ホイール: キーを受け取っている方(スレ一覧かスレ表示)の文字の大きさを 1px ずつ変える(WebView の画面ごとの拡大は止める)。
 * 刻みは溜めて処理する: 刻みごとに設定を書き換えると、そのたびにアプリ全体の描き直しと DB 書き込みの予約が走って重い。
 * 見た目は CSS の変数だけをコマごと(requestAnimationFrame)にまとめて変え、設定に書くのは回し終えて少し経ってから 1 回
 * 返すのは、回している間に大きさを出す要素に付ける ref。
 */
export function useWheelZoom(
  listFocused: boolean,
  updateSetting: UpdateSetting,
  settingsRef: MutableRefObject<AppSettings>,
) {
  const wheelZoom = useRef({
    listFocused,
    acc: 0,
    update: updateSetting,
    /** まだ設定に書いていない大きさ(px)。回している間はこれが本当の値 */
    pending: undefined as { key: 'listFontPx' | 'postBodyPx'; px: number } | undefined,
    frame: 0,
    commitTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    hintTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  })
  /** Ctrl+ホイールで回している間に出す、いまの大きさの表示 */
  const zoomHintRef = useRef<HTMLDivElement>(null)
  wheelZoom.current.listFocused = listFocused
  // DB を開くと設定を変える関数が替わるので、いつも新しい方を使う
  wheelZoom.current.update = updateSetting
  useEffect(() => {
    const z = wheelZoom.current
    /** 溜めた大きさを設定に書く(回し終えたとき・Ctrl を離したとき) */
    const commit = () => {
      if (z.commitTimer) clearTimeout(z.commitTimer)
      z.commitTimer = undefined
      const p = z.pending
      z.pending = undefined
      if (p) z.update(p.key, p.px)
    }
    /** 溜めた大きさを画面に映す(1 コマに 1 回)。回している間は、いまの大きさを小さく出す(ブラウザの拡大の表示と同じ。React の状態は触らない) */
    const paint = () => {
      z.frame = 0
      const p = z.pending
      if (!p) return
      if (p.key === 'listFontPx') applyCssVar('--list-zoom', String(p.px / baseFontPx(settingsRef.current)))
      else applyCssVar('--post-body-size', `${p.px}px`)
      const hint = zoomHintRef.current
      if (hint) {
        hint.textContent = `${p.key === 'listFontPx' ? 'スレ一覧の文字' : 'レスの本文'} ${p.px}px`
        hint.style.opacity = '1'
        if (z.hintTimer) clearTimeout(z.hintTimer)
        z.hintTimer = setTimeout(() => (hint.style.opacity = '0'), WHEEL_ZOOM_HINT_MS)
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      // タッチパッドの細かい動きは、たまってから 1 段
      z.acc += e.deltaY
      if (Math.abs(z.acc) < 60) return
      const step = z.acc < 0 ? 1 : -1
      z.acc = 0
      const s = settingsRef.current
      const base = baseFontPx(s)
      const key = z.listFocused ? 'listFontPx' : 'postBodyPx'
      // 一覧とスレ表示を行き来したら、前の方の分を先に書く
      if (z.pending && z.pending.key !== key) commit()
      const cur = z.pending?.px ?? (s[key] || base)
      const px = Math.min(FONT_PX_MAX, Math.max(FONT_PX_MIN, cur + step))
      if (px === cur) return
      z.pending = { key, px }
      if (!z.frame) z.frame = requestAnimationFrame(paint)
      if (z.commitTimer) clearTimeout(z.commitTimer)
      z.commitTimer = setTimeout(commit, WHEEL_ZOOM_COMMIT_MS)
    }
    // 受け口は Ctrl を押している間だけ付ける。いつも付けておくと(passive でないので)、ホイールのたびにブラウザが JS の返事を待ってから
    // スクロールすることになり、画面の外でなめらかにスクロールする仕組みが効かなくなる(重く感じる)
    let on = false
    const attach = () => {
      if (on) return
      on = true
      window.addEventListener('wheel', onWheel, { passive: false })
    }
    const detach = () => {
      if (!on) return
      on = false
      z.acc = 0
      commit()
      window.removeEventListener('wheel', onWheel)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') attach()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || !e.ctrlKey) detach()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', detach)
    return () => {
      detach()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', detach)
    }
  }, [])
  return zoomHintRef
}
