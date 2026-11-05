// レス 1 件。web 版の PostArticle.tsx の見た目を移植。
// 返信・削除・通報など、web 版の API に依存する機能は外している。

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post, PostActionDef, ReactionDef } from '@bbs-browser/connectors'
import BadgeChip from './BadgeChip'
import ActionSheet, { type SheetItem } from './ActionSheet'
import { useLongPress } from '../hooks/useLongPress'
import { isMobile } from '../utils/platform'
import {
  anchorTargets,
  displayBody,
  displayName,
  dropLeadingAnchor,
  heatClass,
  heatVar,
  cardUrlsIn,
  looksLikeAA,
  renderBody,
  mediaIn,
  type BodyHandlers,
  type DisplayOptions,
} from '../utils/postBody'
import LinkPreview from './LinkPreview'
import LocalAddressMark from './LocalAddressMark'
import { isAutoLoadable } from '../utils/safeUrl'
import { newRule, todayDateString, type NgRule, type NgTarget } from '../utils/ng'
import type { HeatStyle, IdPosition, NgMode, PostDoubleClick } from '../ui/settings'
import { watchoiOf } from '../utils/watchoi'
import { idColorOf } from '../utils/idColor'
import { displayDate, displayId, type DateStyle } from '../utils/displayDate'
import Identicon from './Identicon'
import { reasonLabel, type AutoNgReason } from '../utils/autoNg'
import { aiHitLabel, type AiNgHit } from '../utils/aiNg'
import { mediaSrc } from '../utils/httpsFirst'
import { ThumbImage } from './MediaFailed'

export interface PostHandlers extends BodyHandlers {
  /** 画像・動画のサムネイルをすぐ読みに行くか(false なら枠だけ出し、押したら読む。設定の thumbLoad) */
  thumbAuto?: boolean
  /** ID ごとに色を付ける(設定 idColor)。dark は暗い配色か、sky は空色の地(LINE ライトの LINE 風)か。付けないときは undefined */
  idColor?: { dark: boolean; sky: boolean }
  /** 人気のレス(返信 3 件から)の示し方(設定 heatStyle)。既定は左の帯 */
  heatStyle?: HeatStyle
  /** レスをダブルタップで返信する(設定 doubleTapReply。スマホ)。オンだと 1 回のタップ(ツリーを開く)は少し遅れる */
  doubleTapReply?: boolean
  /** PC: ダブルクリックの操作(設定 postDoubleClick)。none か未指定なら、1 回の押しですぐツリー */
  doubleClick?: PostDoubleClick
  /** 頭の日時の出し方・ID を短く出すか(設定 dateStyle・idShort) */
  dateStyle?: DateStyle
  idShort?: boolean
  /** ID の位置(設定): 日時の後ろ(既定)・レスの右上・レスの右下 */
  idPosition?: IdPosition
  /** アイコンの種を、ワッチョイがあればワッチョイから作る */
  iconFromWatchoi?: boolean
  /** 名前欄(ワッチョイ込み)を日付・ID と同じ薄い色・大きさにする。false なら名前の色で目立たせる */
  nameSubtle?: boolean
  /** レス番号を押した(このレスへの返信を出す) */
  onReplies: (no: number, el: HTMLElement) => void
  /** ID を押した(その ID の書き込みを出す) */
  onId: (id: string, el: HTMLElement) => void
  /** ワッチョイから作ったアイコンを押した(同じワッチョイの書き込みを出す) */
  onWatchoi?: (watchoi: string, el: HTMLElement) => void
  /** 名前を押した(同じ名前の書き込みを出す) */
  onName: (name: string, el: HTMLElement) => void
  /** 本文を押した(アンカーツリーを出す。つながりがなければ何もしない) */
  onBody: (no: number, el: HTMLElement) => void
  onImage: (urls: string[], index: number, post: Post) => void
  onAddNg: (rule: NgRule) => void
  /** このレスに当たっている NG */
  ngHits?: (post: Post) => { posterId: NgRule[]; posterName: NgRule[]; content: NgRule[] }
  /** NG を消す */
  onRemoveNg?: (rules: NgRule[]) => void
  /** NG の画面を、その NG を直す形で開く */
  onEditNg?: (rule: NgRule, values: Partial<Record<NgTarget, string>>) => void
  /** 書き込み欄に >>番号 を入れる。書き込めないときは undefined */
  onReply?: (no: number) => void
  /** 自分の書き込みを消す。消せない掲示板は undefined */
  onDeletePost?: (post: Post) => void
  /** 自分のレスの印を手で付ける・外す。sameId なら、このスレの同じ ID のレスすべてに */
  onMarkOwn?: (post: Post, own: boolean, sameId: boolean) => void
  /** レスへの反応を押す(ふたばの「そうだね」など)。押せない掲示板は undefined */
  onReact?: (post: Post, reactionId: string) => void
  /** レスへの反応の種類(コネクタの reactions)。数だけ出して押せない掲示板もある */
  reactionDefs?: ReactionDef[]
  /** レスへの操作(通報など)。操作のない掲示板は undefined */
  onPostAction?: (post: Post, actionId: string) => void
  /** レスへの操作の種類(コネクタの postActions)。「その他」のメニューに並べる */
  postActions?: PostActionDef[]
  /** NG の画面を、元の文字を入れた状態で開く */
  onNgDraft?: (
    target: 'content' | 'posterName' | 'posterId' | 'threadTitle',
    text: string,
    values?: Partial<Record<'content' | 'posterName' | 'posterId' | 'threadTitle', string>>,
  ) => void
  /** >>番号 を付けてすぐ書き込む(「草」ボタン)。書き込めないときは undefined */
  onQuickReply?: (no: number, text: string) => void
  /** 自動 NG の印を付ける(true: 荒らし、false: 荒らしじゃない、null: 外す)。reason は付けたときの自動 NG の理由 */
  onMarkTroll?: (post: Post, troll: boolean | null, reason?: string) => void
  /** AI NG の手の印を付ける(hit: 当たる・miss: 当たらない・null: 外す)。AI NG を使っていなければ undefined */
  onMarkAi?: (post: Post, ruleId: string, mark: 'hit' | 'miss' | null) => void
  /** いま効いている AI NG の条件(メニューの「〜に当たる」に並べる) */
  aiRules?: { id: string; name: string }[]
}

interface Props {
  post: Post
  anchorCount: number
  idCount: number
  /** アイコンの右下の数字(設定でワッチョイを使うなら、ワッチョイごとの書き込み数) */
  iconCount?: number
  showTopDivider: boolean
  ng: boolean
  /** 自動 NG で畳んだときの理由(ユーザーの NG に当たっていなくても ng は true になる) */
  autoNg?: AutoNgReason
  /** AI NG の見せ方が「印だけ」の条件に当たった(中身は出し、頭に印を付ける) */
  aiMark?: AiNgHit
  ngMode: NgMode
  showThumbnails: boolean
  showIdenticon?: boolean
  showLinkPreview?: boolean
  /** 名無しの省略・空行の扱い */
  display?: DisplayOptions
  /** スレ主(>>1 と同じ ID)の書き込み */
  isOp?: boolean
  /** 操作バーに並べるもの(設定の postToolbar)と、定型文 */
  toolbar?: string[]
  phrases?: string[]
  /** 自動更新などで新しく届いたレス。一瞬光らせる */
  flash?: boolean
  /** 自分の書き込み */
  isOwn?: boolean
  /** 自分の書き込みへのアンカーを含む */
  isReplyToOwn?: boolean
  handlers: PostHandlers
  /** 見た目のスタイル。card: いまの区切り線の並び / discord: 丸いアイコンと平らな並び / classic: 専ブラ風の 1 行の頭 */
  variant?: PostVariant
  /** Discord 風・LINE 風: 直前のレスと同じ ID(続けて書いた)。アイコンと頭を省く */
  continued?: boolean
  /** Discord 風・LINE 風: 本文の先頭のアンカーの引用元(番号と本文の頭) */
  replyPreview?: { no: number; text: string; id?: string }
  /** アンカーツリーの中のレス。LINE 風は自分の書き込みも左にそろえ、どのスタイルでも左端の縦の印(自分・自分宛て)を出さない
   *  (ツリーの線と重なって見にくいため。つながりはツリーの線で分かる) */
  alignLeft?: boolean
  /** ほかの人からの評価の数と呼び名(ふたばの「そうだね」)。0 や なしなら出さない */
  /** レスへの反応の数(反応の id → 数) */
  reactions?: Record<string, number>
  /** 「グロ」などの返信が付いたレス。サムネイルをぼかし、「グロ注意」と出す */
  blurMedia?: boolean
  /** 文章で引用する掲示板(ふたば)の、このレスの引用の行 → 引用元のレス番号。あれば「>文章」の行を緑の引用にする */
  quotes?: Map<string, number>
}

