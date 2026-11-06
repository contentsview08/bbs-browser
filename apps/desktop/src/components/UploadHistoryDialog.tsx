// 画像のアップロード履歴。
// 削除できるのは catbox のアカウント(userhash)で上げたものだけ。匿名で上げたものはサーバー上で消せないので、削除ボタンを出さない。
// imgbb は API で消せないが、上げたときに消すためのページ(delete_url)が返るので、それをブラウザで開くボタンを出す

import { useMemo, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { DialogHeader } from './DialogParts'
import { createPortal } from 'react-dom'
import type { UploadRecord } from '@bbs-browser/logstore'
import { isMobile } from '../utils/platform'
import { useLongPress } from '../hooks/useLongPress'
import MobilePage from './MobilePage'
import { dayLabel } from '../utils/thread'
import ActionSheet from './ActionSheet'
import Lightbox from './Lightbox'
import { isVideoFileUrl, toImageUrl } from '../utils/postBody'

const TOOL = 'p-1.5 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

interface Props {
  uploads: UploadRecord[]
  /** アカウント(userhash)を登録しているか。していなければ、どれも消せない */
  canDelete: boolean
  /** サーバー上のファイルを消して、履歴からも外す */
  onDelete: (url: string) => Promise<void>
  /** その画像を貼ったレス(書き込み履歴から探したもの)。分かればスレタイと番号を出し、押すとそのレスへ */
  postedIn?: (url: string) => { title: string; no?: number; open: () => void } | undefined
  onOpen: (url: string) => void
  /** ビューアーからの保存先 */
  saveDir?: string
  onClose: () => void
}

export default function UploadHistoryDialog(props: Props) {
  // スマホは全画面に、上げた日ごとにサムネイルを 3 列で並べる(たたくと開き、長押しで操作)
  if (isMobile) return <MobileUploadHistory {...props} />
  return <DesktopUploadHistory {...props} />
}

/** アップロード履歴の絵の並び(PC)。履歴の画面に埋め込む */
export function UploadGrid(props: Omit<Props, 'onClose'>) {
  const [copied, setCopied] = useState<string>()
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState<string>()
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())
  const [viewing, setViewing] = useState<number>()
  const viewable = (url: string) => !!toImageUrl(url) && !isVideoFileUrl(url) && !broken.has(url)
  const viewerUrls = props.uploads.map((u) => u.url).filter(viewable)
  // 置き場からも消せるもの(アカウントで上げた)と、消せないもの(匿名で上げた)を分けて並べる
  const deletable = props.uploads.filter((u) => u.withAccount)
  const fixed = props.uploads.filter((u) => !u.withAccount)
  // 書き込み履歴を全文で探すので、コピーの印などこの画面の中の変化では探し直さない
  const postedOf = useMemo(() => new Map(props.uploads.map((u) => [u.url, props.postedIn?.(u.url)])), [props.uploads, props.postedIn])
  const card = (u: UploadRecord) => {
    const posted = postedOf.get(u.url)
    return (
      <div key={u.url} className="group flex flex-col bg-c-surface2 border border-c-border rounded-[var(--card-radius)] overflow-hidden">
        <button
          type="button"
          onClick={() => (viewable(u.url) ? setViewing(viewerUrls.indexOf(u.url)) : props.onOpen(u.url))}
          className="h-28 bg-c-surface3"
          title={viewable(u.url) ? 'ビューアーで開く' : 'ブラウザで開く'}
        >
          <img
            src={u.url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={() => setBroken((s) => new Set(s).add(u.url))}
          />
        </button>
        <div className="px-2 pt-1.5">
          <p className="text-xs text-c-text-body truncate" title={u.name}>
            {u.name}
          </p>
          <p className="text-[10px] text-c-text-muted">
            {new Date(u.uploadedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} ・ {formatSize(u.size)}
          </p>
          {posted ? (
            <button type="button" onClick={posted.open} className="mt-1 w-full text-left text-[11px] text-c-accent truncate hover:underline" title="貼ったレスへ">
              <span className="material-symbols-outlined text-[13px] align-[-2px] mr-0.5">reply</span>
              {posted.title || '(スレタイ不明)'}
              {posted.no !== undefined && <span className="ml-1 font-bold">&gt;&gt;{posted.no}</span>}
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-c-text-muted">貼ったレスは見つかりません</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-0.5 px-1 pb-1">
          <button
            type="button"
            className={TOOL}
            title="URL をコピー"
            onClick={() => {
              void navigator.clipboard.writeText(u.url)
              setCopied(u.url)
            }}
          >
            <span className="material-symbols-outlined text-base leading-none">{copied === u.url ? 'check' : 'content_copy'}</span>
          </button>
          <button type="button" className={TOOL} title="ブラウザで開く" onClick={() => props.onOpen(u.url)}>
            <span className="material-symbols-outlined text-base leading-none">open_in_new</span>
          </button>
          {u.deleteUrl && (
            <button type="button" className={`${TOOL} hover:text-c-heat-very-hot`} title="置き場の削除ページをブラウザで開く(imgbb)" onClick={() => props.onOpen(u.deleteUrl!)}>
              <span className="material-symbols-outlined text-base leading-none">delete_forever</span>
            </button>
          )}
          {u.withAccount && props.canDelete && (
            <button
              type="button"
              className={`${TOOL} hover:text-c-heat-very-hot`}
              title="catbox から削除"
              disabled={deleting === u.url}
              onClick={async () => {
                setDeleting(u.url)
                setError(undefined)
                try {
                  await props.onDelete(u.url)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setDeleting(undefined)
                }
              }}
            >
              <span className={`material-symbols-outlined text-base leading-none ${deleting === u.url ? 'animate-spin' : ''}`}>
                {deleting === u.url ? 'progress_activity' : 'delete'}
              </span>
            </button>
          )}
        </div>
      </div>
    )
  }
  const group = (title: string, note: string, list: UploadRecord[]) =>
    list.length > 0 && (
      <div className="mb-5">
        <p className="mb-2 text-xs font-bold text-c-text-strong">
          {title} <span className="ml-1 font-normal text-c-text-muted">{list.length} 件・{note}</span>
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">{list.map(card)}</div>
      </div>
    )
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && <p className="flex-shrink-0 px-4 py-2 text-xs text-c-heat-very-hot border-b border-c-border">{error}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
        {props.uploads.length === 0 ? (
          <p className="text-sm text-c-text-muted">まだありません</p>
        ) : (
          <>
            {group('消せる画像', props.canDelete ? 'アカウントで上げたもの。置き場からも消せます' : 'アカウントで上げたもの。消すには userhash の登録が要ります', deletable)}
            {group('消せない画像', '匿名で上げたもの。置き場から消せません', fixed)}
          </>
        )}
      </div>
      {/* 開く動きの transform の中に入れない(fixed が画面いっぱいにならない) */}
      {viewing !== undefined &&
        viewerUrls.length > 0 &&
        createPortal(
          <Lightbox
            urls={viewerUrls}
            index={Math.min(viewing, viewerUrls.length - 1)}
            saveDir={props.saveDir ?? ''}
            onIndex={setViewing}
            onClose={() => setViewing(undefined)}
            onOpenExternal={props.onOpen}
          />,
          document.body,
        )}
    </div>
  )
}

function DesktopUploadHistory(props: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)
  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="アップロード履歴" sub={props.uploads.length} onClose={props.onClose} />
        <UploadGrid {...props} />
      </div>
    </div>,
    document.body,
  )
}

/** スマホ: アップロード履歴のページ */
function MobileUploadHistory(props: Props) {
  const [sheet, setSheet] = useState<UploadRecord>()
  const [error, setError] = useState<string>()
  // 上げた日ごとにまとめる(新しい順のまま)
  const groups: { day: string; items: UploadRecord[] }[] = []
  for (const u of props.uploads) {
    const day = dayLabel(u.uploadedAt)
    if (groups.at(-1)?.day === day) groups.at(-1)!.items.push(u)
    else groups.push({ day, items: [u] })
  }
  return (
    <MobilePage
      title="アップロード履歴"
      count={props.uploads.length}
      onClose={props.onClose}
      note={
        props.canDelete
          ? '長押しで URL のコピー・削除ができます。消せるのは、アカウント(userhash)で上げたものだけです'
          : '長押しで URL をコピーできます。消すには、設定 → 書き込み で catbox のアカウント(userhash)を登録してください'
      }
    >
      {error && <p className="px-4 py-2 text-xs text-c-heat-very-hot">{error}</p>}
      {props.uploads.length === 0 ? (
        <p className="p-6 text-sm text-c-text-muted text-center">まだ上げていません</p>
      ) : (
        groups.map((g) => (
          <div key={g.day}>
            <p className="sticky top-0 z-[1] px-4 py-2 text-[14px] font-bold text-c-accent bg-c-surface2 border-b border-c-border">{g.day}</p>
            <div className="grid grid-cols-3 gap-1 p-1">
              {g.items.map((u) => (
                <UploadTile key={u.url} upload={u} onOpen={() => props.onOpen(u.url)} onMenu={() => setSheet(u)} />
              ))}
            </div>
          </div>
        ))
      )}
      {sheet && (
        <ActionSheet
          title={`${sheet.name}(${formatSize(sheet.size)})`}
          onClose={() => setSheet(undefined)}
          items={[
            { label: '開く', icon: 'open_in_new', onClick: () => props.onOpen(sheet.url) },
            { label: 'URL をコピー', icon: 'content_copy', onClick: () => void navigator.clipboard.writeText(sheet.url) },
            ...(sheet.deleteUrl ? [{ label: '置き場の削除ページを開く', icon: 'delete_forever', danger: true, onClick: () => props.onOpen(sheet.deleteUrl!) }] : []),
            ...(props.canDelete && sheet.withAccount
              ? [
                  {
                    label: 'catbox から削除',
                    icon: 'delete',
                    danger: true,
                    onClick: () => {
                      setError(undefined)
                      props.onDelete(sheet.url).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </MobilePage>
  )
}

/** スマホ: アップロード履歴の 1 枚。たたくと開き、長押しで操作のメニュー */
function UploadTile(props: { upload: UploadRecord; onOpen: () => void; onMenu: () => void }) {
  const longPress = useLongPress(props.onMenu)
  return (
    <button type="button" {...longPress} onClick={props.onOpen} className="relative aspect-square bg-c-surface3 overflow-hidden rounded-md active:opacity-80">
      <img src={props.upload.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
      {!props.upload.withAccount && (
        <span className="absolute bottom-1 left-1 px-1 rounded bg-black/60 text-white text-[9px] leading-tight">匿名</span>
      )}
    </button>
  )
}
