// 書き込み欄。スレ表示の下か右に置く(web 版の ReplyForm.tsx と同じ 2 通り)。
// 大きさは親が決め、本文の欄が残りいっぱいに広がる。
// 認証を求められたら(eddist の初回書き込みなど)、コードと認証ページへのボタンを出す。

import { stashGet, stashSet } from '../utils/draftStash'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AttachmentRules, PostConfirm, PostInput, PostLimits, PostResult } from '@bbs-browser/connectors'
import PostResultBox from './PostResultBox'
import { imageUrlsIn, looksLikeAA, youtubeIdsIn } from '../utils/postBody'
import type { UploadOptions } from '../host/uploader'
import { useMediaInput } from '../hooks/useMediaInput'
import { measurePost } from '../utils/postLimit'
import { isAutoLoadable } from '../utils/safeUrl'
import PostAccountMenu, { type PostAccountOption } from './PostAccountMenu'
import type { ReplyLayout } from '../ui/settings'

export interface ReplyFormHandle {
  /** 本文のカーソル位置に文字を入れる(>>12 の挿入など) */
  insert: (text: string) => void
  /** 本文の欄にカーソルを置く */
  focus: () => void
}

interface Props {
  /** 書き込みにファイルを付けられる掲示板の決まり(ふたば)。あれば画像のボタンはアップロードではなく添付になる */
  attach?: AttachmentRules
  /**
   * 本文が欄に収まるのに足りない高さ(px。マイナスなら余っている)。書くたびに知らせる。
   * 書き込み欄を下に置いているとき、欄を自動で伸び縮みさせるのに使う
   */
  onTextOverflow?: (deficit: number) => void
  layout: ReplyLayout
  /**
   * chat: スマホのスレ表示のフッターに組み込む、Discord・LINE のような 1 行の入力欄:
   * 丸い本文の欄(書くと伸びる)の左の端に ＋(画像を選ぶ・オプションで名前とメール)、右に丸い送るボタン。
   * 絵文字はスマホのキーボードで打てるので出さない
   */
  variant?: 'chat'
  /** chat: 入力欄の左に置くもの(戻るボタンなど) */
  leading?: ReactNode
  /** chat: 送るボタンの右に置くもの(更新ボタンなど) */
  trailing?: ReactNode
  /** chat: 本文が空のあいだ、送るボタンの代わりに出す操作 */
  idle?: { icon: string; title: string; onClick: () => void; disabled?: boolean }
  /** chat: 本文の欄に入った・出た(フッターを隠さないようにするため) */
  onFocusChange?: (focused: boolean) => void
  disabled?: string
  initialName: string
  initialMail: string
  onSubmit: (input: PostInput) => Promise<PostResult>
  /** 書き込み確認で承諾した。元の書き込みの内容も渡す(自分の書き込みを見分けるため) */
  onConfirm: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  onOpenUrl: (url: string) => void
  /** 画像のアップロード(catbox.moe)を使うとき。使わないなら undefined */
  uploader?: UploadOptions
  /** 書き込んだあとのクールダウンが明ける時刻と、その長さ。明けるまで書き込むボタンを押せなくし、残りを出す */
  /** 書き込み欄をしまう(しまうボタンを出す) */
  onCollapse?: () => void
  /** 下のサムネイルを押した(画像ビューアーで開く) */
  onImage?: (urls: string[], index: number) => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /**
   * 書きかけの本文を覚えておく所(スレごと)。開いたときに読み、書くのが止まったら保存し、書き込めたら消す。
   * タブを閉じても・アプリを閉じても、書きかけが残るように
   */
  /** key があれば、書きかけを打つたびにその場でも覚える(utils/draftStash。ページを離れても消えないように) */
  draft?: { load: () => Promise<string | undefined>; save: (body: string) => void; key?: string }
  /** 板の書き込みの上限と、その掲示板での数え方。本文の欄の右下に長さを出し、超えていたら書き込まない */
  limits?: PostLimits
  byteLength?: (text: string) => number
  /** この板で使えるアカウント(BE など)と、使うかどうか。sage の右の ︙ で選ぶ */
  accounts?: PostAccountOption[]
  onToggleAccount?: (id: string, on: boolean) => void
  onOpenAccountSettings?: () => void
  /** 書いている間、本文の欄の上に並べる定型文(設定の定型文。あれば出す)。押すとカーソルの所に入る */
  phraseBar?: string[]
}

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1 focus:ring-c-accent focus:border-c-accent'