export type PostVariant = 'card' | 'discord' | 'classic' | 'line' | 'matome'

/** レスの頭の小さい字(ID など)。スマホは横幅が貴重なので、さらに小さく */
/** マウスを乗せたレスの操作バーの高さ(基本の文字が 16px のときの px) */
const TOOLBAR_H = 34
const HEAD_TEXT = isMobile ? 'text-[11px]' : 'text-xs'
/** ダブルタップで返信: 2 回目のタップを待つ時間(ms) */
const DOUBLE_TAP_MS = 280

/** Discord 風・LINE 風のアイコンの大きさ。スマホは画面が狭いので小さくする(アンカーツリーの段の幅も合わせる。AnchorTree.tsx) */
export const AVATAR = isMobile ? 28 : 36
/** アイコンと本文の隙間(px)。Discord 風の行の gap-2・gap-3 と同じ */
const AVATAR_GAP = isMobile ? 8 : 12
/**
 * アイコンの列・アイコンの大きさ。アイコン(Identicon)は px で描くので、列も px で決める
 * (文字の大きさに連動する rem で決めると、文字を小さくしたときに列だけ狭くなり、はみ出したアイコンが名前に重なる)
 */
const AVATAR_BOX = { width: AVATAR, height: AVATAR }
const AVATAR_COL = { width: AVATAR }

/** サムネイルを読み込んでいる間の印(サムネイルの真ん中で回る) */
function ThumbSpinner() {
  return (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="material-symbols-outlined text-xl text-c-text-muted animate-spin">progress_activity</span>
    </span>
  )
}

/** 日付を短くする(「2026/10/19(日) 12:34:56.78」→「10/19 12:34」)。読めない形ならそのまま */
function shortDate(date: string): string {
  const m = /(?:\d{2,4}\/)?(\d{1,2})\/(\d{1,2})[^\d]*?(\d{1,2}:\d{2})/.exec(date)
  return m ? `${m[1]}/${m[2]} ${m[3]}` : date
}

/**
 * スマホ: AA の字を、横幅に収まるまで小さくする(横にずらして読むと、スワイプの操作とぶつかるため)。
 * 一度もとの大きさに戻して測り、はみ出す分だけ縮める(読めなくならないよう 5px まで)。幅が変わったら測り直す
 */
function fitAA(el: HTMLElement | null) {
  if (!el) return
  // 使える幅は、レスの枠(article)の右端まで。LINE 風の吹き出しのように AA に合わせて広がる枠では、
  // AA の要素の幅を見ても「はみ出していない」になるため、外の枠で測る
  const box = el.closest('article') ?? el.parentElement
  const fit = () => {
    el.style.fontSize = ''
    // 縮めた結果がぴったりにならない(字の幅の丸め)ことがあるので、数回測り直す
    for (let i = 0; i < 4; i++) {
      const right = box ? box.getBoundingClientRect().right - parseFloat(getComputedStyle(box).paddingRight || '0') : Infinity
      const avail = Math.min(el.clientWidth, right - el.getBoundingClientRect().left)
      if (avail <= 0) return
      const over = el.scrollWidth / avail
      if (over <= 1.005) return
      el.style.fontSize = `${Math.max(5, (parseFloat(getComputedStyle(el).fontSize) / over) * 0.98)}px`
    }
  }
  fit()
  // 幅は画面の向き・ミニマップなどで変わり、AA 用のフォントはあとから読み込まれて字の幅が変わる。要素ごとに 1 回だけ見張る
  const tagged = el as AAElement
  tagged.aaFit = fit
  el.dataset.aaFit = ''
  watchFontLoads()
  if (!tagged.aaObserver) {
    let width = box?.clientWidth ?? el.clientWidth
    tagged.aaObserver = new ResizeObserver(() => {
      const w = box?.clientWidth ?? el.clientWidth
      if (w !== width) {
        width = w
        fit()
      }
    })
    tagged.aaObserver.observe(box ?? el)
  }
}

type AAElement = HTMLElement & { aaObserver?: ResizeObserver; aaFit?: () => void }
let watchingFonts = false
/** フォントを読み込み終えたら(AA 用のフォントは、AA を初めて描いたときに読み込まれる)、字を縮めた AA をすべて測り直す */
function watchFontLoads() {
  if (watchingFonts || !document.fonts) return
  watchingFonts = true
  document.fonts.addEventListener('loadingdone', () => {
    document.querySelectorAll<AAElement>('[data-aa-fit]').forEach((e) => e.aaFit?.())
  })
}

interface MenuItem {
  label: string
  icon: string
  /** 押すと、すぐ下に children を広げる項目では使わない */
  onClick?: () => void
  /** 押すと小項目を広げる(︙ の「NG」) */
  children?: MenuItem[]
}

const TOOL_BTN =
  'h-7 min-w-7 px-1.5 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/** メニューの置き場所(画面の座標) */
export type MenuPos = { top?: number; bottom?: number; left?: number; right?: number }

/** 右クリックした所に開く位置。画面からはみ出す向きなら、反対へ開く */
export function menuPosAt(x: number, y: number): MenuPos {
  const side = x + 264 > window.innerWidth ? { right: window.innerWidth - x } : { left: x }
  return y > window.innerHeight - 300 ? { ...side, bottom: window.innerHeight - y } : { ...side, top: y }
}

/** OS の標準のメニューに任せる右クリックか(入力欄・リンク・画像の上、文字を選んでいるとき。コピーや保存に使うため) */
export function wantsNativeMenu(e: React.MouseEvent): boolean {
  if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable], a[href], img, video')) return true
  return !!window.getSelection()?.toString().trim()
}

/**
 * 操作の一覧のメニュー(︙ のボタンと右クリックで共通)。レスのヘッダー行などははみ出しを隠す設定なので、body の直下に出す
 * (ポップアップの中のレスでも使えるよう、ポップアップより手前に出す)。外を押す・ホイール・Esc で閉じる
 */
