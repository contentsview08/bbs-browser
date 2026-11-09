// 表示スタイルの画面(︙ の「表示スタイル」): 見た目(テーマ・差し色・レスの見た目)・文字と余白・レスの表示を、上のタブで切り替える 1 つの画面にまとめる。
// 変えた結果を後ろのスレで見ながら合わせられるよう、後ろは暗くしない。
// PC は題の帯をつかんで動かせる窓(置き場所は覚える。外を押しても閉じず、× と Esc で閉じる)。
// スマホは下から半分ほどのシート(上にスレが見える。スマホ版の StyleSheet と同じ形・同じ順)

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { isMobile } from '../utils/platform'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { useDialogRect } from '../hooks/useDialogRect'
import { SliderDragScope, useSliderDragScope } from './FontSizeSlider'
import { DialogHeader } from './DialogParts'
import { Toggle } from './SettingParts'
import { COLOR_SCHEMES, ACCENTS, ID_POSITIONS, ID_STYLES, isDarkScheme, MOBILE_POST_STYLES, POST_STYLES, effectivePostStyle, effectiveScheme, pickSchemeNow, type AppSettings, type UpdateSetting } from '../ui/settings'

const LABEL = isMobile ? 'px-[16px] pt-[10px] pb-[6px] text-[12px] font-bold text-c-text-muted' : 'px-4 pt-3 pb-1.5 text-[11px] font-bold text-c-text-muted tracking-wide'

