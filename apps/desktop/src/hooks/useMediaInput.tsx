// 本文の欄に、画像をアップロードして URL を入れる(ボタン・貼り付け・ドラッグ)ことと、絵文字を入れること。
// 書き込みにファイルを付けられる掲示板(コネクタの attachments。ふたば)では、アップロードの代わりに、書き込みに付ける
// (付けたファイルは小さく並べて × で外せる。書き込むときに takeFiles で中身を渡す)。
// 書き込み欄とスレ立ての画面で共通に使う。
// - アップローダーに負担をかけないよう、まとめて貼られても 1 枚ずつ順番に上げ、一度に 10 枚まで
// - 1 枚ずつ、待ち・上げ中・済み・失敗を持つ(スマホのアプリの UploadItem と同じ)。失敗したものは押すと上げ直す
// - 上げたら URL を画像として開いて確かめる(置き場の不具合で、URL だけ返して中身がないことがあった)
// - 上げ終わったら本文のカーソルの位置に URL を入れ、アップロード履歴に残す

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import type { AttachmentRules, PostFile } from '@bbs-browser/connectors'
import EmojiPicker from '../components/EmojiPicker'
import { DEFAULT_UPLOAD_HOST, PRIMARY_HOST, UPLOAD_HOSTS, uploadHostProblem, uploadMedia, type UploadOptions } from '../host/uploader'
import { closeWebUpload, openWebUpload, showWebUpload } from '../host/webUpload'
import { WEB_UPLOAD_SITES, type WebUploadSite } from '../utils/webUpload'

/** 一度に上げられる数 */
const MAX_FILES = 10

/** 書き込み欄で選んだ画像 1 枚 */
export interface UploadItem {
  id: number
  file: File
  /** 端末の画像の見本(object URL)。上げ終わったあとも、本文のサムネイルをすぐ出すのに使う */
  preview: string
  state: 'waiting' | 'uploading' | 'done' | 'failed'
  url?: string
  error?: string
}

/**
 * 上げた URL が本当に画像を返すか、画像として読み込んで確かめる(CORS に関係なく読める)。
 * 動画は確かめない。決まった時間で返事がなければ、上げられたとみなす(遅い回線で失敗にしない)
 */
function verifyImage(url: string, host: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const timer = setTimeout(() => {
      img.src = ''
      resolve()
    }, 15000)
    img.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`上げた URL を開いても画像が返りませんでした(${host} の置き場の不具合)`))
    }
    img.src = url
  })
}

/** サイトの画面を閉じるまで: 渡した画像のぶんのリンクがそろってから / 最後のリンクから */
const WEB_CLOSE_SOON_MS = 1200
const WEB_CLOSE_IDLE_MS = 4000
/** 裏で上げていて、これだけ経ってもリンクが来なければ画面を見せる(本人の手が要る: ログイン・確認など) */
const WEB_SHOW_AFTER_MS = 20000

let nextItemId = 1

/** 貼り付け・ドラッグされたもののうち、画像と動画のファイルだけ */
function mediaFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type))
}

