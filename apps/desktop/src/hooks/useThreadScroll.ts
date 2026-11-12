// スレ表示のスクロールまわりをまとめたもの。
// - 開いたら設定どおりの位置(最初の未読/先頭/末尾、タブを切り替えて戻ったときは前の位置)へ置く
// - スクロールや中身の変化に合わせて、どこまで読んだかを知らせ、読んでいた位置を覚える
// - 新着が届いたら光らせ、若い番号から順に出し、必要なら新着の頭まで送る
// - 一番下へ飛ぶボタンを出すかどうか
// - まだ描いていないレスの仮の高さ(描いたことがあれば覚えておいた高さ、なければ本文から見積もった高さ)
// - 見ているレスを基準に画面の中を動かさない(上のレスの高さが変わっても、基準の位置を保つ)
// どこへ動かすか・どこまで読んだかの判断は utils/threadScroll.ts(テストあり)に任せ、ここでは測って動かすだけにする。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import { firstAfter } from '../utils/cursor'
import type { UrlDisplay } from '../utils/postBody'
import {
  HeightCache,
  PositionMemory,
  anchorShift,
  centerOffset,
  estimatePostHeight,
  heightKind,
  heightOffsets,
  movedByOthers,
  newPostsTarget,
  openTarget,
  postShape,
  readProgress,
  settleDone,
  staggerDelays,
  treeRead,
  type PostRect,
  type ScrollPosition,
} from '../utils/threadScroll'
import type { OpenPosition } from '../ui/settings'

/** 未読の頭を置く位置(見えている範囲の上からの割合)。上の 3 割には既読のレスを残す */
const UNREAD_AT = 0.3
/** 一番下からこれだけ以内なら「いちばん下を見ている」とみなす(新着を追いかける) */
const BOTTOM_PX = 80
/** 一番下へ飛ぶのにかける時間 */
const JUMP_MS = 300
/** 着いたあと、行き先がこれだけ動かなくなるまで合わせ直す(画面の外で省いていたレスが描かれて高さが変わるため) */
const SETTLE_MS = 250
/** 合わせ直すのは長くてもここまで。そのあとは見張りが基準のレスを留める */
const FOLLOW_MAX_MS = 2000
/**
 * 実測がこれだけ集まるごとに、見積もりの補正を見直す。毎回見直すと、全部のレスの仮の高さを何度も描き直すことになる。
 * 最初の 1 件で本文の幅・字・行の高さ(見積もりの寸法)を測った値に替える(開いた直後の 1 コマで、全部の仮の高さが実測に近づく)
 */
const CALIB_AT = [1, 4, 16, 64, 256]
/** 補正のために覚えておく実測の数 */
const CALIB_KEEP = 300
/** これより多い新着は、なめらかに追いかけずにすぐ移る */
const MANY_NEW = 30
/** 新着を光らせておく時間(app.css の .flash-new の長さと揃える) */
const FLASH_MS = 1000
/** 飛んだ先のレスを光らせておく時間(app.css の .flash-jump-glow の長さと揃える。スマホ版の JUMP_FLASH_HOLD_MS + FADE_MS) */
const JUMP_FLASH_MS = 1020
/** AA 用の字の行の高さ(index.css の .aa-font の line-height) */
const AA_LINE_HEIGHT = 1.15
/** 新着を若い番号から順に出すときの 1 件ごとのずらしと、全体の長さの上限(app.css の .post-enter) */
const STAGGER_MS = 35
const STAGGER_TOTAL_MS = 450
/** キー操作で動かすときの時間 */
const STEP_MS = 120
/** 1 画面ぶん送るとき、前の画面と重ねて残す高さ */
const PAGE_OVERLAP_PX = 48
/** スクロールが止まってから既読を知らせるまでの待ち */
const READ_DELAY_MS = 300

/** 描いたことのあるレスの高さ。タブを作り直しても使えるよう、スレ表示の外に置く */
const heights = new HeightCache()
/** タブを閉じたときに読んでいた位置。全部読み終えたスレを開き直したときに戻す(アプリを閉じるまで) */
const closedPositions = new PositionMemory()
/** タブを閉じたときの位置(開く位置を決めるときに見る) */
export const closedPosition = (threadKey: string) => closedPositions.get(threadKey)
/** ログを消したスレ。閉じるときの位置の覚えを捨てたあとに、閉じられるスレ表示が書き戻さないように(開き直したら外す) */
const droppedThreads = new Set<string>()
/**
 * 覚えた位置を捨てる(ログの削除)。開き直すと先頭か既読の次から始まる。
 * タブを閉じる処理と同じ描画で呼ばれ、スレ表示はそのあとで外れるので、外れるときの保存も止める
 */
export function forgetClosedPosition(threadKey: string) {
  closedPositions.delete(threadKey)
  droppedThreads.add(threadKey)
}

/** スクロール領域ごとの、いま動かしている(留めている)のをやめる関数。新しく動かすときに前のをやめる */
const moving = new WeakMap<HTMLElement, () => void>()
/** その領域を、いま動かしている(runMove の最中・留めている)か。実況モードは、その間は動かさない */
export const isMoving = (root: HTMLElement) => moving.has(root)
/** スクロール領域ごとの、動きが終わったら基準のレスを見張りへ引き継ぐ関数 */
const handOff = new WeakMap<HTMLElement, (el?: HTMLElement) => void>()
/** スクロール領域ごとの、利用者が動かした回数。絞り込みの一番下まで読んだかの判断に使う */
const userMoves = new WeakMap<HTMLElement, number>()

/**
 * スクロールの動かし方の本体。決めた時間で行き先へ向かい、着いたあとも行き先が動かなくなるまで合わせ直す
 * (行き先の周りの中身が作られ、上のレスが実際の高さになると、行き先がずれるため)。行き先は関数で受け取り、毎回測り直す。
 * ブラウザのなめらかなスクロールは、距離が長いと遅く、途中で別のスクロールに割り込まれると止まるので使わない。
 * 同じ領域で別の動きを始めたら前の動きはやめ、利用者が動かしたらやめる。終わったら基準のレス(el があればそれ)を見張りに引き継ぐ。
 */