/** テーマ: 丸い見本(帯・地・文字・差し色を小さく描く)に名前を添える。見本ごとに data-scheme を付けるので、色は配色の CSS そのもの */
function SchemeTiles({ settings, update }: { settings: AppSettings; update: UpdateSetting }) {
  const current = effectiveScheme(settings)
  const rowRef = useRef<HTMLDivElement>(null)
  // スマホ(横に流す並び): 開いたときに、いま使っている配色が見える所から
  useEffect(() => {
    if (!isMobile) return
    rowRef.current?.querySelector<HTMLElement>('[data-on]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [])
  return (
    <div ref={rowRef} className={isMobile ? 'flex gap-[2px] px-[10px] overflow-x-auto no-scrollbar' : 'flex flex-wrap gap-y-1 px-2'}>
      {COLOR_SCHEMES.map((s) => {
        const on = current === s.key
        return (
          <button
            key={s.key}
            type="button"
            data-on={on ? '' : undefined}
            onClick={() => {
              for (const [k, v] of Object.entries(pickSchemeNow(settings, s.key))) update(k as keyof AppSettings, v as never)
            }}
            title={s.name}
            className={`flex-shrink-0 flex flex-col items-center rounded-lg ${isMobile ? 'w-[68px] py-[4px] active:bg-c-surface2' : 'w-[4.25rem] py-1 hover:bg-c-surface2'}`}
          >
            {/* 選んでいる配色は、外に差し色の輪 */}
            <span className="rounded-full p-[3px]" style={{ boxShadow: on ? 'inset 0 0 0 2.5px var(--c-accent)' : undefined }}>
              <span
                data-scheme={s.key}
                className={`relative block rounded-full overflow-hidden ${isMobile ? 'w-[38px] h-[38px]' : 'w-9 h-9'}`}
                style={{ background: 'var(--c-base)', boxShadow: `inset 0 0 0 1px ${s.border}` }}
              >
                <span className="absolute inset-x-0 top-0 h-[30%]" style={{ background: 'var(--c-header-footer)' }} />
                <span className="absolute left-1/2 top-[46%] -translate-x-1/2 w-[45%] h-[10%] rounded-sm" style={{ background: 'var(--c-text-muted)', opacity: 0.7 }} />
                <span className="absolute left-1/2 bottom-[14%] -translate-x-1/2 w-[24%] h-[24%] rounded-full" style={{ background: 'var(--c-accent)' }} />
              </span>
            </span>
            <span className={`mt-0.5 px-0.5 w-full text-center leading-tight line-clamp-2 break-all ${isMobile ? 'text-[10px]' : 'text-[0.6875rem]'} ${on ? 'font-bold text-c-text-strong' : 'text-c-text-muted'}`}>{s.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 差し色(スマホのアプリ・hono-bbs の web と同じ 8 色)。左端の「テーマ」はテーマの色に戻す */
function AccentDots({ settings, update }: { settings: AppSettings; update: UpdateSetting }) {
  const current = effectiveScheme(settings)
  const dark = isDarkScheme(current)
  return (
    <div className={isMobile ? 'flex gap-[6px] px-[12px] overflow-x-auto no-scrollbar' : 'flex flex-wrap gap-1 px-3'}>
      {[{ key: '', name: 'テーマ', color: '' }, ...ACCENTS.map((a) => ({ key: a.key, name: a.name, color: dark ? a.dark : a.light }))].map((a) => {
        const on = settings.accent === a.key
        return (
          <button
            key={a.key || 'theme'}
            type="button"
            onClick={() => update('accent', a.key)}
            title={a.name}
            className={`flex-shrink-0 flex flex-col items-center gap-1 rounded-lg ${isMobile ? 'px-[4px] py-[2px] active:bg-c-surface2' : 'w-11 py-1 hover:bg-c-surface2'}`}
          >
            <span
              data-scheme={a.key ? undefined : current}
              className={`rounded-full ${isMobile ? 'w-[28px] h-[28px]' : 'w-6 h-6'}`}
              style={{ background: a.color || 'var(--c-accent)', border: on ? `${isMobile ? 3 : 2}px solid var(--c-text-strong)` : '1px solid var(--c-border)' }}
            />
            <span className={`text-[10px] leading-none whitespace-nowrap ${on ? 'text-c-text-strong' : 'text-c-text-muted'}`}>{a.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** レスの見た目: 名前の札を並べる(説明は札に乗せる) */
function PostStyleChips({ settings, update }: { settings: AppSettings; update: UpdateSetting }) {
  const current = effectivePostStyle(settings)
  return (
    <div className={isMobile ? 'flex gap-[6px] px-[16px] py-[4px] overflow-x-auto no-scrollbar' : 'flex flex-wrap gap-1.5 px-4 pb-1'}>
      {(isMobile ? MOBILE_POST_STYLES : POST_STYLES).map((b) => {
        const on = current === b.key
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => update('postStyle', b.key)}
            title={b.note}
            className={`flex-shrink-0 rounded-full border whitespace-nowrap ${isMobile ? 'px-[11px] py-[7px] text-[13px]' : 'px-3 py-1 text-xs'} ${on ? 'font-bold' : 'text-c-text-body hover:border-c-border-strong'}`}
            style={on ? { background: 'var(--c-accent)', borderColor: 'var(--c-accent)', color: 'var(--c-accent-text)' } : { background: 'var(--c-surface2)', borderColor: 'var(--c-border)' }}
          >
            {/* スマホは狭いので、名前の括弧の中の説明は省く */}
            {isMobile ? b.name.replace(/[(（].*$/, '') : b.name}
          </button>
        )
      })}
    </div>
  )
}

/** 画面の上のタブ。最後に開いたタブはこの端末に覚える(同期しない) */
type StyleTab = 'look' | 'size' | 'post'
const TAB_KEY = 'bbs:style-dialog-tab'
function loadTab(): StyleTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'size' || v === 'post' ? v : 'look'
  } catch {
    return 'look'
  }
}
function saveTab(t: StyleTab) {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch {
    // 覚えられなくても困らない(次は「見た目」から開く)
  }
}

/** 選択肢を札で並べる(レスの表示のタブ) */
function ChoiceChips<T extends string>(props: { label: string; value: T; options: { key: T; name: string; note?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className={isMobile ? 'px-[16px] py-[8px]' : 'px-4 py-1.5'}>
      <p className={isMobile ? 'text-[15px] text-c-text-strong mb-[6px]' : 'text-sm text-c-text-body mb-1'}>{props.label}</p>
      <div className="flex flex-wrap gap-1.5">
        {props.options.map((o) => {
          const on = props.value === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => props.onChange(o.key)}
              title={o.note}
              className={`rounded-full border whitespace-nowrap ${isMobile ? 'px-[11px] py-[6px] text-[13px]' : 'px-3 py-1 text-xs'} ${on ? 'font-bold' : 'text-c-text-body hover:border-c-border-strong'}`}
              style={on ? { background: 'var(--c-accent)', borderColor: 'var(--c-accent)', color: 'var(--c-accent-text)' } : { background: 'var(--c-surface2)', borderColor: 'var(--c-border)' }}
            >
              {o.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** レスの表示: 設定の「レス表示」の名前と ID・本文・日時の項目(言葉も設定の画面と同じ。設定の画面にも残してある) */
function PostDisplayItems({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  return (
    <div className={isMobile ? '' : 'py-1'}>
      <div className={isMobile ? 'px-[16px]' : 'px-4'}>
        <Toggle checked={s.omitNoname} onChange={(v) => update('omitNoname', v)} label="名無しの名前を省く" />
        <Toggle checked={s.nameSubtle} onChange={(v) => update('nameSubtle', v)} label="名前欄を目立たなくする" />
      </div>
      <ChoiceChips label="ID の見せ方" value={s.idStyle} options={ID_STYLES} onChange={(v) => update('idStyle', v)} />
      <div className={isMobile ? 'px-[16px]' : 'px-4'}>
        <Toggle checked={s.idShort} onChange={(v) => update('idShort', v)} label="ID を短く出す" />
      </div>
      <ChoiceChips label="ID の位置" value={s.idPosition} options={ID_POSITIONS} onChange={(v) => update('idPosition', v)} />
      <ChoiceChips
        label="日時の出し方"
        value={s.dateStyle}
        options={[
          { key: 'md_w_hms' as const, name: '11/02(月) 19:01:15' },
          { key: 'md_hm' as const, name: '11/02 19:01' },
          { key: 'full' as const, name: '2026/11/02(月) 19:01:15.032' },
        ]}
        onChange={(v) => update('dateStyle', v)}
      />
      <div className={isMobile ? 'px-[16px]' : 'px-4'}>
        <Toggle checked={s.watchoiShort} onChange={(v) => update('watchoiShort', v)} label="ワッチョイを短く出す" />
        <Toggle checked={s.iconFromWatchoi} onChange={(v) => update('iconFromWatchoi', v)} label="ワッチョイがあるときは、アイコンをワッチョイから作る" />
        <Toggle checked={s.highlightOp} onChange={(v) => update('highlightOp', v)} label="スレ主に「主」の印" />
        <Toggle checked={s.tidyBlankLines} onChange={(v) => update('tidyBlankLines', v)} label="空行を整える" />
        <Toggle checked={s.urlShorten} onChange={(v) => update('urlShorten', v)} label="URL を短く見せる" />
      </div>
    </div>
  )
}

/**
 * 表示スタイルの画面。上のタブで 見た目(テーマ・差し色・レスの見た目)・文字と余白(sliders)・レスの表示 を切り替える。
 * sliders は「文字と余白」の中身(スレ表示ならレスの、スレ一覧なら一覧のスライダー)。
 * from: どこから開いたか。スレ一覧からは、レスに関わるもの(レスの見た目・レスの表示)を出さない。
 * PC の窓は、初めはその反対の側に出し、置き場所はそれぞれ覚える
 */
export function StyleDialog(props: { settings: AppSettings; update: UpdateSetting; sliders: ReactNode; from: 'list' | 'thread'; onClose: () => void }) {
  const { settings, update } = props
  const boxRef = useRef<HTMLDivElement>(null)
  // スマホは後ろを覆うシートなので、ほかの窓と同じくフォーカスを中に留める(Android の戻るも data-modal を見て閉じる)。
  // PC は後ろも触れる窓なので留めない(留めると data-modal でスレ表示のキー操作が止まり、↑↓・Tab も窓に取られる)。Esc で閉じるだけ
  useFocusTrap(isMobile ? boxRef : NO_BOX, props.onClose)
  useEscClose(!isMobile, props.onClose)
  // スライダーをつかんでいる間は、つかんでいる行だけを残して画面を見えなくする(後ろの変わり方を見られるように)
  const { active, scope } = useSliderDragScope()
  const thread = props.from === 'thread'
  const tabs: { key: StyleTab; name: string }[] = [
    { key: 'look', name: 'スキン' },
    { key: 'size', name: '文字と余白' },
    ...(thread ? [{ key: 'post' as const, name: 'レスの表示' }] : []),
  ]
  const [tab, setTab] = useState<StyleTab>(loadTab)
  const shown = tabs.some((t) => t.key === tab) ? tab : 'look'
  const tabBar = (
    <div role="tablist" className="flex-shrink-0 flex border-b border-c-border">
      {tabs.map((t) => {
        const on = shown === t.key
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              setTab(t.key)
              saveTab(t.key)
            }}
            className={`flex-1 border-b-2 -mb-px ${isMobile ? 'py-[10px] text-[14px]' : 'py-2 text-sm'} ${on ? 'font-bold text-c-text-strong' : 'border-transparent text-c-text-muted hover:text-c-text-body'}`}
            style={on ? { borderColor: 'var(--c-accent)' } : undefined}
          >
            {t.name}
          </button>
        )
      })}
    </div>
  )
  const body =
    shown === 'look' ? (
      <>
        <p className={LABEL}>カラーテーマ</p>
        <SchemeTiles settings={settings} update={update} />
        <p className={LABEL}>差し色</p>
        <AccentDots settings={settings} update={update} />
        {thread && (
          <>
            <p className={LABEL}>レスの見た目</p>
            <PostStyleChips settings={settings} update={update} />
          </>
        )}
      </>
    ) : shown === 'size' ? (
      <div className={isMobile ? 'pt-[4px]' : 'pt-1'}>{props.sliders}</div>
    ) : (
      <PostDisplayItems settings={settings} update={update} />
    )
  return createPortal(
    <SliderDragScope scope={scope}>
      {isMobile ? (
        <MobileSheet boxRef={boxRef} hidden={active} tabs={tabBar} onClose={props.onClose}>
          {body}
        </MobileSheet>
      ) : (
        <DesktopWindow boxRef={boxRef} hidden={active} from={props.from} tabs={tabBar} onClose={props.onClose}>
          <div className="pb-3">{body}</div>
        </DesktopWindow>
      )}
    </SliderDragScope>,
    document.body,
  )
}

/** useFocusTrap に渡す、何も指さない箱(PC の窓では留めない) */
const NO_BOX: RefObject<HTMLDivElement | null> = { current: null }

/**
 * Esc で閉じる(PC の表示スタイルの窓)。後ろのスレ表示も Esc を使う(ポップアップを閉じるなど)ので、先に受けて止める。
 * 上にダイアログ・画像のビューアーが開いていれば、Esc はそちらのもの
 */
function useEscClose(enabled: boolean, onClose: () => void) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      if (document.querySelector('[data-modal], [data-lightbox]')) return
      // 後ろの文字を打つ欄(検索欄など)の Esc は、その欄のもの
      if ((e.target as HTMLElement).matches?.('input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, onClose])
}

/** PC: 題の帯をつかんで動かせる窓。後ろは暗くせず、後ろの画面もそのまま触れる */
function DesktopWindow(props: { boxRef: RefObject<HTMLDivElement | null>; hidden: boolean; from: 'list' | 'thread'; tabs: ReactNode; onClose: () => void; children: ReactNode }) {
  // スレ一覧は左、スレは右にあることが多いので、変わっていく側が隠れないように反対の側に出す
  const win = useDialogRect(`bbs:style-dialog-rect:${props.from}`, { w: 440, h: 560, minW: 320, minH: 200, place: props.from === 'list' ? 'right' : 'left' })
  const width = Math.min(440, window.innerWidth - 16)
  return (
    <div
      ref={props.boxRef}
      className="fixed z-[9800] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl overflow-hidden rise-in"
      style={{
        left: Math.max(8, Math.min(win.rect.x, window.innerWidth - width - 8)),
        top: win.rect.y,
        width,
        maxHeight: `calc(100vh - ${win.rect.y}px - 8px)`,
        ...(props.hidden ? { visibility: 'hidden' as const } : {}),
      }}
    >
      {/* 基本の文字を変えても、窓の中の字と大きさは変えない(動かしているスライダーが逃げないように) */}
      <div className="flex-1 min-h-0 flex flex-col" style={{ zoom: 'var(--dialog-zoom, 1)' }}>
        <div className="cursor-move select-none" onMouseDown={win.startMove} title="つかんで動かす">
          <DialogHeader title="表示スタイル" onClose={props.onClose} />
        </div>
        {props.tabs}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">{props.children}</div>
      </div>
    </div>
  )
}

/** スマホ: 下から半分ほどのシート。外(上に見えている画面)を押すか、つまみを下へなぞると閉じる */
function MobileSheet(props: { boxRef: RefObject<HTMLDivElement | null>; hidden: boolean; tabs: ReactNode; onClose: () => void; children: ReactNode }) {
  const backdrop = useBackdropClose(props.onClose)
  // つまみを下へずらした量(px)
  const [drag, setDrag] = useState(0)
  /** つまみを押した所(つかんでいない間は null) */
  const [start, setStart] = useState<number | null>(null)
  const grip = {
    onPointerDown: (e: ReactPointerEvent) => {
      setStart(e.clientY)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (start !== null) setDrag(Math.max(0, e.clientY - start))
    },
    onPointerUp: () => {
      setStart(null)
      // 3 割より下へずらしていたら閉じる。足りなければ戻す
      const h = props.boxRef.current?.offsetHeight ?? 0
      if (drag > h * 0.3) props.onClose()
      else setDrag(0)
    },
  }
  return (
    <div className="fixed inset-0 z-[9800] flex items-end" {...backdrop}>
      <div
        ref={props.boxRef}
        className="w-full flex flex-col bg-c-surface border-t border-c-border rounded-t-[16px] shadow-[0_-8px_24px_rgba(0,0,0,0.25)] sheet-rise"
        style={{
          // よく使う上の 3 つ(テーマ・差し色・レスの見た目)が最初に収まる高さで、上には画面が半分ほど見えるように
          height: 'min(calc(100dvh - 80px), max(50dvh, 380px))',
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: start === null ? 'transform 150ms' : undefined,
          ...(props.hidden ? { visibility: 'hidden' as const } : {}),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 h-[22px] flex items-center justify-center touch-none" {...grip}>
          <span className="w-[36px] h-[4px] rounded-full bg-c-text-muted opacity-45" />
        </div>
        {props.tabs}
        <div className="flex-1 min-h-0 overflow-y-auto pb-[12px]" style={{ lineHeight: '21px' }}>
          {props.children}
        </div>
      </div>
    </div>
  )
}