export function useMediaInput(o: {
  /** 画像のアップロードを使うとき。使わないなら undefined(絵文字だけ出す) */
  uploader?: UploadOptions
  /** 本文のカーソルの位置に文字を入れる(ownLine: 行の途中なら改行してから入れる。画像の URL) */
  insert: (text: string, opts?: { ownLine?: boolean }) => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded?: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /** 書き込みにファイルを付けられる掲示板の決まり。あれば、アップロードの代わりに書き込みに付ける */
  attach?: AttachmentRules
  disabled?: boolean
}): {
  /** 書き込みに付けたファイルの並び(小さい見本と ×)。付けていなければ null */
  attachedView: ReactNode
  /** 付けたファイルの中身(書き込むときに PostInput.files に渡す) */
  takeFiles: () => Promise<PostFile[]>
  /** 付けたファイルを外す(書き込めたあと) */
  clearAttached: () => void
  /** 画像と絵文字のボタン(右端が絵文字) */
  buttons: ReactNode
  /**
   * スマホの入力欄(chat)用: 画像を選ぶ画面を開く。付けられない・上げられない掲示板なら undefined。
   * 使うときは fileInput(隠したファイルの選び口)も一緒に置く(buttons とは一緒に置かない)
   */
  pick?: () => void
  fileInput: ReactNode
  /** アップロードしている数(待っているものも含む) */
  uploading: number
  /** まとめて上げているとき、いま何枚目か(1 始まり)と全部で何枚か */
  progress?: { current: number; total: number }
  /** 選んだ画像の上げ具合(選んだ順)。上げ終わったものも、本文のサムネイルを端末の画像で出すために残す */
  items: UploadItem[]
  /** 上げ終わった URL → 端末の画像の見本 */
  localOf: (url: string) => string | undefined
  /** 失敗した画像を上げ直す */
  retry: (id: number) => void
  /** 失敗した画像を外す */
  dismiss: (id: number) => void
  /** 上げられたときの知らせ(代わりの置き場に上げたときなど)。少しで消える */
  notice?: string
  /** 本文の欄に付ける。画像を貼り付け・ドロップしたら上げる */
  textareaProps: {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => void
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => void
  }
  /** 上げられなかったときの理由 */
  error?: string
} {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(undefined), 5000)
    return () => clearTimeout(t)
  }, [notice])
  // 上げ具合。並びの本当の中身は ref に持ち、変えるたびに描き直す(順番に上げる処理が、いつも最新の並びを見られるように)
  const itemsRef = useRef<UploadItem[]>([])
  const [items, setItems] = useState<UploadItem[]>([])
  const setAll = (next: UploadItem[]) => {
    itemsRef.current = next
    setItems(next)
  }
  const patch = (id: number, p: Partial<UploadItem>) => setAll(itemsRef.current.map((i) => (i.id === id ? { ...i, ...p } : i)))
  // 消えるときに見本の object URL を返す
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), [])
  const running = useRef(false)
  const oRef = useRef(o)
  oRef.current = o

  // ── 書き込みに付けるファイル(attach のとき) ──
  const [attached, setAttached] = useState<File[]>([])
  const previews = useMemo(() => attached.map((f) => URL.createObjectURL(f)), [attached])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const attach = (files: File[]) => {
    const rules = o.attach
    if (!rules || files.length === 0) return
    const ok: File[] = []
    for (const f of files) {
      if (!rules.types.includes(f.type)) {
        setError(`付けられない種類のファイルです(${f.name || f.type})。付けられるのは ${rules.types.map((t) => t.split('/')[1]).join('・')}`)
        continue
      }
      if (f.size > rules.maxBytes) {
        setError(`ファイルが大きすぎます(${Math.ceil(f.size / 1024)}KB。${Math.floor(rules.maxBytes / 1024)}KB まで)`)
        continue
      }
      ok.push(f)
    }
    if (ok.length === 0) return
    setError(undefined)
    // 上限を超えたら、新しく付けたものを残す(1 つまでの掲示板では、付け直しになる)
    setAttached((cur) => [...cur, ...ok].slice(-rules.maxFiles))
  }
  const takeFiles = async (): Promise<PostFile[]> =>
    Promise.all(attached.map(async (f) => ({ name: f.name || 'image', type: f.type, data: new Uint8Array(await f.arrayBuffer()) })))
  const attachedView =
    attached.length === 0 ? null : (
      <div className="flex flex-wrap gap-2">
        {attached.map((f, i) => (
          <div key={previews[i]} className="relative w-16 h-16 rounded overflow-hidden border border-c-border bg-c-surface2 flex-shrink-0" title={`${f.name}(${Math.ceil(f.size / 1024)}KB)`}>
            {f.type.startsWith('video/') ? (
              <video src={previews[i]} muted className="w-full h-full object-cover" />
            ) : (
              <img src={previews[i]} alt="" className="w-full h-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => setAttached((cur) => cur.filter((_, j) => j !== i))}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
              title="外す"
            >
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          </div>
        ))}
      </div>
    )

  /** 待っている画像を 1 枚ずつ順番に上げる(上げている途中に選び足したら、列の後ろに並べて続けて上げる) */
  const pump = async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const uploader = oRef.current.uploader
        const next = itemsRef.current.find((i) => i.state === 'waiting')
        if (!uploader || !next) break
        patch(next.id, { state: 'uploading', error: undefined })
        try {
          const r = await uploadMedia(next.file, uploader)
          await verifyImage(r.url, r.host, next.file)
          patch(next.id, { state: 'done', url: r.url })
          oRef.current.insert(`${r.url}\n`, { ownLine: true })
          oRef.current.onUploaded?.({ url: r.url, name: next.file.name || 'image', size: next.file.size, withAccount: !!uploader.userhash && r.host === PRIMARY_HOST })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          patch(next.id, { state: 'failed', error: msg })
          setError(`画像を上げられませんでした: ${msg}。画像を押すと上げ直します`)
        }
      }
    } finally {
      running.current = false
    }
  }
  const upload = (all: File[]) => {
    if (!o.uploader || all.length === 0) return
    setError(all.length > MAX_FILES ? `一度に上げられるのは ${MAX_FILES} 枚までです(先頭の ${MAX_FILES} 枚だけ上げます)` : undefined)
    // 前に失敗したものは、新しく選んだら片づける(押して上げ直す代わりに選び直した)
    for (const i of itemsRef.current) if (i.state === 'failed') URL.revokeObjectURL(i.preview)
    const kept = itemsRef.current.filter((i) => i.state !== 'failed')
    const added = all.slice(0, MAX_FILES).map((file): UploadItem => ({ id: nextItemId++, file, preview: URL.createObjectURL(file), state: 'waiting' }))
    setAll([...kept, ...added])
    void pump()
  }
  const retry = (id: number) => {
    patch(id, { state: 'waiting', error: undefined })
    setError(undefined)
    void pump()
  }
  const dismiss = (id: number) => {
    const it = itemsRef.current.find((i) => i.id === id)
    if (it) URL.revokeObjectURL(it.preview)
    setAll(itemsRef.current.filter((i) => i.id !== id))
  }
  /** サイトの画面で裏で上げている間の進み具合(渡した画像の数と、リンクが来た数) */
  const [webProgress, setWebProgress] = useState<{ got: number; total: number }>()
  const uploading = items.filter((i) => i.state === 'waiting' || i.state === 'uploading').length + (webProgress ? 1 : 0)
  // 何枚目か: 今回の並び(失敗したものを除く)のうち、済んだ数 + 1
  const batch = items.filter((i) => i.state !== 'failed')
  const progress =
    batch.length > 0 && uploading > 0
      ? { current: Math.min(batch.length, batch.filter((i) => i.state === 'done').length + 1), total: batch.length }
      : webProgress
        ? { current: Math.min(webProgress.total, webProgress.got + 1), total: webProgress.total }
        : undefined
  const localOf = (url: string) => items.find((i) => i.url === url)?.preview

  // 上げ先(設定)。サイトの画面で上げるもの(imgur・imgbox・imgbb の画面)なら、画像ボタンでその画面を開く
  const hostDef = UPLOAD_HOSTS.find((h) => h.key === (o.uploader?.host ?? DEFAULT_UPLOAD_HOST))
  const webSiteDef = hostDef?.kind === 'web' ? WEB_UPLOAD_SITES.find((x) => x.key === hostDef.site) : undefined
  /** ボタン・貼り付け・ドラッグで選んだファイル: 付けられる掲示板なら付け、そうでなければアップロードする */
  const take = (files: File[]) => {
    if (o.attach) return attach(files)
    if (webSiteDef) {
      // サイトの画面で上げる上げ先: 画面を開き、貼り付け・ドラッグした画像はそのページに貼り付けたことにして、そのまま上げてもらう
      setNotice(`${webSiteDef.name}の画面で上げます`)
      return void startWebUpload(webSiteDef, files)
    }
    upload(files)
  }
  // 置き場のサイトの画面で上げる(host/webUpload.ts)。開いている間、拾ったリンクを本文に入れる。
  // 上げ終わったら(渡した画像の数だけリンクが来た、または最後のリンクから少し経った)画面を閉じる
  const [webSite, setWebSite] = useState<WebUploadSite>()
  const stopWeb = useRef<() => void>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      stopWeb.current?.()
      clearTimeout(closeTimer.current)
    },
    [],
  )
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const finishWebUpload = () => {
    clearTimeout(closeTimer.current)
    clearTimeout(showTimer.current)
    stopWeb.current?.()
    stopWeb.current = undefined
    setWebSite(undefined)
    setWebProgress(undefined)
    void closeWebUpload()
  }
  /**
   * サイトの画面で上げる。画像を渡すとき(貼り付け・ドラッグ)は画面を見せず裏で上げ、リンクが来たら本文に入れる
   * (進み具合は書き込み欄の上に出す)。しばらく経ってもリンクが来なければ画面を見せる(ログイン・確認など、本人の手が要る)。
   * 画像ボタンから開くとき(画像なし)は、本人がその画面で選ぶので見せる
   */
  const startWebUpload = async (site: WebUploadSite, files: File[] = []) => {
    stopWeb.current?.()
    clearTimeout(closeTimer.current)
    clearTimeout(showTimer.current)
    let got = 0
    const background = files.length > 0
    try {
      stopWeb.current = await openWebUpload(
        site,
        (url) => {
          // URL は 1 行に 1 つ(改行で区切る)
          insertRef.current(`${url}\n`, { ownLine: true })
          got++
          const file = files[got - 1]
          // どの上げ方でも、上げた画像の履歴に残す(大きさは渡した画像のもの。画面で選んだものは 0)
          oRef.current.onUploaded?.({ url, name: file?.name || 'image', size: file?.size ?? 0, withAccount: false })
          setNotice(background ? `${site.name}に上げました(${got}/${files.length})` : `${site.name}のリンクを本文に入れました(${got} 件)`)
          if (background) setWebProgress({ got, total: files.length })
          clearTimeout(showTimer.current)
          clearTimeout(closeTimer.current)
          closeTimer.current = setTimeout(finishWebUpload, files.length > 0 && got >= files.length ? WEB_CLOSE_SOON_MS : WEB_CLOSE_IDLE_MS)
        },
        files,
        { background },
      )
      setWebSite(site)
      if (background) {
        setWebProgress({ got: 0, total: files.length })
        setNotice(`${site.name}に上げています(${files.length} 枚)…`)
        showTimer.current = setTimeout(() => {
          setNotice(`${site.name}の画面で続けてください(裏では上がりませんでした)`)
          void showWebUpload()
        }, WEB_SHOW_AFTER_MS)
      }
    } catch (e) {
      setWebProgress(undefined)
      setNotice(`${site.name}の画面を開けませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const insertRef = useRef(o.insert)
  insertRef.current = (t: string, opts?: { ownLine?: boolean }) => o.insert(t, opts)

  const buttons = (
    <>
      {o.attach && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={o.disabled}
            className="flex-shrink-0 p-1 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 disabled:opacity-40"
            title={`画像・動画を書き込みに付ける(${o.attach.maxFiles} つまで、${Math.floor(o.attach.maxBytes / 1024)}KB まで)。本文の欄に貼り付け・ドラッグしても付けられます`}
          >
            <span className="material-symbols-outlined text-lg leading-none">attach_file</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={o.attach.types.join(',')}
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </>
      )}
      {!o.attach && o.uploader && (
        <>
          <button
            type="button"
            onClick={() => {
              if (webSiteDef) return void startWebUpload(webSiteDef)
              const problem = uploadHostProblem(o.uploader!.host ?? DEFAULT_UPLOAD_HOST, o.uploader!)
              if (problem) return setError(problem)
              fileRef.current?.click()
            }}
            disabled={o.disabled}
            className={`flex-shrink-0 p-1 rounded hover:text-c-text-strong hover:bg-c-surface2 disabled:opacity-40 ${webSite ? 'text-c-accent' : 'text-c-text-muted'}`}
            title={
              webSiteDef
                ? webSite
                  ? `${webSite.name}の画面を開いています(上げたらリンクを本文に入れます)`
                  : `画像をアップロード(${webSiteDef.name}の画面を開きます。上げたらリンクを本文に入れます)`
                : `画像をアップロード(${hostDef?.name ?? ''})。本文の欄に貼り付け・ドラッグしても上げられます`
            }
          >
            <span className={`material-symbols-outlined text-lg leading-none ${uploading > 0 ? 'animate-spin' : ''}`}>
              {uploading > 0 ? 'progress_activity' : 'add_photo_alternate'}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              upload(mediaFiles(e.target.files))
              e.target.value = ''
            }}
          />
        </>
      )}
      <EmojiPicker onPick={o.insert} disabled={o.disabled} />
    </>
  )

  const textareaProps = {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = o.attach || o.uploader ? mediaFiles(e.clipboardData.files) : []
      if (files.length === 0) return
      e.preventDefault()
      take(files)
    },
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
      if ((o.attach || o.uploader) && [...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault()
    },
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
      const files = o.attach || o.uploader ? mediaFiles(e.dataTransfer.files) : []
      if (files.length === 0) return
      e.preventDefault()
      take(files)
    },
  }

  // スマホの入力欄(chat)用の、隠したファイルの選び口(buttons の中のものと同じ働き)
  const fileInput = o.attach ? (
    <input
      ref={fileRef}
      type="file"
      accept={o.attach.types.join(',')}
      hidden
      onChange={(e) => {
        attach([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  ) : o.uploader ? (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      multiple
      hidden
      onChange={(e) => {
        upload(mediaFiles(e.target.files))
        e.target.value = ''
      }}
    />
  ) : null
  // スマホの入力欄から: サイトの画面で上げる上げ先なら、その画面を開く
  const pick = o.attach || o.uploader ? () => (webSiteDef && !o.attach ? void startWebUpload(webSiteDef) : fileRef.current?.click()) : undefined

  return { buttons, pick, fileInput, uploading, progress, items, localOf, retry, dismiss, notice, textareaProps, error, attachedView, takeFiles, clearAttached: () => setAttached([]) }
}