export function FloatingMenu(props: { pos: MenuPos; items: MenuItem[]; onClose: () => void; ignore?: React.RefObject<HTMLElement | null> }) {
  const menuRef = useRef<HTMLDivElement>(null)
  /** 広げている小項目の親 */
  const [expanded, setExpanded] = useState<string>()
  const { onClose, ignore } = props
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !ignore?.current?.contains(t)) onClose()
    }
    const closeOnKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('wheel', onClose, { passive: true })
    window.addEventListener('keydown', closeOnKey, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('wheel', onClose)
      window.removeEventListener('keydown', closeOnKey, true)
    }
  }, [onClose, ignore])
  const { pos } = props
  return createPortal(
    <div
      ref={menuRef}
      className="fixed w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-[9800] text-sm overflow-y-auto"
      // 小項目を広げても画面からはみ出さないように
      style={{ ...pos, maxHeight: window.innerHeight - (pos.top ?? pos.bottom ?? 0) - 8 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {props.items.flatMap((it) => {
        const row = (x: MenuItem, sub = false) => (
          <button
            key={x.label}
            type="button"
            onClick={() => {
              if (x.children) return setExpanded(expanded === x.label ? undefined : x.label)
              x.onClick?.()
              onClose()
            }}
            className={`w-full flex items-center gap-2.5 ${sub ? 'pl-7 pr-3' : 'px-3'} py-1.5 text-c-text-body hover:bg-c-surface2 transition-colors`}
          >
            <span className="material-symbols-outlined text-base">{x.icon}</span>
            <span className="flex-1 text-left">{x.label}</span>
            {x.children && <span className="material-symbols-outlined text-base text-c-text-muted">{expanded === x.label ? 'expand_less' : 'expand_more'}</span>}
          </button>
        )
        return [row(it), ...(it.children && expanded === it.label ? it.children.map((c) => row(c, true)) : [])]
      })}
    </div>,
    document.body,
  )
}

/** 押すとメニューを出すボタン。メニューはボタンの位置から場所を決める */
export function MenuButton(props: { icon: string; title: string; items: MenuItem[]; onOpenChange: (open: boolean) => void; hoverClass?: string }) {
  const [pos, setPos] = useState<MenuPos>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { onOpenChange } = props
  useEffect(() => {
    onOpenChange(pos !== undefined)
  }, [pos, onOpenChange])
  const close = useCallback(() => setPos(undefined), [])

  const toggle = () => {
    if (pos) return setPos(undefined)
    const rect = buttonRef.current!.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    // 下に入りきらなければ上に開く
    const below = window.innerHeight - rect.bottom
    setPos(below < 300 ? { bottom: window.innerHeight - rect.top + 4, right } : { top: rect.bottom + 4, right })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className={`${TOOL_BTN} ${props.hoverClass ?? ''} ${pos ? 'text-c-text-strong bg-c-surface3' : ''}`}
        title={props.title}
      >
        <span className="material-symbols-outlined text-lg leading-none">{props.icon}</span>
      </button>
      {pos && <FloatingMenu pos={pos} items={props.items} onClose={close} ignore={buttonRef} />}
    </>
  )
}

/** 操作バーをレスの枠の上へはみ出させられるか。WebKit は overflow-clip-margin がなく、content-visibility の枠で切り取られる */
const CAN_OVERHANG = typeof CSS !== 'undefined' && CSS.supports('overflow-clip-margin', '4rem')

function PostArticle(props: Props) {
  const { post, anchorCount, idCount, handlers } = props
  const [revealed, setRevealed] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  const [ngOpen, setNgOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  /** 右クリックのメニューを開いている位置 */
  const [ctxMenu, setCtxMenu] = useState<MenuPos>()
  const closeCtxMenu = useCallback(() => setCtxMenu(undefined), [])
  const menuOpen = ngOpen || moreOpen || ctxMenu !== undefined
  /** マウスが乗っているか(乗っている間だけ操作バーを作る) */
  const [hovered, setHovered] = useState(false)
  // フックはここより下の return(NG のレス)より前に置く(レスが NG になった瞬間に数が変わると落ちる)
  const idRef = useRef<HTMLSpanElement>(null)
  const [barTop, setBarTop] = useState(CAN_OVERHANG ? -TOOLBAR_H : 2)
  /** ダブルタップで返信: 1 回目のタップのあと、2 回目を待っている間のタイマー */
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [sheet, setSheet] = useState(false)
  const longPress = useLongPress(isMobile ? () => setSheet(true) : undefined)
  const [aaOverride, setAaOverride] = useState<boolean | null>(null)
  /** 画像の札を押して、URL を本文に広げたか */
  const [imagesExpanded, setImagesExpanded] = useState(false)
  /** サムネイルを読みに行かない設定のとき、押して読んだサムネイル(何番目か) */
  const [loadedThumbs, setLoadedThumbs] = useState<Set<number>>()

  const frame = {
    paddingLeft: 'var(--post-padding-x)',
    paddingRight: 'var(--post-padding-x)',
    paddingBottom: 'var(--post-padding-y)',
    // Discord 風で続けて書いたレスは、前のレスに寄せる
    paddingTop: props.continued ? '2px' : props.showTopDivider ? undefined : 'var(--post-padding-y)',
    borderTopColor: props.showTopDivider ? 'var(--post-divider-color, var(--c-border))' : undefined,
  }
  const frameClass = `group w-full ${props.showTopDivider ? 'border-t pt-2' : ''} ${props.flash ? 'flash-new' : ''}`

  // NG: 番号だけ残して「あぼーん」と出す。押すとその場で中身を見られる
  // 自動 NG は、透明あぼーんの設定でも畳んだ形で出す(誤判定に気づいて「荒らしじゃない」で直せるように)
  if (props.ng && !revealed) {
    if (props.ngMode === 'hide' && !props.autoNg) return null
    const auto = props.autoNg
    // AI NG の「隠す」は、何も出さない(透明あぼーん)
    if (auto?.kind === 'ai' && auto.hit.rule.show === 'hide') return null
    return (
      <article id={`post-${post.no}`} data-no={post.no} className={frameClass} style={frame}>
        <div className="flex items-center gap-3 text-xs text-c-text-muted">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex items-center gap-3 hover:text-c-text-body"
            title="押すと中身を表示"
          >
            <span className="font-bold text-sm">{post.ref ?? post.no}</span>
            <span>あぼーん</span>
            {auto && (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm leading-none">{auto.kind === 'ai' ? 'psychology' : 'smart_toy'}</span>
                {auto.kind === 'ai' ? reasonLabel(auto) : `自動 NG・${reasonLabel(auto)}`}
              </span>
            )}
          </button>
          {auto?.kind === 'ai' && handlers.onMarkAi && (
            <button
              type="button"
              onClick={() => handlers.onMarkAi!(post, auto.hit.rule.id, auto.hit.manual ? null : 'miss')}
              className="px-1.5 py-0.5 rounded border border-c-border hover:text-c-accent hover:border-c-accent"
              title={auto.hit.manual ? '手で付けた「当たる」を外す' : 'この本文はこの条件に当たらない、と印を付ける(同じ本文は今後も当てない)'}
            >
              {auto.hit.manual ? '印を外す' : '当たらない'}
            </button>
          )}
          {auto && auto.kind !== 'ai' && handlers.onMarkTroll && (
            <button
              type="button"
              onClick={() => handlers.onMarkTroll!(post, auto.kind === 'marked' ? null : false, auto.kind)}
              className="px-1.5 py-0.5 rounded border border-c-border hover:text-c-accent hover:border-c-accent"
              title={auto.kind === 'marked' ? '付けた荒らしの印を外す' : '誤判定として印を付け、同じ本文を今後は畳まない'}
            >
              {auto.kind === 'marked' ? '印を外す' : '荒らしじゃない'}
            </button>
          )}
        </div>
      </article>
    )
  }

  // BE のアイコン(本文の 1 行目の sssp://)は絵にして、本文からは除く
  const { icon: beIcon, body: rawBody } = props.display?.splitIcon?.(post.body) ?? { body: post.body }
  const shownBody = props.display ? displayBody(rawBody, props.display) : rawBody
  // Discord・LINE 風は、返信元を頭の上に出しているので、本文の頭のアンカーは省く
  const body = props.replyPreview ? dropLeadingAnchor(shownBody) : shownBody
  const name = props.display ? displayName(post.name, props.display) : post.name
  const numHeat = heatClass(anchorCount)
  // アンカーを付けている・付けられているレスは、本文を押すとツリーを出せる
  const hasConnections = anchorCount > 0 || (props.quotes?.size ?? 0) > 0 || anchorTargets(post.body, handlers.toNo).some((n) => n !== post.no)
  // 空白が続く本文は AA とみなして AA 用の字で出す(⋯ から個別に切り替えられる)
  const isAA = aaOverride ?? looksLikeAA(body)
  // 本文は一番明るい文字色だと背景との差が強すぎてチカチカするので、一段落とした色にする。
  // 人気のレスを「本文の色」で示すときだけ、本文を暖色に(5 件から太字。スマホのアプリと同じ)
  const heatStyle = handlers.heatStyle ?? 'left'
  const bodyClass = heatStyle === 'text' && anchorCount >= 3 ? numHeat : 'text-c-text-body'
  // 人気のレスを帯で示すときの色(左・右の 3px の帯と、淡い地)
  const heatBar = (heatStyle === 'left' || heatStyle === 'right') && anchorCount >= 3 ? heatVar(anchorCount) : null
  // 自分の書き込みの帯は、人気の帯と反対の側に(人気が左の帯なら自分は右。スマホのアプリと同じ)
  const ownRight = heatStyle === 'left'
  // サムネイル(画像・動画のファイル・YouTube)は、本文に出てくる順に並べ、ビューアーでも同じ順に見る
  const mediaItems = props.showThumbnails ? mediaIn(post.body) : []
  const media = mediaItems.map((m) => m.url)
  const thumbReady = (i: number) => handlers.thumbAuto !== false || !!loadedThumbs?.has(i)
  // 埋め込みのカードは 3 件まで(それ以上はカードの右下に件数だけ出す。web 版と同じ)
  const links = props.showLinkPreview ? cardUrlsIn(post.body) : []

  const copy = (text: string) => void navigator.clipboard.writeText(text)
  const header = [post.ref ?? post.no, post.name, post.mail && `[${post.mail}]`, post.date, post.id && `ID:${post.id}`]
    .filter(Boolean)
    .join(' ')

  // すでに当たっている NG(NG のレスだけ調べる。レスの数だけ毎回は調べない)
  const ngHits = props.ng ? handlers.ngHits?.(post) : undefined
  /**
   * 当たっている NG を外す項目。その文字ちょうどの NG は押すだけで外す。
   * 正規表現・部分一致は別のレスにも効いているので、NG の画面を開いて、直すか消すかを選んでもらう
   */
  const ngOffItems = (rules: NgRule[], what: string, value?: string): MenuItem[] => {
    const exact = rules.filter((r) => !r.isRegex && r.pattern === value)
    const others = rules.filter((r) => !exact.includes(r))
    return [
      ...(exact.length > 0 ? [{ label: `この${what}を NG から外す`, icon: 'undo', onClick: () => handlers.onRemoveNg?.(exact) }] : []),
      ...others.map((r) => ({
        label: `${what.trim()} の NG「${r.pattern.length > 12 ? `${r.pattern.slice(0, 12)}…` : r.pattern}」を開く`,
        icon: 'edit_note',
        onClick: () => handlers.onEditNg?.(r, { content: post.body, posterName: post.name, posterId: post.id }),
      })),
    ]
  }
  const ngActions: MenuItem[] = [
    ...(ngHits?.posterId.length
      ? ngOffItems(ngHits.posterId, ' ID ', post.id)
      : post.id
        ? [
            {
              label: 'この ID を NG に(今日だけ)',
              icon: 'schedule',
              onClick: () => handlers.onAddNg(newRule('posterId', post.id!, { expiresOnDate: todayDateString() })),
            },
            { label: 'この ID を NG に', icon: 'person_off', onClick: () => handlers.onAddNg(newRule('posterId', post.id!)) },
          ]
        : []),
    ...(ngHits?.posterName.length
      ? ngOffItems(ngHits.posterName, '名前', post.name)
      : post.name
        ? [{ label: 'この名前を NG に', icon: 'block', onClick: () => handlers.onAddNg(newRule('posterName', post.name)) }]
        : []),
    ...(handlers.onMarkTroll
      ? props.autoNg?.kind === 'marked'
        ? [{ label: '荒らしの印を外す', icon: 'undo', onClick: () => handlers.onMarkTroll!(post, null) }]
        : [
            {
              label: '荒らしとして NG(同じ本文も)',
              icon: 'smart_toy',
              onClick: () => handlers.onMarkTroll!(post, true, props.autoNg?.kind),
            },
            ...(props.autoNg
              ? [{ label: '荒らし判定を外す(誤判定)', icon: 'undo', onClick: () => handlers.onMarkTroll!(post, false, props.autoNg?.kind) }]
              : []),
          ]
      : []),
    // AI NG: 条件ごとに「当たる」を手で付ける。当たっている(畳んだ・印の)ものは「当たらない」も
    ...(handlers.onMarkAi && handlers.aiRules
      ? handlers.aiRules.flatMap((r) => {
          const shown = props.autoNg?.kind === 'ai' ? props.autoNg.hit : props.aiMark
          const on = shown?.rule.id === r.id
          return on
            ? [{ label: `AI NG「${r.name}」に当たらない(誤判定)`, icon: 'psychology_alt', onClick: () => handlers.onMarkAi!(post, r.id, shown.manual ? null : 'miss') }]
            : [{ label: `AI NG「${r.name}」に当たる`, icon: 'psychology', onClick: () => handlers.onMarkAi!(post, r.id, 'hit') }]
        })
      : []),
    // 本文の NG は、言葉の一部で当たっていることが多いので、いつも NG の画面で直す
    ...(ngHits ? ngOffItems(ngHits.content, '本文') : []),
    ...(handlers.onNgDraft
      ? [{ label: '本文の言葉を NG に(直して足す)', icon: 'edit_note', onClick: () => handlers.onNgDraft!('content', post.body, { content: post.body, posterName: post.name, posterId: post.id }) }]
      : []),
  ]
  const toolbarItems = props.toolbar ?? ['reply', 'copy', 'ng']
  const reply = handlers.onReply
  const quick = handlers.onQuickReply
  const actions: MenuItem[] = [
    ...(reply ? [{ label: '返信', icon: 'reply', onClick: () => reply(post.no) }] : []),
    ...(quick
      ? (props.phrases ?? []).map((text) => ({ label: `「${text}」とすぐ書き込む`, icon: 'bolt', onClick: () => quick(post.no, text) }))
      : []),
    ...(hasConnections
      ? [{ label: 'アンカーツリーを表示', icon: 'account_tree', onClick: () => handlers.onBody(post.no, articleRef.current!) }]
      : []),
    { label: 'ヘッダ含めてコピー', icon: 'content_copy', onClick: () => copy(`${header}\n${post.body}`) },
    { label: '本文のみコピー', icon: 'content_copy', onClick: () => copy(post.body) },
    {
      label: isAA ? '文字列として表示' : 'AAとして表示',
      icon: isAA ? 'notes' : 'grid_on',
      onClick: () => setAaOverride(!isAA),
    },
    // 自分のレスの印(書き込んだときに付くもの)を手で付け外しする。ほかの専ブラ・ブラウザから書いたレスにも付けられるように
    ...(handlers.onMarkOwn
      ? [
          props.isOwn
            ? { label: '自分のレスの印を外す', icon: 'person_remove', onClick: () => handlers.onMarkOwn!(post, false, false) }
            : { label: '自分のレスの印を付ける', icon: 'how_to_reg', onClick: () => handlers.onMarkOwn!(post, true, false) },
          ...(post.id
            ? [
                props.isOwn
                  ? { label: '同じ ID のレスすべての印を外す', icon: 'group_remove', onClick: () => handlers.onMarkOwn!(post, false, true) }
                  : { label: '同じ ID のレスすべてに印を付ける', icon: 'group', onClick: () => handlers.onMarkOwn!(post, true, true) },
              ]
            : []),
        ]
      : []),
    // NG は 1 つの枠にまとめ、押すと小項目を広げる
    ...(ngActions.length > 0 ? [{ label: 'NG', icon: 'block', children: ngActions }] : []),
    // 掲示板ごとの操作(通報など)。自分の書き込みにだけ出すものもある
    ...(handlers.onPostAction
      ? (handlers.postActions ?? [])
          .filter((a) => !a.ownOnly || props.isOwn)
          .map((a) => ({ label: a.label, icon: a.icon, onClick: () => handlers.onPostAction!(post, a.id) }))
      : []),
    // 自分の書き込みは、掲示板から消せる(消せる掲示板だけ)
    ...(props.isOwn && handlers.onDeletePost
      ? [{ label: 'この書き込みを削除', icon: 'delete_forever', onClick: () => handlers.onDeletePost!(post) }]
      : []),
  ]

  const variant = props.variant ?? 'card'

  // スマホ: 長押しで、反応(そうだね など)と、︙ のメニューと同じ操作の一覧を出す(マウスを乗せて出す操作バーの代わり)
  const sheetItems: SheetItem[] = [
    ...(handlers.onReact
      ? (handlers.reactionDefs ?? []).map((r) => ({ label: r.label, icon: r.icon, onClick: () => handlers.onReact!(post, r.id) }))
      : []),
    // 下から出る一覧は小項目を広げない作りなので、NG も並べて出す
    ...actions.flatMap((a) => a.children ?? [a]).map((a) => ({ label: a.label, icon: a.icon, onClick: a.onClick ?? (() => undefined) })),
  ]

  // ── レスの頭の部品(スタイルごとに並べ方を変える) ──
  /** レス番号(返信があれば数も。押すと返信を出す) */
  /** size: 番号の字の大きさ(LINE 風の吹き出しの横などは小さく) */
  const numBtn = (prefix = '', size = 'text-sm') => (
    <button
      type="button"
      className={`font-bold ${size} flex items-center gap-1 ${numHeat || 'text-c-text-muted'} ${anchorCount > 0 ? 'hover:opacity-80' : 'cursor-default'}`}
      onClick={anchorCount > 0 ? (e) => handlers.onReplies(post.no, e.currentTarget) : undefined}
      title={anchorCount > 0 ? 'このレスへの返信を表示' : undefined}
    >
      <span style={props.isOwn ? { color: 'var(--c-own)' } : undefined}>
        {prefix}
        {/* 板の本当の番号があればそれを出す(ふたば・4chan は板全体の通し番号) */}
        {post.ref ?? post.no}
      </span>
      {/* 返信の数。Discord 風・LINE 風は ID の右に「返信 n 件」で出す(repliesBtn)。ほかは (数) */}
      {anchorCount > 0 && variant !== 'discord' && variant !== 'line' && (
        <span className={`text-xs ${numHeat || 'text-c-text-muted'}`}>({anchorCount})</span>
      )}
    </button>
  )
  // 名前欄(ワッチョイ込み): 設定で、日付・ID と同じ薄い色・同じ大きさにする(既定オン)。オフなら名前の色で目立たせる
  const nameSubtle = handlers.nameSubtle !== false
  const nameBtn = (cls: string) =>
    name && (
      <button
        type="button"
        className={`font-bold ${nameSubtle ? 'text-c-text-muted' : 'text-c-poster-name'} min-w-0 truncate hover:opacity-80 ${cls}`}
        onClick={(e) => handlers.onName(post.name, e.currentTarget)}
        title="同じ名前の書き込みを表示"
      >
        {name}
      </button>
    )
  /** NG のレスを押して中身を出しているときの札。押すとあぼーんに戻す */
  const ngChip = props.ng && revealed && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setRevealed(false)
      }}
      className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-px rounded hover:opacity-80 transition-opacity"
      style={{ color: 'var(--c-heat-very-hot)', border: '1px solid var(--c-heat-very-hot)' }}
      title="NG のレスです。押すとあぼーんに戻します"
    >
      <span className="material-symbols-outlined text-xs leading-none">block</span>
      NG
    </button>
  )
  /** スレ主(>>1 と同じ ID)と自分の書き込みの印。行の高さを字に合わせて、名前の行より背を高くしない */
  const CHIP = 'flex-shrink-0 self-center text-[10px] leading-none font-bold px-1 py-[2px] rounded'
  const opChip = props.isOp && (
    <span className={CHIP} style={{ color: 'var(--c-op)', background: 'var(--c-op-wash)', border: '1px solid var(--c-op)' }} title="スレ主(>>1 と同じ ID)">
      主
    </span>
  )
  const ownChip = props.isOwn && (
    <span className={CHIP} style={{ color: 'var(--c-own)', background: 'var(--c-own-wash)', border: '1px solid var(--c-own)' }} title="自分の書き込み">
      自分
    </span>
  )
  // 2 回以上書いた ID は、ID ごとの色(設定 idStyle が「色」のとき)
  /** 頭の日時(設定の出し方で。元の形は title で見られる) */
  const shownDate = displayDate(post.date, handlers.dateStyle ?? 'full')
  const idTint = handlers.idColor && post.id && idCount >= 2 ? idColorOf(post.id, handlers.idColor.dark, handlers.idColor.sky) : null
  const idBtn =
    post.id &&
    (
      <button
        type="button"
        className={`${HEAD_TEXT} font-mono flex items-center gap-0.5 hover:opacity-80 ${idTint ? '' : 'text-c-text-muted'}`}
        style={idTint ? { color: idTint } : undefined}
        data-head-target="id"
        onClick={(e) => handlers.onId(post.id!, e.currentTarget)}
        title="この ID の書き込みを表示"
      >
        <span title={`ID:${post.id}`}>{displayId(post.id, !!handlers.idShort)}</span>
        {/* 書き込み数。Discord 風・LINE 風は、色はアイコンの右下の数で付けるので、ここは色を付けない */}
        {idCount >= 2 && (
          <span className={`text-xs ${variant === 'discord' || variant === 'line' ? 'text-c-text-muted font-normal' : ''}`}>({idCount})</span>
        )}
      </button>
    )
  /** Discord 風・LINE 風: このレスへの返信の数(ID の右に。押すと返信を出す)。多いほど暖色に */
  const repliesBtn = anchorCount > 0 && (variant === 'discord' || variant === 'line') && (
    <button
      type="button"
      className={`flex-shrink-0 whitespace-nowrap ${isMobile ? 'text-[11px]' : 'text-xs'} font-bold hover:opacity-80 ${numHeat || 'text-c-text-muted'}`}
      onClick={(e) => {
        e.stopPropagation()
        handlers.onReplies(post.no, e.currentTarget)
      }}
      title="このレスへの返信を表示"
    >
      {/* 吹き出しの印と数だけ(スマホのアプリ・hono-bbs の web と同じ) */}
      <span className="inline-flex items-center gap-0.5">
        <span className="material-symbols-outlined text-[14px] leading-none">chat_bubble</span>
        {anchorCount}
      </span>
    </button>
  )
  /**
   * レスへの反応(ふたばの「そうだね×18」、いいねなど)。多いほど目立つ色に。押せる掲示板では、押すと反応する。
   * 反応が 1 種類なら「名前×数」(まだなければ「+」)、何種類もあればアイコンと数を並べる
   */
  const reactionDefs = handlers.reactionDefs ?? []
  const single = reactionDefs.length === 1
  const reactionChip = (def: ReactionDef) => {
    const n = props.reactions?.[def.id] ?? 0
    const color = n > 0 ? heatClass(n) || 'text-mark-hot' : 'text-c-text-muted'
    const text = single ? (n > 0 ? `${def.label}×${n}` : '+') : n > 0 ? String(n) : ''
    const inner = (
      <>
        {!single && <span className="material-symbols-outlined text-sm leading-none">{def.icon}</span>}
        {text}
      </>
    )
    if (handlers.onReact)
      return (
        <button
          key={def.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handlers.onReact?.(post, def.id)
          }}
          className={`flex-shrink-0 flex items-center gap-0.5 text-[11px] font-bold tabular-nums hover:underline ${color}`}
          title={`${def.label}を押す${n > 0 ? `(いま ${n})` : ''}`}
        >
          {inner}
        </button>
      )
    if (n === 0) return null
    return (
      <span key={def.id} className={`flex-shrink-0 flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${color}`} title={`${def.label} ${n}`}>
        {inner}
      </span>
    )
  }
  const voteChip = reactionDefs.length > 0 && <>{reactionDefs.map(reactionChip)}</>
  /** 掲示板がレスに付けた印(「管理人」「認証済み」など) */
  // AI NG の「印だけ」: 頭に条件の名前と当たり具合を出す
  const aiChip = props.aiMark && (
    <span className={`${CHIP} flex items-center gap-0.5`} style={{ color: 'var(--c-mark-purple)', border: '1px solid var(--c-mark-purple)' }} title={aiHitLabel(props.aiMark)}>
      <span className="material-symbols-outlined text-[11px] leading-none">psychology</span>
      {props.aiMark.rule.name || 'AI'}
    </span>
  )
  const badgeChips = post.badges?.length || aiChip ? <>{post.badges?.map((b, i) => <BadgeChip key={i} badge={b} />)}{aiChip}</> : null
  const toOwnChip = props.isReplyToOwn && (
    <span
      className="text-[10px] font-medium px-2 py-0.5 flex-shrink-0"
      style={{ color: 'var(--c-to-own)', background: 'var(--c-to-own-wash)', border: '1px solid var(--c-to-own)', borderRadius: 'var(--chip-radius)' }}
    >
      →あなた宛
    </span>
  )
  /** ID のアイコン。round なら丸く大きく(Discord 風)。書き込み数を右下に重ねる */
  // アイコンの種: 設定でワッチョイから作ることにしていて、名前にワッチョイがあればそれ(週ごとに変わる)。なければ ID(日ごと)
  const iconSeed = (handlers.iconFromWatchoi ? watchoiOf(post.name) : undefined) ?? post.id
  const iconCount = props.iconCount ?? idCount
  const identiconBtn = (size: number, round = false) =>
    iconSeed && (
      <button
        type="button"
        className={`relative flex-shrink-0 hover:opacity-80 ${round ? '' : 'mr-1'}`}
        onClick={(e) => (iconSeed === post.id ? handlers.onId(iconSeed, e.currentTarget) : handlers.onWatchoi?.(iconSeed, e.currentTarget))}
        title={iconSeed === post.id ? `ID:${post.id} (${iconCount})` : `ワッチョイ ${iconSeed} (${iconCount})`}
      >
        <span className={`block overflow-hidden ${round ? 'rounded-full' : ''}`}>
          <Identicon seed={iconSeed} size={size} />
        </span>
        {iconCount >= 2 && (
          <span
            // 右下の数は、アイコンの外(名前や「主」の印の側)にはみ出さないよう、右へは少しだけ
            className={`absolute -bottom-1 ${round ? '-right-0.5' : '-right-1'} min-w-[15px] h-[15px] px-0.5 rounded-full bg-c-surface border border-c-border text-[9px] font-bold leading-none flex items-center justify-center ${heatClass(iconCount) || 'text-c-text-muted'}`}
          >
            {iconCount}
          </span>
        )}
      </button>
    )

  /** ID のないレス(板の設定や書き方で ID が付かないもの)のアイコン。何もない丸だと壊れて見えるので、人の形を出す */
  const noIdAvatar = (
    <span className="flex rounded-full bg-c-surface3 items-center justify-center text-c-text-muted" style={AVATAR_BOX} title="ID のないレス">
      <span className="material-symbols-outlined fill text-xl leading-none">person</span>
    </span>
  )

  // ── レスの頭 ──
  // ID の位置(設定): 日時の後ろ(頭の中)・レスの右上(頭の右端)・レスの右下(本文の下の右端)
  const idPosition = handlers.idPosition ?? 'header'
  const idInHeader = idPosition === 'header' ? idBtn : null
  // 右上の ID の幅を覚えておき、マウスを乗せたときの操作バーをその左に置く(重ならないように。枠の外には出せない)
  /**
   * 操作バーの上端(レスの枠からの px)。ID と重ならないように、ID の上端を測って、バーの下端をその上に置く(上のレスとの線にまたがる)。
   * 上に余裕がない(すぐ上にレスが見えない)行は ID の下
   */
  const placeToolbar = () => {
    const el = articleRef.current
    if (!el || idPosition !== 'topRight') return
    const rect = el.getBoundingClientRect()
    const id = idRef.current?.getBoundingClientRect()
    const idTop = id ? id.top - rect.top : 0
    // (レスの間にすき間のある見た目があるので、少しずつ上を見る)
    if (CAN_OVERHANG && [8, 20, 32].some((d) => document.elementFromPoint(rect.right - 60, rect.top - d)?.closest('article[data-no]'))) return setBarTop(idTop - (TOOLBAR_H * parseFloat(getComputedStyle(document.documentElement).fontSize)) / 16 - 2)
    setBarTop((id ? id.bottom - rect.top : 24) + 2)
  }
  const idAtTopRight = idPosition === 'topRight' && idBtn ? <span ref={idRef} className="ml-auto pl-2 flex-shrink-0">{idBtn}</span> : null
  const idAtBottomRight = idPosition === 'bottomRight' && idBtn ? <div className="flex justify-end mt-0.5 text-xs">{idBtn}</div> : null
  const headerBlock =
    variant === 'classic' ? (
      // 専ブラ風: 「12 ：名前 [sage]：日付 ID:xxx」を 1 行に。色の面も枠もなし
      <div data-post-header className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 mb-1 text-sm">
        {numBtn()}
        <span className="text-c-text-muted">：</span>
        {nameBtn(nameSubtle ? 'text-xs' : 'text-sm')}
        {post.mail && <span className="text-c-text-muted text-xs">[{post.mail}]</span>}
        <span className="text-c-text-muted">：</span>
        <span className="text-c-text-muted text-xs whitespace-nowrap" title={post.date}>{shownDate}</span>
        {idInHeader}
        {voteChip}
        {opChip}
        {ownChip}
            {badgeChips}
        {ngChip}
        {toOwnChip}
        {idAtTopRight}
      </div>
    ) : variant === 'discord' ? (
      // Discord 風: 名前を大きめに、番号・日付・ID は小さく横に
      props.continued ? null : (
        <div data-post-header className={`flex items-baseline flex-nowrap overflow-hidden ${isMobile ? 'mb-1 gap-x-1.5' : 'mb-0.5 gap-2'}`}>
          {/* 返信の数は頭の一番左に */}
          {repliesBtn}
          {nameBtn(nameSubtle ? (isMobile ? 'text-[11px]' : HEAD_TEXT) : isMobile ? 'text-[13px]' : 'text-sm') || (
            <span className={`font-bold ${nameSubtle ? `${isMobile ? 'text-[11px]' : HEAD_TEXT} text-c-text-muted` : 'text-sm text-c-poster-name'}`}>名無し</span>
          )}
          {opChip}
          {ownChip}
            {badgeChips}
          {ngChip}
          {/* 番号は名前のすぐ後ろに(右端はマウスを乗せたときの操作バーと重なるため) */}
          <span className="flex-shrink-0 text-xs">{numBtn('#', isMobile ? 'text-[11px]' : 'text-sm')}</span>
          {/* スマホは日付を短く(「10/19 12:34」)して、頭を 1〜2 行に収める */}
          <span className={`${isMobile ? 'text-[11px]' : HEAD_TEXT} text-c-text-muted whitespace-nowrap`} title={post.date}>
            {isMobile ? shortDate(post.date) : shownDate}
          </span>
          {idInHeader}
          {voteChip}
          {post.mail && <span className={`${isMobile ? 'text-[11px]' : HEAD_TEXT} text-c-text-muted`}>[{post.mail}]</span>}
          {toOwnChip}
          {idAtTopRight}
        </div>
      )
    ) : (
      <div data-post-header className="flex items-center mb-2 flex-nowrap overflow-hidden gap-3">
        {/* ID のアイコン(web 版と同じく、右下にその ID の書き込み数を重ねる) */}
        {props.showIdenticon && identiconBtn(22)}
        {numBtn()}
        {nameBtn(HEAD_TEXT)}
        {ngChip}
        {opChip}
        {ownChip}
            {badgeChips}
        {post.mail && <span className={`${HEAD_TEXT} text-c-text-muted`}>[{post.mail}]</span>}
        <span className={`${HEAD_TEXT} text-c-text-muted whitespace-nowrap`} title={post.date}>{shownDate}</span>
        {idInHeader}
        {voteChip}
        {toOwnChip}
        {idAtTopRight}
      </div>
    )

  /**
   * Discord 風: 本文の先頭のアンカーを「返信」として、頭の上に返信元の 1 行を出す。
   * 返信元の小さいアイコンは本文の始まりの位置に置き、そこから左下へ、書いた人の大きいアイコンまで線でつなぐ
   * (番号は線とアイコンで分かるので出さない)
   */
  const replyLine = (variant === 'discord') && props.replyPreview && (
    // 本文の始まり(アイコンの幅 + 隙間)にそろえる。スマホはアイコンが小さく隙間も狭いので、決まった値ではなく大きさから出す
    <div className={`relative h-5 ${isMobile ? 'mb-1' : 'mb-0.5'} flex items-center`} style={{ paddingLeft: AVATAR + AVATAR_GAP }}>
      {/* 大きいアイコンの真ん中の上から立ち上がり、右へ曲がって小さいアイコンの手前まで */}
      <span
        aria-hidden
        className={`absolute top-1/2 ${isMobile ? '-bottom-1' : '-bottom-0.5'} border-l-2 border-t-2 rounded-tl-md pointer-events-none`}
        style={{ borderColor: 'var(--c-border-strong)', left: AVATAR / 2, width: AVATAR / 2 + AVATAR_GAP - 4 }}
      />
      <button
        type="button"
        className="flex items-center gap-1.5 min-w-0 max-w-full text-xs text-c-text-muted hover:text-c-text-body"
        onClick={(e) => {
          e.stopPropagation()
          handlers.onAnchor([props.replyPreview!.no], e.currentTarget, 'click')
        }}
        title={`>>${props.replyPreview.no} を表示`}
      >
        {props.replyPreview.id ? (
          <span className="flex-shrink-0 block overflow-hidden rounded-full">
            <Identicon seed={props.replyPreview.id} size={16} />
          </span>
        ) : (
          <span className="flex-shrink-0 flex w-4 h-4 rounded-full bg-c-surface3 items-center justify-center text-c-text-muted" title="ID のないレス">
            <span className="material-symbols-outlined fill text-[12px] leading-none">person</span>
          </span>
        )}
        <span className="truncate">{props.replyPreview.text}</span>
      </button>
    </div>
  )

  /** レスのどこを押しても(頭の空いた所も)、アンカーツリーを出す。文字を選んでいるとき(コピーしようとしているとき)は開かない */
  const openTree = (e: React.MouseEvent<HTMLElement>) => {
    // 名前・ID・リンクなどのボタンを押したときは、そちらだけ(LINE 風は頭もレスの行の中にあるため)
    if ((e.target as HTMLElement).closest('button, a, [role="button"], video, input, label')) return
    if (window.getSelection()?.toString().trim()) return
    const el = e.currentTarget
    // PC: ダブルクリックの操作(設定)。2 回目が来るまで少し待ち、来たらその操作、来なければツリー
    const dbl = !isMobile && handlers.doubleClick && handlers.doubleClick !== 'none' ? handlers.doubleClick : undefined
    if (dbl) {
      if (tapTimer.current !== undefined) {
        clearTimeout(tapTimer.current)
        tapTimer.current = undefined
        if (dbl === 'reply') handlers.onReply?.(post.no)
        else if (dbl === 'tree') { if (hasConnections) handlers.onBody(post.no, el) }
        else if (dbl === 'copy') copy(post.body)
        else if (dbl === 'copyHeader') copy(`${header}\n${post.body}`)
        else if (dbl === 'id' && post.id) handlers.onId(post.id, el)
        return
      }
      tapTimer.current = setTimeout(() => {
        tapTimer.current = undefined
        if (hasConnections) handlers.onBody(post.no, el)
      }, DOUBLE_TAP_MS)
      return
    }
    // ダブルタップで返信(設定): 2 回目が来るまで少し待ち、来たら返信、来なければツリー(スマホのアプリと同じ)
    if (handlers.doubleTapReply && handlers.onReply && isMobile) {
      if (tapTimer.current !== undefined) {
        clearTimeout(tapTimer.current)
        tapTimer.current = undefined
        handlers.onReply(post.no)
        return
      }
      tapTimer.current = setTimeout(() => {
        tapTimer.current = undefined
        if (hasConnections) handlers.onBody(post.no, el)
      }, DOUBLE_TAP_MS)
      return
    }
    if (hasConnections) handlers.onBody(post.no, el)
  }

  const bodyBlock = (
        <div
          data-post-body
          style={{
            // 専ブラ風は本文を字下げし、Discord 風は頭の位置から。どちらも本文の左の縦線は引かない(自分の印は別に出る)
            paddingLeft:
              variant === 'classic' ? '2em' : variant === 'discord' || variant === 'line' ? 0 : props.isOwn ? 'var(--post-quote-padding-own)' : 'var(--post-quote-padding)',
            borderLeftWidth: variant !== 'card' && variant !== 'matome' ? 0 : props.isOwn ? 'var(--post-quote-bar-width-own)' : 'var(--post-quote-bar-width)',
            borderLeftStyle: 'solid',
            borderLeftColor: props.isOwn ? 'var(--c-own)' : 'var(--c-border)',
          }}
        >
          {/* BE のアイコンは、画像のサムネイルの設定に関係なく出す(5ch の書き込みの一部なので)。LINE 風ではアイコンの場所に出す */}
          {beIcon && variant !== 'line' && (
            <img
              src={beIcon}
              alt=""
              referrerPolicy="no-referrer"
              className="block mb-1 max-h-12 max-w-[96px] object-contain"
              title="BE のアイコン"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
          <p
            ref={isAA && isMobile ? fitAA : undefined}
            // スマホの AA は横にずらさず(スワイプとぶつかる)、字を小さくして 1 画面に収める(fitAA)
            className={`text-base ${bodyClass} ${isAA ? `aa-font whitespace-pre ${isMobile ? 'overflow-hidden' : 'overflow-x-auto'}` : 'whitespace-pre-wrap break-words leading-relaxed'}`}
            // まとめ風: 返信の多いレスは字を大きく濃く、ほかは小さめに(読み飛ばしながら見どころを拾える)
            style={variant === 'matome' && !isAA ? (anchorCount >= 3 ? { fontSize: 'calc(var(--post-body-size, 1rem) * 1.2)', fontWeight: 500, color: 'var(--c-text-strong)' } : { fontSize: 'calc(var(--post-body-size, 1rem) * 0.88)', opacity: 0.85 }) : undefined}
          >
            {renderBody(
              body,
              imagesExpanded
                ? { ...handlers, urls: handlers.urls && { ...handlers.urls, omitImages: false, collapseImageRuns: false } }
                : { ...handlers, onExpandImages: () => setImagesExpanded(true) },
              props.quotes,
            )}
          </p>

          {links.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {links.slice(0, 3).map((url, i) => (
                <LinkPreview key={url} url={url} onOpen={handlers.onUrl} more={i === 2 ? links.length - 3 : undefined} />
              ))}
            </div>
          )}
          {mediaItems.length > 0 && props.blurMedia && (
            <p className="mt-2 flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--c-error)' }}>
              <span className="material-symbols-outlined text-sm leading-none">warning</span>
              グロ注意(押すと開きます)
            </p>
          )}
          {mediaItems.length > 0 && (
            <div className={`mt-2 flex flex-wrap gap-2 ${props.blurMedia ? 'gross-blur' : ''}`}>
              {mediaItems.map((m, i) => {
                const open = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  handlers.onImage(media, i, post)
                }
                // 読みに行かない設定: 同じ大きさの枠だけを出し、押したらそのサムネイルを読む(ビューアーはまだ開かない)
                if (!thumbReady(i))
                  return (
                    <button
                      key={`wait:${m.url}:${i}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setLoadedThumbs((s) => new Set(s).add(i))
                      }}
                      className="post-thumb flex-shrink-0 flex flex-col items-center justify-center gap-0.5 rounded border border-dashed border-c-border bg-c-surface2 text-c-text-muted"
                      title="押すとサムネイルを読み込みます"
                    >
                      <span className="material-symbols-outlined text-2xl">{m.kind === 'image' ? 'image' : m.kind === 'video' ? 'movie' : 'smart_display'}</span>
                      <span className="text-[10px] leading-none">{m.kind === 'image' ? '画像' : m.kind === 'video' ? '動画' : 'YouTube'}</span>
                    </button>
                  )
                if (m.kind === 'image')
                  return (
                    <button
                      key={m.url + i}
                      type="button"
                      onClick={open}
                      className="post-thumb relative bg-c-surface2 border border-c-border rounded overflow-hidden flex-shrink-0 flex items-center justify-center hover:border-c-border-strong transition-colors"
                    >
                      {/* 家の中のアドレスは、表示しただけでは読みに行かない(押せば開く) */}
                      {isAutoLoadable(m.url) ? (
                        <>
                          <ThumbImage src={m.url} className="relative w-full h-full object-cover" />
                        </>
                      ) : (
                        <LocalAddressMark />
                      )}
                    </button>
                  )
                if (m.kind === 'video')
                  // 動画のファイルは、最初のコマをサムネイルにして ▶ を付ける。押すとビューアーで再生する。
                  // 最初のコマに要る分(metadata)だけ読み、本体は押すまで取りに行かない
                  return (
                    <button
                      key={m.url}
                      type="button"
                      onClick={open}
                      className="post-thumb relative bg-black border border-c-border rounded overflow-hidden flex-shrink-0 hover:border-c-border-strong transition-colors"
                      title="動画を再生する"
                    >
                      {isAutoLoadable(m.url) ? (
                        <video src={mediaSrc(`${m.url}#t=0.1`)} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <LocalAddressMark />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="material-symbols-outlined fill text-3xl text-white/90 drop-shadow">play_circle</span>
                      </span>
                    </button>
                  )
                // YouTube は赤い枠と ▶ で見分ける(web 版と同じ)。押すとビューアーの中で再生する
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={open}
                    className="post-thumb relative rounded overflow-hidden flex-shrink-0 hover:opacity-90 transition-opacity"
                    style={{ border: '2px solid #ff0000', background: '#000' }}
                    title="YouTube を再生する"
                  >
                    <ThumbSpinner />
                    <img
                      src={`https://img.youtube.com/vi/${m.id}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="relative w-full h-full object-cover"
                      onLoad={(e) => hideSpinner(e.currentTarget)}
                    />
                    {/* 再生の印は、真ん中に半透明で大きく */}
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="material-symbols-outlined fill text-4xl text-white/85 drop-shadow">play_circle</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
  )

  /**
   * マウスを乗せたレスに出す操作バー(返信・定型文・コピー・NG・︙)。at は置き場所の class。
   * ふつうはレスの右上、LINE 風は吹き出しと同じ側の上(相手の吹き出しは左寄せなので、右上だと吹き出しから遠い)。
   * どれもレスの枠の中に置く(枠は content-visibility で外を切り取るので、はみ出すと見えない)
   */
  const toolbarAt = (at: string, style?: { top: number }) => (
      <div
        data-post-toolbar
        className={`absolute ${at} z-20 flex items-center gap-0.5 p-0.5 bg-c-surface border border-c-border rounded-lg shadow-md transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        }`}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {toolbarItems.map((item) => {
          if (item === 'reply' && reply)
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-link`} title="返信" onClick={() => reply(post.no)}>
                <span className="material-symbols-outlined text-lg leading-none">reply</span>
              </button>
            )
          if (item === 'copy')
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-link`} title="本文をコピー" onClick={() => copy(post.body)}>
                <span className="material-symbols-outlined text-lg leading-none">content_copy</span>
              </button>
            )
          if (item === 'ng' && ngActions.length > 0)
            return <MenuButton key={item} icon="block" title="NG に追加" items={ngActions} onOpenChange={setNgOpen} hoverClass="hover:!text-mark-danger" />
          if (item === 'tree' && hasConnections)
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-hot`} title="アンカーツリー" onClick={() => handlers.onBody(post.no, articleRef.current!)}>
                <span className="material-symbols-outlined text-lg leading-none">account_tree</span>
              </button>
            )
          if (item.startsWith('phrase:') && quick) {
            const text = item.slice('phrase:'.length)
            return (
              <button
                key={item}
                type="button"
                className={`${TOOL_BTN} hover:!text-mark-new text-sm font-bold max-w-[6rem]`}
                title={`「${text}」とすぐ書き込む`}
                onClick={() => quick(post.no, text)}
              >
                <span className="truncate">{text}</span>
              </button>
            )
          }
          return null
        })}
        <MenuButton icon="more_horiz" title="その他" items={actions} onOpenChange={setMoreOpen} />
      </div>
  )

  // ── LINE 風 ──
  // 吹き出しで並べる。ほかの人は左にアイコンと名前、自分の書き込みは右に緑の吹き出し(アイコンなし)。
  // 番号と時刻は吹き出しの横に小さく。返信は吹き出しの中の上に、返信元を引用の形で出す
  const time = /(\d{1,2}:\d{2})(?::\d{2})?/.exec(post.date)?.[1] ?? post.date
  // 自分の書き込みは右に寄せる。ただしアンカーツリーの中では、線でアイコンをつなぐため左にそろえる(緑の吹き出しはそのまま)
  const right = props.isOwn && !props.alignLeft
  const lineSide = (
    <div className={`flex-shrink-0 flex flex-col gap-0.5 pb-0.5 text-[10px] text-c-text-muted leading-tight ${right ? 'items-end' : 'items-start'}`}>
      {/* スマホは横幅が貴重なので、番号も小さくする */}
      <span className="text-[11px]">{numBtn('#', isMobile ? 'text-[10px]' : 'text-[11px]')}</span>
      <span title={post.date}>{time}</span>
    </div>
  )
  const lineQuote = props.replyPreview && (
    <button
      type="button"
      className="flex items-center gap-1.5 min-w-0 max-w-full mb-1.5 pl-2 border-l-2 text-xs text-c-text-muted hover:text-c-text-body text-left"
      style={{ borderColor: 'currentColor' }}
      onClick={(e) => {
        e.stopPropagation()
        handlers.onAnchor([props.replyPreview!.no], e.currentTarget, 'click')
      }}
      title={`>>${props.replyPreview.no} を表示`}
    >
      {props.replyPreview.id && (
        <span className="flex-shrink-0 block overflow-hidden rounded-full">
          <Identicon seed={props.replyPreview.id} size={16} />
        </span>
      )}
      <span className="truncate">{props.replyPreview.text}</span>
    </button>
  )
  // LINE 風のときだけ組み立てる
  const lineLayout = () => (
    <div className={`flex gap-2 items-start ${right ? 'flex-row-reverse' : ''}`}>
      {!right && (
        <div className="flex-shrink-0" style={AVATAR_COL}>
          {props.continued ? null : beIcon ? (
            // BE のアイコンがあれば、ID の模様の代わりに出す。大きさは絵ごとに違うので、36px の枠に収まるよう縮め・広げる(縦横の比は保つ)
            <button
              type="button"
              className="block rounded-xl overflow-hidden bg-c-surface hover:opacity-80"
              style={AVATAR_BOX}
              onClick={(e) => post.id && handlers.onId(post.id, e.currentTarget)}
              title={post.id ? `BE のアイコン(ID:${post.id} のレスを出す)` : 'BE のアイコン'}
            >
              <img
                src={beIcon}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
            </button>
          ) : (
            identiconBtn(AVATAR, true) || noIdAvatar
          )}
        </div>
      )}
      <div className={`flex-1 min-w-0 flex flex-col ${right ? 'items-end' : 'items-start'}`}>
        {!props.continued && (
          <div data-post-header className={`flex items-center gap-1.5 mb-1 max-w-full text-xs ${right ? 'flex-row-reverse' : idPosition === 'topRight' ? 'w-full' : ''}`}>
            {repliesBtn}
            {!right && nameBtn('text-xs')}
            {opChip}
            {badgeChips}
            {ngChip}
            {/* ID の位置の設定に従う(右下は吹き出しの下に出す) */}
            {idInHeader}
            {idAtTopRight}
            {voteChip}
            {post.mail && <span className="text-c-text-muted">[{post.mail}]</span>}
          </div>
        )}
        <div className={`flex items-end gap-1.5 max-w-full ${right ? 'flex-row-reverse' : ''}`}>
          <div className={`line-bubble relative min-w-0 ${props.isOwn ? 'line-bubble-own' : ''} ${isAA ? 'max-w-full' : 'max-w-[min(85%,42rem)]'}`}>
            {lineQuote}
            {bodyBlock}
          </div>
          {lineSide}
          {/* 番号の外側に置く。並びは吹き出しの側で左右が入れ替わる(左の吹き出しなら番号の右、右の吹き出しなら番号の左) */}
          {toOwnChip}
        </div>
      </div>
    </div>
  )

  return (
    <article
      {...longPress}
      ref={articleRef}
      id={`post-${post.no}`}
      data-no={post.no}
      data-variant={variant}
      className={`relative ${frameClass} ${variant === 'discord' ? 'post-discord' : ''} ${hasConnections ? 'cursor-pointer' : ''}`}
      onClick={openTree}
      // PC: 右クリックで、︙ と同じ操作の一覧を出す
      onContextMenu={
        !isMobile
          ? (e) => {
              if (wantsNativeMenu(e)) return
              e.preventDefault()
              setCtxMenu(menuPosAt(e.clientX, e.clientY))
            }
          : undefined
      }
      // 人気のレスを帯で示すときは、淡い地も敷く(スマホのアプリと同じ 6%)
      style={heatBar ? { ...frame, background: `color-mix(in srgb, ${heatBar} 6%, transparent)` } : frame}
      onMouseEnter={() => {
        placeToolbar()
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 自分の書き込み(濃い線)と、自分へのアンカーを含むレス(薄い線)の目印。
          高密度表示では web 版の設定で本文の縦線が 0 になるので、表示の密度に関係なく見えるよう別に引く */}
      {/* LINE 風の自分の書き込みは、右に寄せた緑の吹き出しで分かるので、縦の印は出さない(自分宛てのレスには出す) */}
      {/* 人気のレスの帯(設定で左・右)。淡い地は article の style で敷く */}
      {heatBar && (
        <span
          className={`absolute ${heatStyle === 'left' ? 'left-0' : 'right-0'} top-1 bottom-1 w-[3px] rounded-full pointer-events-none`}
          style={{ background: heatBar }}
          title={`返信 ${anchorCount} 件`}
        />
      )}
      {((props.isOwn && variant !== 'line') || props.isReplyToOwn) && !props.alignLeft && (
        <span
          className={`absolute ${ownRight ? 'right-0' : 'left-0'} top-1 bottom-1 w-[3px] rounded-full pointer-events-none`}
          style={props.isOwn && variant !== 'line' ? { background: 'var(--c-own)' } : { background: 'var(--c-to-own)' }}
          title={props.isOwn && variant !== 'line' ? '自分の書き込み' : '自分へのレス'}
        />
      )}
      {/* マウスを乗せたレスの上に浮かぶ操作バー(Discord 風)。メニューを開いている間は出したままにする。
          マウスを乗せている間だけ作る(全部のレスに最初から作ると、要素がレスの 4 割ほど増えてスレを開くのが遅くなる) */}
      {!isMobile &&
        (hovered || menuOpen) &&
        toolbarAt(
          variant === 'line' && !(props.isOwn && !props.alignLeft) && idPosition !== 'topRight' ? 'top-0.5 left-3' : 'top-0.5 right-3',
          // ID を右上に出しているときは、ID と重ならないように上下へずらす(barTop)
          idPosition === 'topRight' ? { top: barTop } : undefined,
        )}
      {variant === 'line' ? (
        <>
          {lineLayout()}
          {idAtBottomRight}
        </>
      ) : variant === 'discord' ? (
        // Discord 風: 左に丸い ID のアイコン、右に頭・返信・本文。続けて書いたレス(同じ ID)はアイコンと頭を省く
        <div>
        {replyLine}
        <div className="flex items-start" style={{ gap: AVATAR_GAP }}>
          {/* アイコンはレスの頭の高さにそろえる(レスの縦の真ん中に来ないように) */}
          <div className="flex-shrink-0 flex justify-center items-start" style={AVATAR_COL}>
            {props.continued ? (
              <span className="pt-0.5 text-[10px] tabular-nums text-c-text-muted opacity-0 group-hover:opacity-100">{numBtn('#')}</span>
            ) : (
              identiconBtn(AVATAR, true) || noIdAvatar
            )}
          </div>
          <div className="flex-1 min-w-0">
            {headerBlock}
            {bodyBlock}
            {idAtBottomRight}
          </div>
        </div>
        </div>
      ) : (
        <>
          {headerBlock}
          {bodyBlock}
          {idAtBottomRight}
        </>
      )}
      {sheet && <ActionSheet title={`${post.ref ?? post.no} ${post.name}`} items={sheetItems} onClose={() => setSheet(false)} />}
      {ctxMenu && <FloatingMenu pos={ctxMenu} items={actions} onClose={closeCtxMenu} />}
    </article>
  )
}

export default memo(PostArticle)

/** 読み込んでいる間の印(画像のすぐ前の要素)を隠す。React が持っている要素なので、消さずに隠すだけにする */
function hideSpinner(img: HTMLImageElement) {
  const spinner = img.previousElementSibling
  if (spinner instanceof HTMLElement) spinner.style.display = 'none'
}