const ReplyForm = forwardRef<ReplyFormHandle, Props>(function ReplyForm(props, ref) {
  const [name, setName] = useState(props.initialName)
  const [mail, setMail] = useState(props.initialMail)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<PostResult>()
  // スマホ: 「書き込みました」は少しで消す(出ている間はフッターを隠さないので、出しっぱなしにしない)
  useEffect(() => {
    if (props.variant !== 'chat' || result?.status !== 'ok') return
    const timer = setTimeout(() => setResult(undefined), 4000)
    return () => clearTimeout(timer)
  }, [result, props.variant])
  /** chat: オプション(名前・メール)の欄を出しているか */
  const [lineOptions, setLineOptions] = useState(false)
  /** chat: 本文の欄に入っているか(定型文のバーを出す) */
  const [chatFocused, setChatFocused] = useState(false)
  /** chat: ＋ のメニュー(画像・オプション)を出しているか */
  const [plusMenu, setPlusMenu] = useState(false)
  /** 画像のアップロードが無効のときに「画像」を押したら、設定のことを知らせる */
  const [imageHint, setImageHint] = useState(false)
  /** 本文の欄を AA 用の字で出すか(ボタンで選んだもの。選んでいなければ本文から見分ける。空白が続く本文は AA とみなす) */
  const [aaOverride, setAaOverride] = useState<boolean>()
  const isAA = aaOverride ?? looksLikeAA(body)
  /** AA のときは、レスの表示と同じ字で、折り返さずに出す(折り返すと崩れて見えるため) */
  const aaClass = isAA ? 'aa-font whitespace-pre overflow-x-auto' : ''
  const textRef = useRef<HTMLTextAreaElement>(null)

  // ── 下書き ──
  const draftRef = useRef(props.draft)
  draftRef.current = props.draft
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingDraft = useRef<string | undefined>(undefined)
  /** 書くのが止まって少ししたら保存する(1 文字ごとに DB へ書かないように) */
  const saveDraftLater = (next: string) => {
    const key = draftRef.current?.key
    if (key) stashSet(key, next)
    pendingDraft.current = next
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      pendingDraft.current = undefined
      draftRef.current?.save(next)
    }, 400)
  }
  // 開いたら、覚えておいた書きかけを戻す(もう何か書いていたら、そちらを優先する)
  useEffect(() => {
    let alive = true
    // すぐ書ける置き場に覚えていれば、そちらを使う(空なら、書き込めて消したもの。DB の古い書きかけは読み戻さない)
    const stashed = props.draft?.key ? stashGet(props.draft.key) : undefined
    if (stashed !== undefined) {
      if (stashed) setBody((b) => (b === '' ? stashed : b))
    } else
      void props.draft?.load().then((saved) => {
        if (alive && saved) setBody((b) => (b === '' ? saved : b))
      })
    return () => {
      alive = false
      // 保存し損ねた書きかけは、閉じるときに保存する
      clearTimeout(draftTimer.current)
      if (pendingDraft.current !== undefined) draftRef.current?.save(pendingDraft.current)
    }
  }, [])
  // 本文が欄に収まるか測って知らせる(足りなければ、書き込み欄を伸ばしてもらう。書き込んで空になれば元に戻る)
  const onTextOverflow = props.onTextOverflow
  useLayoutEffect(() => {
    const ta = textRef.current
    if (!ta || !onTextOverflow) return
    onTextOverflow(textHeight(ta, body) - ta.clientHeight)
  }, [body, onTextOverflow])
  // スマホの入力欄(chat): 本文に合わせて伸びる(6 行くらいまで)。手で書いたときだけでなく、
  // 画像の URL・>>番号・下書きなど、外から本文が変わったときも測り直す
  useLayoutEffect(() => {
    const ta = textRef.current
    if (props.variant !== 'chat' || !ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [body, props.variant])

  /** 書き込めたら、本文も下書きも消す */
  const clearBody = () => {
    setBody('')
    setAaOverride(undefined)
    // スマホ: 書き込めたらキーボードをしまう(書いたレスと返事が見えるように)。伸ばした入力欄の高さも戻す
    if (props.variant === 'chat' && textRef.current) {
      textRef.current.blur()
      textRef.current.style.height = ''
    }
    clearTimeout(draftTimer.current)
    pendingDraft.current = undefined
    draftRef.current?.save('')
    if (draftRef.current?.key) stashSet(draftRef.current.key, '')
  }
  /** 本文を変える(下書きにも残す) */
  const changeBody = (next: string) => {
    setBody(next)
    saveDraftLater(next)
  }

  /**
   * いまの本文。画像を何枚も続けて上げると、上げ終わるたびに insert が呼ばれる。そのとき古い描画の body を使うと、
   * 前に入れた URL が消えて最後の 1 枚だけになるので、いつも最新の本文に足す
   */
  const bodyRef = useRef(body)
  bodyRef.current = body
  /** 本文のカーソルの位置に文字を入れる */
  const insert = (text0: string, opts?: { ownLine?: boolean }) => {
    const el = textRef.current
    const cur = bodyRef.current
    const at = el ? el.selectionStart : cur.length
    // 画像の URL は行の頭から(本文のすぐ後ろにくっつかないように)
    const text = opts?.ownLine && at > 0 && cur[at - 1] !== '\n' ? `\n${text0}` : text0
    if (!el) {
      bodyRef.current = cur + text
      return changeBody(cur + text)
    }
    const start = el.selectionStart
    const next = cur.slice(0, start) + text + cur.slice(el.selectionEnd)
    bodyRef.current = next
    changeBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + text.length
    })
  }
  useImperativeHandle(ref, () => ({ insert, focus: () => textRef.current?.focus() }))

  // 画像のアップロード(ボタン・貼り付け・ドラッグ)と絵文字
  const media = useMediaInput({ uploader: props.uploader, attach: props.attach, insert, onUploaded: props.onUploaded, disabled: !!props.disabled })

  const sage = mail.trim().toLowerCase() === 'sage'

  /** 書き込み確認で承諾したときも、ふつうの書き込みと同じく結果を出し、成功したら本文を空にする */
  const confirm = async (c: PostConfirm) => {
    setSending(true)
    setResult(undefined)
    try {
      const r = await props.onConfirm(c, { name, mail, body })
      setResult(r)
      if (r.status === 'ok') clearBody()
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  // 書き込みの長さ。板の上限を超えていたら、送る前に止める
  const measure = props.byteLength ? measurePost({ body, name, mail }, props.limits, props.byteLength) : undefined
  const submit = async () => {
    // ファイルを付けていれば、本文が空でも書き込める(画像だけのレス)
    if ((!body.trim() && !media.attachedView) || sending || props.disabled) return
    if (measure && measure.over.length > 0) return setResult({ status: 'error', message: measure.over.join(' / ') })
    setSending(true)
    setResult(undefined)
    try {
      const files = await media.takeFiles()
      const r = await props.onSubmit({ name, mail, body, ...(files.length > 0 && { files }) })
      setResult(r)
      if (r.status === 'ok') {
        clearBody()
        media.clearAttached()
      }
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  /** 送るボタン・Ctrl+Enter(送る前に待つ設定は 2026-11 にやめた) */
  const requestSend = () => void submit()
  /** 定型文のバー。押すとカーソルの所に入れる(選んでいた字は置き換える) */
  const insertPhrase = (ph: string) => {
    const el = textRef.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    changeBody(body.slice(0, start) + ph + body.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + ph.length, start + ph.length)
    })
  }
  const phraseBar = !!props.phraseBar?.length && (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
      {props.phraseBar.map((ph) => (
        <button
          key={ph}
          type="button"
          // 押しても本文の欄からカーソルが外れないように(外れるとスマホのキーボードが閉じる)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertPhrase(ph)}
          className="flex-shrink-0 px-3 py-1 rounded-full bg-c-surface2 border border-c-border text-[13px] text-c-text-strong whitespace-nowrap"
        >
          {ph}
        </button>
      ))}
    </div>
  )

  const right = props.layout === 'right'
  // 本文に入れた画像・動画のリンクは、下にサムネイルを出す(web 版と同じ)
  const previewImages = imageUrlsIn(body)
  // 家の中のアドレスの画像は、書いただけでは読みに行かない
  const loadableImages = previewImages.filter(isAutoLoadable)
  const previewVideos = youtubeIdsIn(body)
  // 上げる前・上げている途中・上げられなかった画像(上げ終わったものは本文の URL の方で出す)
  const pendingItems = media.items.filter((it) => it.state !== 'done')
  const hasPreview = previewImages.length + previewVideos.length + pendingItems.length > 0
  /** 本文から画像の URL を外す(サムネイルの ×)。その URL だけの行は行ごと消す */
  const removeUrl = (url: string) => {
    const lines = body.split('\n')
    changeBody(lines.some((l) => l.trim() === url) ? lines.filter((l) => l.trim() !== url).join('\n') : body.replace(url, ''))
  }
  /**
   * 本文に入れた画像・動画のリンクのサムネイル(PC は欄の下、スマホの入力欄は欄の上)。スマホのアプリの UploadStrip と同じ:
   * 本文の画像は押すと画像ビューアー、× で本文から外す。上げ終わった画像は端末の画像をそのまま出す(すぐ見える)。
   * 待っている・上げている・上げられなかった画像は、暗くして印を重ねる。上げられなかった画像は押すと上げ直す
   */
  const previewStrip = (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {loadableImages.map((url, i) => (
        <div key={url} className="relative h-14 w-14 flex-shrink-0">
          <img
            src={media.localOf(url) ?? url}
            alt=""
            referrerPolicy="no-referrer"
            onClick={() => props.onImage?.(loadableImages, i)}
            className="h-full w-full object-cover rounded border border-c-border bg-c-surface2 cursor-pointer hover:border-c-border-strong"
            title="押すと大きく見る"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => removeUrl(url)}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
            title="本文から外す"
          >
            <span className="material-symbols-outlined text-[13px] leading-none">close</span>
          </button>
        </div>
      ))}
      {pendingItems.map((it) => (
        <div
          key={it.id}
          role={it.state === 'failed' ? 'button' : undefined}
          onClick={it.state === 'failed' ? () => media.retry(it.id) : undefined}
          className={`relative h-14 w-14 flex-shrink-0 rounded overflow-hidden border border-c-border bg-c-surface2 ${it.state === 'failed' ? 'cursor-pointer' : ''}`}
          title={it.error ?? (it.state === 'uploading' ? '上げています' : '待っています')}
        >
          {it.file.type.startsWith('video/') ? <video src={it.preview} muted className="w-full h-full object-cover" /> : <img src={it.preview} alt="" className="w-full h-full object-cover" />}
          <span className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-0.5 text-white">
            {it.state === 'uploading' ? (
              <>
                <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                <span className="text-[9px] leading-none">上げ中</span>
              </>
            ) : it.state === 'failed' ? (
              <>
                <span className="material-symbols-outlined text-lg" style={{ color: 'var(--c-mark-danger)' }}>refresh</span>
                <span className="text-[9px] leading-none">再送</span>
              </>
            ) : (
              <span className="text-[10px] leading-none text-white/85">待ち</span>
            )}
          </span>
          {it.state === 'failed' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                media.dismiss(it.id)
              }}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
              title="外す"
            >
              <span className="material-symbols-outlined text-[13px] leading-none">close</span>
            </button>
          )}
        </div>
      ))}
      {previewVideos.map((id) => (
        <div key={id} className="relative h-14 w-20 flex-shrink-0 rounded overflow-hidden border-2" style={{ borderColor: '#ff0000' }}>
          <img src={`https://img.youtube.com/vi/${id}/default.jpg`} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[8px] px-0.5 rounded leading-none">▶</span>
        </div>
      ))}
    </div>
  )
  const sendButton = (
    <button
      type="button"
      onClick={requestSend}
      disabled={sending || !body.trim() || !!props.disabled}
      title="Ctrl+Enter でも書き込めます"
      className={`btn-thread-create relative overflow-hidden px-4 py-2 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 ${right ? 'w-full' : 'self-end'}`}
    >
      <span className={`relative material-symbols-outlined text-base ${sending ? 'animate-spin' : ''}`}>
        {sending ? 'progress_activity' : 'send'}
      </span>
      <span className="relative tabular-nums">書き込む</span>
    </button>
  )

  /** 画像と絵文字のボタン(右端が絵文字)。本文の欄の上(名前とメールの行の右端＝本文の欄の右端)に置く */

  /** 入力欄で Esc を押したら、書き込み欄をしまう(書きかけは下書きに残る)。日本語の変換中の Esc は変換の取り消しなので見ない */
  const collapseOnEsc = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing || !props.onCollapse) return
    e.preventDefault()
    props.onCollapse()
  }

  if (props.variant === 'chat') {
    const canSend = !sending && !!body.trim() && !props.disabled
    return (
      <div data-composer className="w-full flex flex-col">
        {media.fileInput}
        {imageHint && (
          <p className="px-3 pt-2 flex items-start gap-1 text-xs text-c-text-muted">
            <span className="material-symbols-outlined text-sm">info</span>
            <span className="flex-1">画像を付けるには、設定の「画像のアップロードを使う」をオンにしてください(catbox に上げて URL を本文に入れます)</span>
            <button type="button" onClick={() => setImageHint(false)} className="material-symbols-outlined text-sm" title="閉じる">
              close
            </button>
          </p>
        )}
        {/* 画像を上げている間は、何枚中の何枚目かを出す */}
        {media.uploading > 0 && (
          <p className="px-3 pt-2 flex items-center gap-1.5 text-xs text-c-text-muted">
            <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
            画像をアップロード中…{media.progress && media.progress.total > 1 && ` ${media.progress.current} / ${media.progress.total} 枚目`}
          </p>
        )}
        {media.error && (
          <p className="px-3 pt-2 flex items-start gap-1 text-xs text-c-heat-very-hot">
            <span className="material-symbols-outlined text-sm">error</span>
            <span className="flex-1">{media.error}</span>
          </p>
        )}
        {media.notice && (
          <p className="px-3 pt-2 flex items-start gap-1 text-xs" style={{ color: 'var(--c-mark-new)' }}>
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span className="flex-1">{media.notice}</span>
          </p>
        )}
        {/* 返事は、後ろのレスが透けて読めなくならないよう、塗りつぶした面に出す。出ている間はフッターを隠さない(data-post-result) */}
        {result && (
          <div data-post-result className="relative mx-2 mt-2 px-3 pt-2 pr-8 max-h-40 overflow-y-auto rounded-xl bg-c-surface border border-c-border shadow-lg">
            <PostResultBox result={result} onOpenUrl={props.onOpenUrl} onConfirm={(c) => void confirm(c)} />
            <button type="button" onClick={() => setResult(undefined)} className="absolute top-1.5 right-1.5 p-1 text-c-text-muted" title="閉じる">
              <span className="material-symbols-outlined text-base leading-none">close</span>
            </button>
          </div>
        )}
        {media.attachedView && <div className="px-3 pt-2">{media.attachedView}</div>}
        {hasPreview && <div className="px-3 pt-2">{previewStrip}</div>}
        {/* 定型文のバーは書いている間だけ(本文の欄に入っているか、書きかけがあるとき。アプリと同じ) */}
        {phraseBar && (chatFocused || body) && <div className="px-2.5 pt-1.5">{phraseBar}</div>}
        {/* オプション: 名前・メール・アカウント */}
        {lineOptions && (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" className={`${INPUT} flex-1 min-w-[6rem]`} />
            <input type="text" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="メール(sage など)" className={`${INPUT} flex-1 min-w-[6rem]`} />
            {props.accounts && props.onToggleAccount && (
              <PostAccountMenu options={props.accounts} onToggle={props.onToggleAccount} onOpenSettings={() => props.onOpenAccountSettings?.()} />
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5 px-2 py-2">
          {props.leading}
          {/* 丸い本文の欄。左の端に ＋(画像・オプション) */}
          <div className="relative flex-1 min-w-0 flex items-end rounded-[20px] border border-c-border bg-c-surface focus-within:border-c-accent">
            <button
              type="button"
              onClick={() => setPlusMenu((v) => !v)}
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full ${plusMenu || lineOptions || mail || name ? 'text-c-accent' : 'text-c-text-muted'}`}
              title="画像・オプション"
            >
              <span className={`material-symbols-outlined text-[24px] leading-none transition-transform ${plusMenu ? 'rotate-45' : ''}`}>
                {media.uploading > 0 ? 'progress_activity' : 'add'}
              </span>
            </button>
            {plusMenu && (
              <div className="absolute left-0 bottom-full mb-2 z-10 min-w-[11rem] py-1 bg-c-surface border border-c-border rounded-xl shadow-lg rise-in">
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenu(false)
                    if (media.pick) media.pick()
                    else setImageHint(true)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[15px] text-c-text-body active:bg-c-surface2"
                >
                  <span className={`material-symbols-outlined text-xl text-c-text-muted ${media.uploading > 0 ? 'animate-spin' : ''}`}>
                    {media.uploading > 0 ? 'progress_activity' : 'image'}
                  </span>
                  {media.uploading > 0 && media.progress ? `画像(${media.progress.current} / ${media.progress.total} 枚目をアップロード中)` : '画像'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenu(false)
                    setLineOptions((v) => !v)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[15px] text-c-text-body active:bg-c-surface2"
                >
                  <span className="material-symbols-outlined text-xl text-c-text-muted">tune</span>
                  {lineOptions ? 'オプションを閉じる' : 'オプション(名前・メール)'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenu(false)
                    setAaOverride(!isAA)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[15px] text-c-text-body active:bg-c-surface2"
                >
                  <span className="material-symbols-outlined text-xl text-c-text-muted">{isAA ? 'notes' : 'grid_on'}</span>
                  {isAA ? '文字列として表示' : 'AAとして表示'}
                </button>
              </div>
            )}
            <textarea
              ref={textRef}
              rows={1}
              value={body}
              onChange={(e) => {
                changeBody(e.target.value)
              }}
              onFocus={() => {
                setPlusMenu(false)
                setChatFocused(true)
                props.onFocusChange?.(true)
              }}
              onBlur={() => {
                setChatFocused(false)
                props.onFocusChange?.(false)
              }}
              {...media.textareaProps}
              placeholder={props.disabled ?? '書き込む'}
              disabled={!!props.disabled}
              wrap={isAA ? 'off' : undefined}
              className={`flex-1 min-w-0 max-h-40 resize-none border-0 bg-transparent pl-0 pr-3.5 py-2 text-[15px] leading-snug text-c-text-body placeholder-c-text-muted focus:ring-0 ${aaClass}`}
            />
          </div>
          <button
            type="button"
            onClick={requestSend}
            disabled={!canSend}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
            style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)' }}
            title="送る"
          >
            <span className={`material-symbols-outlined text-xl ${sending ? 'animate-spin' : ''}`}>
              {sending ? 'progress_activity' : 'send'}
            </span>
          </button>
          {props.trailing}
        </div>
        {measure && measure.over.length > 0 && <p className="px-4 pb-1 text-[10px] text-c-heat-very-hot font-bold">{measure.over.join(' ・ ')}</p>}
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-panel-reply px-4 py-3 overflow-hidden">
      {media.error && (
        <p className="mb-2 flex items-start gap-1 text-xs text-c-heat-very-hot">
          <span className="material-symbols-outlined text-sm">error</span>
          <span className="flex-1">{media.error}</span>
        </p>
      )}
      {media.notice && (
        <p className="mb-2 flex items-start gap-1 text-xs" style={{ color: 'var(--c-mark-new)' }}>
          <span className="material-symbols-outlined text-sm">check_circle</span>
          <span className="flex-1">{media.notice}</span>
        </p>
      )}
      {result && <PostResultBox result={result} onOpenUrl={props.onOpenUrl} onConfirm={(c) => void confirm(c)} />}
      {/* 書き込みに付けたファイル(ふたば) */}
      {media.attachedView && <div className="mb-2">{media.attachedView}</div>}
      {phraseBar && <div className="mb-2 flex-shrink-0">{phraseBar}</div>}

      {/* 名前・メールの行と本文の欄を一つの列にまとめ、書き込むボタンはその右(右レイアウトでは下)に置く。
          こうすると絵文字・画像のボタンの右端が本文の欄の右端とそろう */}
      <div className={`flex-1 min-h-0 flex gap-2 ${right ? 'flex-col' : ''}`}>
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className={`flex items-center gap-2 mb-2 ${right ? 'flex-wrap' : ''}`}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={collapseOnEsc}
          placeholder="名前"
          className={`${INPUT} ${right ? 'flex-1 min-w-0' : 'w-40'}`}
        />
        <input
          type="text"
          value={mail}
          onChange={(e) => setMail(e.target.value)}
          onKeyDown={collapseOnEsc}
          placeholder="メール"
          className={`${INPUT} ${right ? 'flex-1 min-w-0' : 'w-40'}`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
          <input type="checkbox" checked={sage} onChange={(e) => setMail(e.target.checked ? 'sage' : '')} className="rounded" />
          sage
        </label>
        {props.accounts && props.onToggleAccount && (
          <PostAccountMenu options={props.accounts} onToggle={props.onToggleAccount} onOpenSettings={() => props.onOpenAccountSettings?.()} />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setAaOverride(!isAA)}
            className={`flex-shrink-0 p-1 rounded hover:bg-c-surface2 ${isAA ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-strong'}`}
            title={isAA ? '文字列として表示' : 'AAとして表示'}
            aria-pressed={isAA}
          >
            <span className="material-symbols-outlined text-lg leading-none">grid_on</span>
          </button>
          {media.buttons}
          {props.onCollapse && (
            <button
              type="button"
              onClick={props.onCollapse}
              className="flex-shrink-0 p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2"
              title="書き込み欄をしまう(下書きは残ります)"
            >
              <span className="material-symbols-outlined text-lg leading-none">keyboard_hide</span>
            </button>
          )}
        </div>
      </div>
        <div className="relative flex-1 min-h-0 flex">
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => changeBody(e.target.value)}
          {...media.textareaProps}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              requestSend()
            } else collapseOnEsc(e)
          }}
          placeholder={props.disabled ?? '本文(Ctrl+Enter で書き込む)'}
          disabled={!!props.disabled}
          wrap={isAA ? 'off' : undefined}
          className={`${INPUT} flex-1 min-h-0 resize-none leading-relaxed pb-6 ${aaClass}`}
        />
          {measure && (measure.over.length > 0 || measure.messageBytes > 0) && (
            <span
              className={`absolute right-2 bottom-1.5 px-1 rounded text-[10px] tabular-nums pointer-events-none bg-c-surface2 ${
                measure.over.length > 0 ? 'text-c-heat-very-hot font-bold' : 'text-c-text-muted'
              }`}
              title={measure.over.join('\n') || '書き込みの長さ(目安)'}
            >
              {measure.messageBytes}
              {props.limits?.messageBytes !== undefined && ` / ${props.limits.messageBytes}`} バイト
              {props.limits?.lines !== undefined && ` ・ ${measure.lines} / ${props.limits.lines} 行`}
            </span>
          )}
        </div>
      </div>
        {sendButton}
      </div>
      {hasPreview && <div className="flex-shrink-0 mt-2">{previewStrip}</div>}
    </div>
  )
})

export default ReplyForm

/** 測るための見えない写し(本文の欄と同じ幅・字・余白で、本文が何 px の高さになるかを測る) */
let mirror: HTMLDivElement | undefined
function textHeight(ta: HTMLTextAreaElement, text: string): number {
  if (!mirror) {
    mirror = document.createElement('div')
    Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', boxSizing: 'border-box' })
    document.body.appendChild(mirror)
  }
  const cs = getComputedStyle(ta)
  Object.assign(mirror.style, {
    width: `${ta.clientWidth}px`,
    font: cs.font,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    padding: cs.padding,
    wordBreak: cs.wordBreak,
    // AA のときは折り返さない(欄と同じにする)
    whiteSpace: cs.whiteSpace,
  })
  // 最後の改行のあとの空の行も 1 行に数える
  mirror.textContent = `${text}\u200b`
  return mirror.scrollHeight
}