function runMove(root: HTMLElement, target: () => number, o: { ms: number; pressStops: boolean; watchSize: boolean; el?: HTMLElement }) {
  moving.get(root)?.()
  const clamped = () => Math.max(0, Math.min(target(), root.scrollHeight - root.clientHeight))
  const from = root.scrollTop
  // 時間は最初のコマから数える(開いた直後は 1000 件の枠を描くのに数百 ms かかり、作った時刻から数えると最初のコマで「着いた」ことになって、
  // 直後の高さの変化を直せない)
  let start = NaN
  let written = NaN
  let last = NaN
  let lastChange = NaN
  let stopped = false
  const write = (v: number) => {
    root.scrollTop = v
    written = root.scrollTop
  }
  /** 行き先へ合わせる。描く前(ResizeObserver の中)にも呼ぶので、別の所が一瞬見えることがない */
  const settle = () => {
    const to = clamped()
    if (Math.abs(root.scrollTop - to) >= 0.5) write(to)
    if (Math.abs(to - last) >= 1) {
      last = to
      lastChange = performance.now()
    }
  }
  const animating = () => o.ms > 0 && (Number.isNaN(start) || performance.now() - start < o.ms)
  const observer = o.watchSize
    ? new ResizeObserver(() => {
        if (!animating()) settle()
      })
    : undefined
  if (observer) for (const child of root.children) observer.observe(child)
  // スクロールバー(スクロール領域そのもの)と、領域の外(ミニマップなど)を押したらやめる。
  // レスを押しただけでやめるかは呼ぶ側が決める
  const onPointer = (e: PointerEvent) => {
    if (o.pressStops || e.target === root || !(e.target instanceof Node && root.contains(e.target))) stop()
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    observer?.disconnect()
    root.removeEventListener('wheel', stop)
    root.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', stop)
    window.removeEventListener('pointerdown', onPointer, true)
    // 基準のレスは、やめたその場で見張りへ引き継ぐ(次のコマまで待つと、その間に上のレスの高さが変わっても誰も直さない)。
    // 次の動きがもう始まっていれば(moving が自分でない)、そちらに任せる
    if (moving.get(root) !== stop) return
    moving.delete(root)
    handOff.get(root)?.(o.el)
  }
  moving.set(root, stop)
  root.addEventListener('wheel', stop, { passive: true })
  root.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', stop)
  window.addEventListener('pointerdown', onPointer, true)
  if (o.ms <= 0) settle()
  const step = (now: number) => {
    if (stopped) return
    if (Number.isNaN(start)) start = lastChange = now
    if (movedByOthers(root.scrollTop, written, root.scrollHeight - root.clientHeight)) return stop()
    const t = o.ms <= 0 ? 1 : (now - start) / o.ms
    if (t < 1) {
      write(from + (clamped() - from) * (1 - (1 - t) ** 3))
      lastChange = now
    } else settle()
    if (settleDone({ now, start, lastChange }, SETTLE_MS, FOLLOW_MAX_MS)) stop()
    else requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * 決めた時間で、素早く(終わりだけゆっくり)スクロールする(キー操作など短い動き)。ms が 0 ならその場で移る。
 * レスを押してもやめる
 */
export function animateScroll(root: HTMLElement, target: () => number, ms = JUMP_MS) {
  userMoves.set(root, (userMoves.get(root) ?? 0) + 1)
  runMove(root, target, { ms, pressStops: true, watchSize: false })
}

/**
 * レスへ飛ぶ。アンカー・ミニマップ・未読・通知・位置の復元は、すべてここを通す。
 * 見積もりの位置へ移り、行き先の周りの中身が作られて高さが変わるたびに実測で直し、動かなくなったら見張りへ引き継ぐ。
 * 引き継いだあとも、利用者がスクロールするまで、そのレスを同じ位置に留める
 */
export function jumpScroll(root: HTMLElement, el: HTMLElement, viewOffset: () => number, ms = 0) {
  runMove(root, () => root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - viewOffset(), { ms, pressStops: false, watchSize: true, el })
}

/**
 * レスを包む枠(.post-cv)。番号は枠に持たせてある(NG で中身を描かないレスも数えるため)。
 * 枠はレス一覧の直下に画面の並び(番号の順か、ツリーの順)で並び、後ろに -END- などが続く。DOM 全体を検索すると、スクロールのたびに数千の要素をなめる。
 * ツリーで重ねて出した分(data-dup。data-post がない)は入れない(既読・キー操作・位置はレス 1 件につき 1 枠で数える)
 */
export function framesIn(list: HTMLElement | null): HTMLElement[] {
  if (!list) return []
  const all = list.children
  const out: HTMLElement[] = []
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement
    if (el.dataset.post !== undefined) out.push(el)
  }
  return out
}

interface Options {
  /** スクロールする領域 */
  rootRef: RefObject<HTMLDivElement | null>
  /** レスを並べた領域(幅と、中身の高さの変化を見る) */
  listRef: RefObject<HTMLDivElement | null>
  /** スレのヘッダー。スクロール領域の中にあるときは、その高さを差し引いて位置を合わせる */
  headerRef: RefObject<HTMLDivElement | null>
  /** スレを見分ける値(覚えておいた高さの持ち主) */
  threadKey: string
  log: ThreadLog
  byNo: Map<number, Post>
  /** NG で畳んで出すレスか(畳んだ高さで見積もる。本文の長さで見積もると大きく外れる) */
  isCollapsed?: (p: Post) => boolean
  /** 頭(名前の行)を省いて出すレスか */
  isContinued?: (p: Post) => boolean
  /** 描くときの本文(BE のアイコンを除く・空行を整える。PostArticle と同じ)。高さの見積もりはこの本文で数える */
  bodyOf?: (p: Post) => string
  /** URL の見せ方(短く出す・画像の札)。本文の折り返しの数に効く */
  urlDisplay?: UrlDisplay
  /** レスの高さを変える設定をまとめた文字列(見た目・字の大きさ・ID の位置など)。変わったら覚えた高さと補正を使わない */
  layoutKey: string
  unreadFrom: number
  active: boolean
  initialPosition?: ScrollPosition
  onSavePosition: (pos: ScrollPosition) => void
  onRead: (no: number) => void
  openPosition: OpenPosition
  autoScrollOnNew: boolean
  showThumbnails: boolean
  showLinkPreview: boolean
  /** 通知などから指定されたレスへ飛ぶ。seq が変わったときだけ飛ぶ。flash なら光らせ、新着が届いても動かさない(URL のレス番号) */
  jumpTo?: { no: number; seq: number; flash?: boolean }
  /** 絞り込み・検索で一部のレスだけを出しているか */
  filtering?: boolean
  /**
   * ツリー表示か。枠が番号の順に並ばないので、未読へはそのレスそのものへ飛び、開いたときの「最初の未読」は既読の番号のレスへ置く。
   * 新着が届いても動かさない(途中に入るので、読んでいる位置を保つ)
   */
  tree?: boolean
}

export function useThreadScroll(o: Options) {
  const { rootRef, listRef, headerRef, log, byNo, unreadFrom } = o
  // 作り置きの関数から、いまの値を見るための控え
  const latest = useRef(o)
  latest.current = o

  /** スクロール位置の計算で差し引くヘッダーの高さ(ヘッダーがスクロール領域の外にあれば 0) */
  const headerOffset = useCallback(
    () => (rootRef.current?.contains(headerRef.current) ? (headerRef.current?.offsetHeight ?? 0) : 0),
    [rootRef, headerRef],
  )

  const positioned = useRef(false)
  /** 開いてから、まだ利用者がスクロールの操作(ホイール・クリック・キー)をしていないか */
  const untouched = useRef(true)
  /** 開いてから、まだ新着を受け取っていない(次に届くのは開いたときの取得の分) */
  const firstGrowth = useRef(true)
  /** 知らせた既読の番号 */
  const sent = useRef(log.readNo)
  const atBottom = useRef(false)
  /** 開いたときに未読の頭がまだ手元になかった。新着が届いたらそこへ移る */
  const pendingUnread = useRef(false)
  /** URL のレス番号へ飛んだあと、利用者が触るまで。新着が届いても位置を動かさない */
  const heldJump = useRef(false)
  const position = useRef<ScrollPosition | undefined>(o.initialPosition)
  /** 前の描画のときの最後のレス番号とレス数(新着を見分ける) */
  const lastMax = useRef(0)
  const prevCount = useRef(log.posts.length)

  // ── 高さ ──

  /** レス一覧の幅。高さの見積もりと、覚えた高さの持ち分けに使う */
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  widthRef.current = width
  const metrics = useRef({ fontSize: 16 })

  /** 覚えた高さの持ち主。設定が変わると高さも変わるので、スレと設定の組で分ける */
  const heightOwner = () => `${latest.current.threadKey}\n${latest.current.layoutKey}`
  /**
   * 覚えた高さの控え(番号 → 高さ。覚えていなければ null)。レス一覧を作り直すたびに 1000 件の仮の高さを引くので、
   * 文字列の鍵を作らずに済むようにする。幅や設定が変わったら持ち直す
   */
  const knownHeights = useRef({ thread: '', layout: '', width: -1, byNo: new Map<number, number | null>() })
  const knownMap = () => {
    const k = knownHeights.current
    const { threadKey: thread, layoutKey: layout } = latest.current
    const w = widthRef.current
    if (k.thread !== thread || k.layout !== layout || k.width !== w) Object.assign(k, { thread, layout, width: w, byNo: new Map() })
    return k.byNo
  }
  const knownHeight = (no: number): number | undefined => {
    const map = knownMap()
    let h = map.get(no)
    if (h === undefined) {
      h = heights.get(heightOwner(), widthRef.current, no) ?? null
      map.set(no, h)
    }
    return h ?? undefined
  }
  const keepHeight = (no: number, h: number) => {
    heights.set(heightOwner(), widthRef.current, no, h)
    knownMap().set(no, h)
  }

  /**
   * 見積もりに使う寸法と補正。レスの見た目(カード・Discord 風・専ブラ風・LINE 風)や密度で、本文の幅・頭の高さ・余白が変わるので、
   * 描いたレスから実測して合わせる。全体の中央値だけだと、頭を省いたレスやサムネイルのあるレスが外れるので、種類ごとに分ける。
   * 幅や設定が変わったら集め直す
   */
  const calib = useRef({
    width: 0,
    layout: '',
    samples: [] as { no: number; actual: number }[],
    seen: 0,
    /** 見つかった本文の一番広い幅(LINE 風の吹き出しは中身に合わせて縮むので、広いものを覚える) */
    bodyWidth: 0,
    /** 見積もりに使っている寸法。見直すまで変えない */
    body: undefined as { width: number; font: number; line: number; thumbs: number } | undefined,
    offsets: { all: 0, byKind: new Map<string, number>() },
    /** 寸法か、幅・設定が変わるたびに増やす。控えた見積もりがまだ使えるかを、文字列を作らずに見分ける */
    version: 0,
  })
  /** 補正を見直したら 1 回描き直す(仮の高さを、スクロールする前に補正した値にしておく) */
  const [calibVersion, setCalibVersion] = useState(0)
  const calibNow = () => {
    const c = calib.current
    const w = widthRef.current
    const layout = latest.current.layoutKey
    if (c.width !== w || c.layout !== layout) Object.assign(c, { width: w, layout, samples: [], seen: 0, bodyWidth: 0, body: undefined, offsets: { all: 0, byKind: new Map() }, version: c.version + 1 })
    return c
  }

  /**
   * 見積もった高さと種類の控え。本文を 1 文字ずつ数え、URL を探すので、レスごとに 1 回で済ませる(幅などが変わったら数え直す)。
   * J・K で選ぶレスが変わるたびに全部のレスの仮の高さを引くので、ここで数え直すと重くなる
   */
  const estimates = useRef(new WeakMap<Post, { version: number; h: number; kind: string; final?: number }>())
  const estimateOf = (p: Post) => {
    const c = calibNow()
    const kept = estimates.current.get(p)
    if (kept && kept.version === c.version) return kept
    const w = widthRef.current
    const f = c.body?.font ?? metrics.current.fontSize
    const shape = { showThumbnails: latest.current.showThumbnails, showLinkPreview: latest.current.showLinkPreview }
    // 測る前の寸法は、既定の見た目(カード)の値。左右の余白 28px、頭(名前の行)と上下の余白で字の 2.5 倍
    const bodyWidth = c.body?.width ?? w - 28
    const thumb = c.body?.thumbs ?? 80
    const { media, links } = postShape(p, shape)
    const entry: { version: number; h: number; kind: string; final?: number } = {
      version: c.version,
      h: estimatePostHeight(
        p,
        {
          // 本文の幅に、全角が何文字入るか。測る前は、左右の余白とアイコンの分を除いた幅で見積もる
          charsPerLine: Math.max(10, Math.floor(bodyWidth / f)),
          lineHeight: c.body?.line ?? f * 1.625,
          aaLineHeight: f * AA_LINE_HEIGHT,
          chrome: f * 2.5,
          thumbRow: thumb + 8,
          linkPreview: 88,
          ...shape,
          thumbsPerRow: Math.floor((bodyWidth + 8) / (thumb + 8)),
          urls: latest.current.urlDisplay,
        },
        latest.current.bodyOf?.(p),
      ),
      kind: heightKind({ continued: latest.current.isContinued?.(p), media: media > 0, links: links > 0 }),
    }
    estimates.current.set(p, entry)
    return entry
  }
  /** 本文から見積もった高さ(測った高さでの補正の前) */
  const rawEstimate = (p: Post): number => (latest.current.isCollapsed?.(p) ? 36 : estimateOf(p).h)
  const kindOf = (p: Post): string => (latest.current.isCollapsed?.(p) ? 'ng' : estimateOf(p).kind)
  /** 本文の幅を測り、一番広いものを覚える。字の大きさと行の高さは recalibrate で読む */
  const probeBody = (frame: HTMLElement) => {
    const c = calibNow()
    const body = frame.querySelector<HTMLElement>('p[data-post-body]')
    if (!body) return
    c.bodyWidth = Math.max(c.bodyWidth, body.clientWidth)
  }
  /** 集まった実測で、寸法と種類ごとの補正を見直す */
  const recalibrate = (frame: HTMLElement) => {
    const c = calibNow()
    // 本文の p を測る(外側の div は字下げの余白を含み、行の高さも本文とは違う)。AA の p は行の高さが違うので測らない
    const body = frame.querySelector<HTMLElement>('p[data-post-body]:not(.aa-font)')
    if (body && c.bodyWidth > 0) {
      const cs = getComputedStyle(body)
      const font = parseFloat(cs.fontSize) || metrics.current.fontSize
      const line = parseFloat(cs.lineHeight) || font * 1.625
      const thumbs = parseFloat(getComputedStyle(frame).getPropertyValue('--post-thumb-size')) || 80
      c.body = { width: c.bodyWidth, font, line, thumbs }
      c.version++
    }
    const samples: { kind: string; diff: number }[] = []
    for (const s of c.samples) {
      const p = latest.current.byNo.get(s.no)
      if (p) samples.push({ kind: kindOf(p), diff: s.actual - rawEstimate(p) })
    }
    c.offsets = heightOffsets(samples)
    // 補正を足した高さの控えを作り直す
    c.version++
    setCalibVersion((v) => v + 1)
  }
  /** 描いたレスの実際の高さを、補正の材料にする */
  const learn = (frame: HTMLElement, no: number, actual: number) => {
    const c = calibNow()
    if (!latest.current.byNo.has(no)) return
    probeBody(frame)
    c.samples.push({ no, actual })
    if (c.samples.length > CALIB_KEEP) c.samples.shift()
    c.seen++
    if (CALIB_AT.includes(c.seen)) recalibrate(frame)
  }

  /** まだ描いていないレスの仮の高さ(content-visibility の contain-intrinsic-size に使う) */
  const intrinsicHeight = useCallback(
    (p: Post): number => {
      const known = knownHeight(p.no)
      if (known !== undefined) return known
      const { all, byKind } = calibNow().offsets
      if (latest.current.isCollapsed?.(p)) return Math.max(16, Math.round(36 + (byKind.get('ng') ?? 0)))
      const e = estimateOf(p)
      e.final ??= Math.max(16, Math.round(e.h + (byKind.get(e.kind) ?? all)))
      return e.final
    },
    // 幅・設定が変わったとき、補正を見直したときに見積もり直す
    [width, calibVersion, o.layoutKey, o.showLinkPreview, o.showThumbnails],
  )

  /** 枠の中身が実際に配置されているか。content-visibility で省かれている間の高さは仮の高さなので、覚えない */
  const laidOut = (frame: HTMLElement): boolean => {
    const child = frame.firstElementChild as (Element & { checkVisibility?: (o: { contentVisibilityAuto: boolean }) => boolean }) | null
    return child?.checkVisibility?.({ contentVisibilityAuto: true }) !== false
  }

  /** 画面の近くにある(描かれている)レスの高さを覚える */
  const rememberHeights = (frames: readonly HTMLElement[], rects: PostRect[], from: number, to: number) => {
    const w = widthRef.current
    if (w <= 0) return
    rects.forEach((r, i) => {
      // まだ中身を作っていないレス(仮の高さの箱)は覚えない
      if (r.hidden || r.placeholder || r.bottom < from || r.top > to || !laidOut(frames[i])) return
      const h = Math.round(r.bottom - r.top)
      if (knownHeight(r.no) === undefined) learn(frames[i], r.no, h)
      keepHeight(r.no, h)
    })
  }

  /**
   * 中身を作ってあるレスの高さを、いますぐ全部覚える。画面から遠いレスの中身を外す(仮の高さの箱に戻す)前に呼ぶ。
   * 覚えておけば、箱に戻しても高さが変わらず、スクロールの位置もスクロールバーも動かない
   */
  const rememberRendered = useCallback(() => {
    const root = rootRef.current
    const w = widthRef.current
    if (!root || w <= 0) return
    for (const el of framesIn(listRef.current)) {
      if (el.hidden || el.dataset.placeholder !== undefined || !laidOut(el)) continue
      const no = Number(el.dataset.post)
      const h = Math.round(el.getBoundingClientRect().height)
      if (knownHeight(no) === undefined) learn(el, no, h)
      keepHeight(no, h)
    }
  }, [rootRef])

  // ── 動かす ──

  // 飛んだ先として光らせるレス(番号と回数。同じレスへ続けて飛んでも光り直せるよう、回数で見分ける)
  const [jumpFlash, setJumpFlash] = useState<{ no: number; seq: number }>()
  const jumpFlashSeq = useRef(0)
  const jumpFlashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(jumpFlashTimer.current), [])
  /** 飛んだ先のレスを少しのあいだ光らせる(どこから飛んでも同じ見た目・同じ長さ。スマホ版の flashJump と同じ) */
  const flashPost = useCallback((no: number) => {
    setJumpFlash({ no, seq: ++jumpFlashSeq.current })
    clearTimeout(jumpFlashTimer.current)
    jumpFlashTimer.current = setTimeout(() => setJumpFlash(undefined), JUMP_FLASH_MS)
  }, [])

  /**
   * 特定のレスへ飛ぶ(ミニマップの印・アンカー・履歴・通知・URL のレス番号)。
   * そのレスを見える範囲の縦の真ん中に置き(レスが画面より高ければ頭を上に)、光らせる。
   * 行き先のレスの高さは着いてから分かることがあるので、jumpScroll が着くまで測り直して真ん中に合わせ続ける
   */
  const scrollToPost = useCallback(
    (no: number, opts: { flash?: boolean; animate?: boolean } = {}) => {
      const root = rootRef.current
      const el = root?.querySelector<HTMLElement>(`[data-post="${no}"]`)
      if (!root || !el || el.hidden) return false
      userMoves.set(root, (userMoves.get(root) ?? 0) + 1)
      jumpScroll(root, el, () => centerOffset(root.clientHeight, el.getBoundingClientRect().height, headerOffset()), opts.animate ? JUMP_MS : 0)
      if (opts.flash !== false) flashPost(no)
      return true
    },
    [rootRef, headerOffset, flashPost],
  )

  /**
   * 未読の頭を、見えている範囲の上から UNREAD_AT の位置に置く。
   * 上には既読のレスが少し見え、その下の「ここから未読」の線から下が未読、とひと目で分かるように
   */
  const scrollToUnread = useCallback(
    (no: number, behavior: 'instant' | 'animate' = 'instant') => {
      const root = rootRef.current
      if (!root) return
      // 絞り込みで隠れているレスは位置が取れない(0 になって上へ飛んでしまう)ので、
      // その後ろで見えている最初のレスへ送る。なければ一番下に留まる。
      // ツリーは番号の順に並ばないので、まずそのレスそのものを探す
      const frames = framesIn(listRef.current)
      const target =
        (latest.current.tree ? frames.find((w) => !w.hidden && Number(w.dataset.post) === no) : undefined) ??
        frames.find((w) => !w.hidden && Number(w.dataset.post) >= no)
      const ms = behavior === 'animate' ? JUMP_MS : 0
      if (!target) return animateScroll(root, () => root.scrollHeight, ms)
      // 「ここから未読」の線はレスの直前(枠の中)にあるので、枠ごとの位置で合わせる
      jumpScroll(
        root,
        target,
        () => {
          const headerH = headerOffset()
          return headerH + (root.clientHeight - headerH) * UNREAD_AT
        },
        ms,
      )
    },
    [rootRef, listRef, headerOffset],
  )

  /** 一番下・一番上へ。押して飛ぶときはすぐ移る(長いスレを流れていくのを待たせない)。新着を追いかけるときだけ animate */
  const jumpToBottom = useCallback(
    (animate = false) => {
      const root = rootRef.current
      if (root) animateScroll(root, () => root.scrollHeight, animate ? JUMP_MS : 0)
    },
    [rootRef],
  )

  const jumpToTop = useCallback(() => {
    const root = rootRef.current
    if (root) animateScroll(root, () => 0, 0)
  }, [rootRef])

  /** いま読んでいる位置(一番上に見えているレスと、一番下にいるか) */
  const getPosition = useCallback((): ScrollPosition | undefined => position.current && { ...position.current, bottom: atBottom.current }, [])

  /** 覚えておいた位置へすぐ戻す(一番下にいたなら一番下へ)。絞り込みを解いたときなどに使う */
  const restorePosition = useCallback(
    (pos: ScrollPosition) => {
      const root = rootRef.current
      if (!root) return
      if (pos.bottom) return animateScroll(root, () => root.scrollHeight, 0)
      const el = root.querySelector<HTMLElement>(`[data-post="${pos.no}"]`)
      if (el) jumpScroll(root, el, () => headerOffset() + pos.offset)
    },
    [rootRef, headerOffset],
  )

  /** 利用者が動かした回数。絞り込みを始めてから動かしたかを見る(絞り込みで縮んで一番下に押し戻されただけなら、読んだことにしない) */
  const userMoveCount = useCallback(() => (rootRef.current ? (userMoves.get(rootRef.current) ?? 0) : 0), [rootRef])
  const noteUserMove = useCallback(() => {
    const root = rootRef.current
    if (root) userMoves.set(root, (userMoves.get(root) ?? 0) + 1)
  }, [rootRef])

  /** 次(dir=1)・前(dir=-1)のレスの頭を、ヘッダーのすぐ下に合わせる(キー操作)。合わせたレスの番号を返す */
  const stepPost = useCallback(
    (dir: 1 | -1): number | undefined => {
      const root = rootRef.current
      if (!root) return undefined
      const viewTop = root.getBoundingClientRect().top + headerOffset()
      const frames = framesIn(listRef.current).filter((w) => !w.hidden)
      const topOf = (i: number) => frames[i].getBoundingClientRect().top
      const target =
        dir > 0
          ? frames[firstAfter(frames.length, topOf, viewTop + 2)]
          : frames[firstAfter(frames.length, topOf, viewTop - 2.001) - 1]
      if (!target) {
        // もう先がなければ、端まで送る(選ぶレスは端のレス)
        if (dir > 0) jumpToBottom()
        else jumpToTop()
        const edge = dir > 0 ? frames.at(-1) : frames[0]
        return edge ? Number(edge.dataset.post) : undefined
      }
      animateScroll(root, () => root.scrollTop + target.getBoundingClientRect().top - viewTop, STEP_MS)
      return Number(target.dataset.post)
    },
    [rootRef, listRef, headerOffset, jumpToBottom, jumpToTop],
  )

  /**
   * 1 画面ぶん(half なら半画面ぶん)下(dir=1)・上(dir=-1)へ。少し重ねて、続きが分かるようにする(キー操作)。
   * 実際に動く量(端で止まる分を引いたもの)を返す
   */
  const page = useCallback(
    (dir: 1 | -1, half = false): number => {
      const root = rootRef.current
      if (!root) return 0
      const full = root.clientHeight - headerOffset()
      const max = root.scrollHeight - root.clientHeight
      const to = Math.min(max, Math.max(0, root.scrollTop + dir * Math.max(40, half ? full / 2 : full - PAGE_OVERLAP_PX)))
      const moved = to - root.scrollTop
      // 行き先はレスの位置から測る(上のレスの高さが変わっても、送る量が変わらないように)
      const frames = framesIn(listRef.current)
      const viewTop = root.getBoundingClientRect().top + headerOffset()
      const el = frames[firstAfter(frames.length, (i) => (frames[i].hidden ? undefined : frames[i].getBoundingClientRect().bottom), viewTop)]
      if (!el) {
        animateScroll(root, () => to, STEP_MS)
        return moved
      }
      const aim = el.getBoundingClientRect().top - moved
      animateScroll(root, () => root.scrollTop + el.getBoundingClientRect().top - aim, STEP_MS)
      return moved
    },
    [rootRef, listRef, headerOffset],
  )

  // ── 読んだところ ──

  /**
   * ツリー表示で画面に出したレスの番号(スレを開いている間だけ持つ)。途中の既読は 1 番から途切れずに出し終えた所まで進める(treeRead)。
   * 既読の判断は止まってから(READ_DELAY_MS)なので、流れていく途中のレスもここで拾う(スクロールのコマごと。見えている枠だけ測る)
   */
  const seenNos = useRef(new Set<number>())
  const markSeen = useCallback(() => {
    const root = rootRef.current
    if (!root || !latest.current.tree) return
    const box = root.getBoundingClientRect()
    const viewTop = box.top + headerOffset()
    const frames = framesIn(listRef.current)
    for (let i = firstAfter(frames.length, (k) => (frames[k].hidden ? undefined : frames[k].getBoundingClientRect().bottom), viewTop); i < frames.length; i++) {
      const el = frames[i]
      if (el.hidden) continue
      if (el.getBoundingClientRect().top >= box.bottom) break
      seenNos.current.add(Number(el.dataset.post))
    }
  }, [rootRef, listRef, headerOffset])

  /** どこまで読んだかを測って知らせ、読んでいた位置を覚える */
  const reportRead = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const box = root.getBoundingClientRect()
    const viewTop = box.top + headerOffset()
    const rects: PostRect[] = []
    const frames = framesIn(listRef.current)
    // レスの枠がまだない(読み込み中の画面)なら、何も読んでいない。
    // startTransition で描く途中は latest.current.log にレスがあっても画面はまだ前のまま(枠 0 件・高さ 0)で、
    // 「一番下にいる」と見なして全部を既読にしてしまうことがあった
    if (frames.length === 0) return
    const measured: HTMLElement[] = []
    // 枠を測る(中身を測ると、画面の外で省いた計算をやり直させてしまう)。
    // 高さを覚える範囲(画面の上半分ほど)の頭から、画面より 1 画面ぶん下までだけ測る(その外は既読にも高さを覚えるのにも要らない)
    let from = firstAfter(frames.length, (i) => (frames[i].hidden ? undefined : frames[i].getBoundingClientRect().bottom), box.top - box.height / 2)
    // 全部の枠より下まで来ていても(-END- の下)、最後のレスまでは読んだことにする
    if (from === frames.length) while (from > 0 && (from === frames.length || frames[from].hidden)) from--
    for (let i = from; i < frames.length; i++) {
      const el = frames[i]
      const r = el.getBoundingClientRect()
      measured.push(el)
      rects.push({ no: Number(el.dataset.post), top: r.top, bottom: r.bottom, hidden: el.hidden, placeholder: el.dataset.placeholder !== undefined })
      if (r.top >= box.bottom + box.height) break
    }
    atBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < BOTTOM_PX
    // 絞り込みで中身が縮むと一番下に見えるが、読んだわけではない(全部既読になって戻せなくなる)
    const readAll = atBottom.current && !latest.current.filtering
    // 一番下にいるとき全部読んだことにする最後の番号は、画面にある枠から数える(ログだけ先に増えていることがある)
    const lastNo = frames.reduce((m, f) => Math.max(m, Number(f.dataset.post)), 0)
    const progress = readProgress({ rects, viewTop, viewBottom: box.bottom, atBottom: readAll, lastNo })
    const pos = progress.position
    let last = progress.last
    // ツリー: 画面の並びは番号の順ではないので、途中では 1 番から途切れずに出し終えた所まで。
    // 一番下に着いたら番号の順と同じく全部(飛ばして出していないレスがあっても。そうしないと未読の数が残る)
    if (latest.current.tree) {
      markSeen()
      last = treeRead({
        nos: latest.current.log.posts.map((p) => p.no),
        readNo: sent.current,
        seen: seenNos.current,
        atBottom: readAll,
        lastNo,
      })
    }
    // 描かれているのは画面とその上下半画面ほど(content-visibility の範囲)なので、そこだけ覚える
    rememberHeights(measured, rects, box.top - box.height / 2, box.bottom + box.height / 2)
    if (last > sent.current) {
      sent.current = last
      latest.current.onRead(last)
    }
    // 位置にはそのときの既読を添える(開き直すとき、同期で既読が先へ進んでいれば覚えた位置ではなく既読の次から)
    if (pos) position.current = { ...pos, readNo: sent.current }
  }, [rootRef, listRef, headerOffset, markSeen])

  // ── 開いたとき ──

  // 最初にレスが出たときだけ、設定どおりの位置へ移動する
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || positioned.current || log.posts.length === 0) return
    positioned.current = true
    // 開いたときは空のログ(読み込み中)から始まることがあるので、既読の番号は中身が届いたこの時に合わせる
    sent.current = Math.max(sent.current, log.readNo)
    const saved = latest.current.initialPosition
    const closed = closedPosition(latest.current.threadKey)
    const savedEl = (no?: number) => (no === undefined ? null : root.querySelector<HTMLElement>(`[data-post="${no}"]`))
    const t = openTarget({
      saved,
      savedFound: !!savedEl(saved?.no),
      closed: savedEl(closed?.no) ? closed : undefined,
      openPosition: latest.current.openPosition,
      unreadFrom,
      hasUnreadPost: byNo.has(unreadFrom),
      readNo: sent.current,
    })
    if (t.kind === 'bottom') {
      animateScroll(root, () => root.scrollHeight, 0)
      pendingUnread.current = t.pendingUnread
    } else if (t.kind === 'unread') {
      // ツリーでは未読の頭が途中に散らばるので、既読の番号のレス(読んでいた所)へ
      scrollToUnread(latest.current.tree ? Math.max(1, t.no - 1) : t.no)
    } else if (t.kind === 'saved') {
      pendingUnread.current = !!t.pendingUnread
      const el = savedEl(t.position.no)
      if (el) jumpScroll(root, el, () => headerOffset() + t.position.offset)
    }
    // この描画で届いたレスは「新着」として扱わない(下の effect が追いかけないように)
    prevCount.current = log.posts.length
    lastMax.current = log.posts.at(-1)?.no ?? 0
    reportRead()
    // 描いたレスの高さは、1 度描いてからでないと測れない(content-visibility で省いた枠は、最初の描画で見える範囲が決まる)。
    // 次のコマで測って見積もりの寸法を合わせ、全部の仮の高さを早いうちに実測に近づける(待つと、しばらくしてスクロールバーが縮む)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => latest.current.active && reportRead()))
    return () => cancelAnimationFrame(raf)
  }, [log, unreadFrom, byNo, rootRef, headerOffset, reportRead, scrollToUnread])

  // 開き直したスレは、閉じるときの位置をまた覚える
  useEffect(() => void droppedThreads.delete(latest.current.threadKey), [])

  // 画面から外れるときに、読んでいた位置を渡す(ログを消したスレは渡さない)
  useEffect(
    () => () => {
      if (!position.current || droppedThreads.has(latest.current.threadKey)) return
      latest.current.onSavePosition(position.current)
      closedPositions.set(latest.current.threadKey, position.current)
    },
    [],
  )

  // 通知などから指定されたレスへ飛ぶ(開いたときの位置合わせのあとに)。
  // 飛ぶ先がまだ手元になければ、新着で届いたときに飛ぶ
  const jumpedSeq = useRef<number>(undefined)
  useEffect(() => {
    const j = o.jumpTo
    if (!j || jumpedSeq.current === j.seq || !byNo.has(j.no)) return
    jumpedSeq.current = j.seq
    // URL のレス番号(flash)は、利用者が触るまで新着が届いても動かさない。どこから来ても、そのレスを真ん中に置いて光らせる
    if (j.flash) {
      heldJump.current = true
      pendingUnread.current = false
    }
    scrollToPost(j.no, { animate: !j.flash })
    // seq が変わったときと、レスが届いたときだけ見る
  }, [o.jumpTo?.seq, byNo.size])

  // ── 位置の固定 ──

  /**
   * 基準のレスと、そのスクロールの中での位置(領域の上端からの位置 + scrollTop。スクロールしても変わらず、上のレスの高さが変わったときだけ変わる)。
   * 上のレスの高さが変わったら(描く範囲を動かした・仮の高さを補正した・省いていたレスが描かれた・札が読み込まれた)、
   * 描く前に同じ量だけ scrollTop を足して、画面の中を動かさない。WebKit には overflow-anchor がないので、どのブラウザでもこれで行う
   * (二重に効かないよう、app.css で overflow-anchor: none にしてある)。
   * written は自分で動かした後の scrollTop。スクロールのイベントが自分の分なら、基準を選び直さない(飛んだ先のレスを基準のまま留めるため)
   */
  const anchor = useRef<{ el: HTMLElement; y: number; scrollTop: number; written: number }>(undefined)
  const setAnchor = useCallback(
    (el: HTMLElement) => {
      const root = rootRef.current
      if (root) anchor.current = { el, y: el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop, scrollTop: root.scrollTop, written: NaN }
    },
    [rootRef],
  )
  /**
   * 見える範囲の真ん中にあるレスを基準にし(あとで上のレスの高さが変わっても、そのレスを同じ所に留める)、必要なら光らせる。
   * ミニマップのつまみを離したときに使う(つまみで流したあとの「飛んだ先」はそのレス)
   */
  const pinCenter = useCallback(
    (flash: boolean): number | undefined => {
      const root = rootRef.current
      if (!root) return undefined
      const headerH = headerOffset()
      const center = root.getBoundingClientRect().top + headerH + (root.clientHeight - headerH) / 2
      const frames = framesIn(listRef.current)
      const i = firstAfter(frames.length, (k) => (frames[k].hidden ? undefined : frames[k].getBoundingClientRect().bottom), center)
      let el: HTMLElement | undefined = frames[i]
      // 真ん中より下にレスがなければ(末尾の空き)、見えている最後のレス
      for (let k = frames.length - 1; el === undefined && k >= 0; k--) if (!frames[k].hidden) el = frames[k]
      if (!el) return undefined
      setAnchor(el)
      const no = Number(el.dataset.post)
      if (flash) flashPost(no)
      return no
    },
    [rootRef, listRef, headerOffset, setAnchor, flashPost],
  )
  /** 見えている先頭のレスを基準にする。動かしている間は、動かす方が行き先を測っているので何もしない */
  const recordAnchor = useCallback(() => {
    const root = rootRef.current
    if (!root || moving.has(root) || !latest.current.active) return
    const viewTop = root.getBoundingClientRect().top + headerOffset()
    const frames = framesIn(listRef.current)
    // 枠は上から順に並んでいるので半分ずつ探す(先頭から測ると、下の方を読むほど 1 コマごとに測る数が増える)
    const i = firstAfter(frames.length, (k) => (frames[k].hidden ? undefined : frames[k].getBoundingClientRect().bottom), viewTop)
    if (i < frames.length) setAnchor(frames[i])
    else anchor.current = undefined
  }, [rootRef, listRef, headerOffset, setAnchor])
  /** 基準のレスが動いていれば戻す。測るのは基準の 1 枠だけ */
  const fixAnchor = useCallback(() => {
    const root = rootRef.current
    const a = anchor.current
    if (!root || !a || moving.has(root) || !positioned.current || !latest.current.active) return
    // 基準が隠れた(絞り込み)・なくなったら、次のスクロールで選び直す
    if (a.el.hidden || !a.el.isConnected) {
      anchor.current = undefined
      return
    }
    const y = a.el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
    const to = anchorShift(a, { y, scrollTop: root.scrollTop, maxScrollTop: root.scrollHeight - root.clientHeight })
    a.y = y
    if (to === undefined) return
    root.scrollTop = to
    a.scrollTop = root.scrollTop
    a.written = root.scrollTop
  }, [rootRef])
  // 描き直しのたび(依存なし)に確かめる。新着で動かす効果(下)より先に並べてあるので、動かす方が勝つ
  useLayoutEffect(fixAnchor)
  // 動きが終わったら、行き先のレス(なければ見えている先頭のレス)を基準にする
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    handOff.set(root, (el) => {
      if (el && !el.hidden) setAnchor(el)
      else recordAnchor()
    })
    return () => {
      handOff.delete(root)
    }
  }, [rootRef, setAnchor, recordAnchor])

  // ── 新着 ──

  // 新着として光らせ、順に出すレス。届いたときに番号と遅れ(ms)を控え、出し終わったら消す
  // (描画のたびに計算し直すと、既読の保存などの描き直しで光が途中で切れる)
  const [flashNos, setFlashNos] = useState<Map<number, number>>(new Map())
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useLayoutEffect(() => {
    const root = rootRef.current
    const grew = log.posts.length > prevCount.current
    prevCount.current = log.posts.length
    const prevLastNo = lastMax.current
    lastMax.current = log.posts.at(-1)?.no ?? 0
    if (!root || !grew || !positioned.current) return
    // 空のログで開いて手元のログが届いたとき(最初の中身)は新着ではない。位置は上の「開いたとき」が合わせている。
    // 新着として扱うと pendingUnread を消してしまい、あとで本当の新着が届いても未読の頭へ移らない
    if (prevLastNo === 0) return
    // 既読より後のレスだけが新着。別の端末で読んだ分が同期で既読になっていれば、あとから届いても光らせない
    const read = Math.max(sent.current, log.readNo)
    const fresh = log.posts.filter((p) => p.no > prevLastNo && p.no > read).map((p) => p.no)
    if (latest.current.tree) {
      // ツリー: 新着は途中に入るので動かさない(読んでいるレスは位置の固定が同じ所に留める)。光らせるだけ
      setFlashNos(staggerDelays(fresh, STAGGER_MS, STAGGER_TOTAL_MS))
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashNos(new Map()), FLASH_MS + STAGGER_TOTAL_MS)
      firstGrowth.current = false
      pendingUnread.current = false
      return
    }
    if (fresh.length === 0) {
      // 一番下で未読を待っていた・開いた直後なら、既読の末尾(新しい一番下)まで送る。未読の頭はまだないので、待ち続ける
      if (!heldJump.current && (pendingUnread.current || (untouched.current && firstGrowth.current))) scrollToUnread(read + 1)
      return
    }
    if (heldJump.current) {
      // 飛んだレスの光を消さず、位置も動かさない
      setFlashNos((m) => new Map([...staggerDelays(fresh, STAGGER_MS, STAGGER_TOTAL_MS), ...m]))
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashNos(new Map()), FLASH_MS + STAGGER_TOTAL_MS)
      firstGrowth.current = false
      pendingUnread.current = false
      return
    }
    setFlashNos(staggerDelays(fresh, STAGGER_MS, STAGGER_TOTAL_MS))
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashNos(new Map()), FLASH_MS + STAGGER_TOTAL_MS)
    const opening = untouched.current && firstGrowth.current
    firstGrowth.current = false
    const target = newPostsTarget({
      pendingUnread: pendingUnread.current,
      unreadFrom,
      hasUnreadPost: byNo.has(unreadFrom),
      prevLastNo,
      readNo: read,
      opening,

      autoScrollOnNew: latest.current.autoScrollOnNew,
      atBottom: atBottom.current,
    })
    pendingUnread.current = false
    // 新着が多いときは、なめらかに追いかけず(描きながらの追いかけはカクつく)、すぐ移る
    const many = fresh.length > MANY_NEW
    if (target && 'bottom' in target) jumpToBottom(!many)
    else if (target) scrollToUnread(target.no, target.animate && !many ? 'animate' : 'instant')
  }, [log.posts.length, byNo, unreadFrom, rootRef, scrollToUnread, jumpToBottom])

  // ── 見張り ──

  // 一番下へ飛ぶ丸いボタン。一番下から 1 画面ぶん以上離れているときだけ出す
  const [showJump, setShowJump] = useState(false)
  const updateJump = useCallback(() => {
    const root = rootRef.current
    if (root) setShowJump(root.scrollHeight - root.scrollTop - root.clientHeight > root.clientHeight)
  }, [rootRef])
  useLayoutEffect(updateJump, [log.posts.length, updateJump])

  // スクロールしたとき・中身の高さが変わったとき(新着が届いた・レスが描かれた)に、既読を進める。
  // 1 画面に収まるスレや、届いた新着がそのまま見えているときは、スクロールが起きないため高さの変化も見る。
  // 裏に残しているタブでは進めない(見ていないので)
  useEffect(() => {
    const root = rootRef.current
    const list = listRef.current
    if (!root) return
    let timer: ReturnType<typeof setTimeout>
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (latest.current.active) reportRead()
      }, READ_DELAY_MS)
    }
    // 測るのは 1 コマに 1 回(スクロールのイベントは 1 コマに何度も来ることがある)。
    // スクロールのイベントと同じコマのうちに走るので、描き直しの位置の固定には遅れない
    let scrollRaf = 0
    const onScrollFrame = () => {
      scrollRaf = 0
      const rest = root.scrollHeight - root.scrollTop - root.clientHeight
      atBottom.current = rest < BOTTOM_PX
      setShowJump(rest > root.clientHeight)
      // 自分で直した分のスクロールなら、基準はそのまま
      const ours = Math.abs(root.scrollTop - (anchor.current?.written ?? NaN)) < 1
      fixAnchor()
      if (!ours) recordAnchor()
      else if (anchor.current) anchor.current.scrollTop = root.scrollTop
      markSeen()
    }
    const onScroll = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(onScrollFrame)
      later()
    }
    // 幅を覚え直すと全部のレスの仮の高さを描き直すので、大きさが変わり続けているあいだは待ち、落ち着いてから 1 回だけ
    let widthTimer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      // 中身の高さが変わった(レスの枠の高さの合計が変わった)。描く前に基準のレスを戻す
      fixAnchor()
      updateJump()
      if (list) {
        const readFont = () => {
          metrics.current.fontSize = parseFloat(getComputedStyle(list).fontSize) || 16
        }
        const apply = () => {
          setWidth(list.clientWidth)
          readFont()
        }
        clearTimeout(widthTimer)
        // 高さだけの変化では幅の覚え直しは要らない(字の大きさは変わったかもしれない)
        if (list.clientWidth === widthRef.current) readFont()
        // まだ幅を知らない(開いたばかり)ときはすぐ覚える
        else if (widthRef.current === 0) apply()
        else widthTimer = setTimeout(apply, 150)
      }
      later()
    })
    observer.observe(root)
    if (list) observer.observe(list)
    // 利用者がスレ表示を触ったら、それ以降の新着へは動かして見せる
    const touch = () => {
      untouched.current = false
      heldJump.current = false
    }
    const moved = () => noteUserMove()
    const onPressRoot = (e: PointerEvent) => {
      // スクロールバーを押した(レスを押しただけでは動かない)
      if (e.target === root) moved()
    }
    root.addEventListener('scroll', onScroll)
    root.addEventListener('wheel', touch, { passive: true })
    root.addEventListener('pointerdown', touch)
    root.addEventListener('keydown', touch)
    root.addEventListener('wheel', moved, { passive: true })
    root.addEventListener('touchmove', moved, { passive: true })
    root.addEventListener('pointerdown', onPressRoot)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
      clearTimeout(widthTimer)
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', touch)
      root.removeEventListener('pointerdown', touch)
      root.removeEventListener('keydown', touch)
      root.removeEventListener('wheel', moved)
      root.removeEventListener('touchmove', moved)
      root.removeEventListener('pointerdown', onPressRoot)
    }
  }, [rootRef, listRef, updateJump, reportRead, recordAnchor, fixAnchor, noteUserMove, markSeen])

  /** 開いたときの位置決めが済んだか */
  const isPositioned = useCallback(() => positioned.current, [])

  // 裏のタブから表に戻したときも、見えている分を既読にする
  useEffect(() => {
    if (o.active && positioned.current) {
      reportRead()
      // 裏にある間は基準を見張らないので、表に戻ったら選び直す
      recordAnchor()
    }
  }, [o.active, reportRead, recordAnchor])

  return {
    scrollToPost,
    scrollToUnread,
    jumpToBottom,
    jumpToTop,
    stepPost,
    page,
    showJump,
    flashNos,
    /** 飛んだ先として光らせるレス(番号と回数) */
    jumpFlash,
    /** 真ん中のレスを基準にして(留めて)、光らせる */
    pinCenter,
    intrinsicHeight,
    getPosition,
    restorePosition,
    userMoveCount,
    noteUserMove,
    /** いま見えているところまでの既読を、待たずにすぐ知らせる(更新の直前など) */
    flushRead: reportRead,
    isPositioned,
    rememberRendered,
  }
}
