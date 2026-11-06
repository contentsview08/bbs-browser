// 設定画面。左に分類、右に中身。変更はその場で反映・保存する(「保存」ボタンはない)。

import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDialogRect } from '../hooks/useDialogRect'
import { useFocusTrap } from '../hooks/useFocusTrap'
import CustomSchemeEditor from './mobile/CustomSchemeEditor'
import { Switch } from './SettingParts'
import { ICON_BTN } from './DialogParts'
import { AboutTab } from './settings/AboutTab'
import { AccountsTab } from './settings/AccountsTab'
import { BackupTab } from './settings/BackupTab'
import { BoardListTab } from './settings/BoardListTab'
import { BoardsTab } from './settings/BoardsTab'
import { DisplayTab } from './settings/DisplayTab'
import { KeysTab } from './settings/KeysTab'
import { NgTab } from './settings/NgTab'
import { NotifyTab } from './settings/NotifyTab'
import { PostsTab } from './settings/PostsTab'
import { RefreshTab } from './settings/RefreshTab'
import { ThreadsTab } from './settings/ThreadsTab'
import { ToolbarsTab } from './settings/ToolbarsTab'
import { UploadTab } from './settings/UploadTab'
import { WriteTab } from './settings/WriteTab'
import { type SettingsProps, type SettingsTab, AdvancedContext, SearchContext } from './settings/common'

export type { SettingsProps, SettingsTab } from './settings/common'

type Tab = SettingsTab

const TABS: { key: Tab; name: string; icon: string }[] = [
  { key: 'display', name: '表示', icon: 'palette' },
  { key: 'threads', name: 'スレ一覧', icon: 'view_list' },
  { key: 'posts', name: 'レス表示', icon: 'forum' },
  { key: 'write', name: '書き込み', icon: 'edit' },
  { key: 'upload', name: '画像のアップロード', icon: 'cloud_upload' },
  { key: 'refresh', name: '自動更新', icon: 'autorenew' },
  { key: 'notify', name: '通知', icon: 'notifications' },
  { key: 'keys', name: 'キー操作', icon: 'keyboard' },
  { key: 'toolbars', name: 'ボタンの配置', icon: 'toolbar' },
  { key: 'ng', name: 'NG', icon: 'block' },
  { key: 'boardlist', name: '板一覧', icon: 'list_alt' },
  { key: 'boards', name: 'お気に入り板', icon: 'star' },
  { key: 'menus', name: 'BBS メニュー', icon: 'dns' },
  { key: 'accounts', name: '掲示板ごとの設定', icon: 'tune' },
  { key: 'backup', name: 'バックアップ', icon: 'backup' },
  { key: 'about', name: 'このアプリについて', icon: 'info' },
]

export default function SettingsDialog(props: SettingsProps) {
  const [tab, setTabState] = useState<Tab>(props.initialTab ?? 'display')
  /** 自分の配色の画面を開いているか(「表示」のもう 1 段下) */
  const [schemePage, setSchemePage] = useState(false)
  /** その画面から戻ったところか(すべりの向きを変える) */
  const [cameBack, setCameBack] = useState(false)
  const setTab = (next: Tab) => {
    setTabState(next)
    setSchemePage(false)
    setCameBack(false)
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollBeforePage = useRef(0)
  const openSchemePage = () => {
    scrollBeforePage.current = bodyRef.current?.scrollTop ?? 0
    setQuery('')
    setTabState('display')
    setCameBack(false)
    setSchemePage(true)
  }
  const closeSchemePage = () => {
    setCameBack(true)
    setSchemePage(false)
  }
  // 入るときは一番上から、戻るときは元の位置へ
  useLayoutEffect(() => {
    bodyRef.current?.scrollTo({ top: schemePage ? 0 : scrollBeforePage.current })
  }, [schemePage])
  useEffect(() => {
    if (props.requestedTab) setTab(props.requestedTab.tab)
    // seq が変わったときだけ
  }, [props.requestedTab?.seq])
  /** 「BBS メニュー」から板一覧へ移るときに、どの BBS メニューを出すか */
  const [listSite, setListSite] = useState<string>()
  /** 設定の検索。言葉があるときは、すべての分類から当てはまる設定だけを並べる */
  const [query, setQuery] = useState('')
  // 検索の結果は全分類を描くので重い。打っている間は少し遅らせて、入力の反応を止めない
  const deferredQuery = useDeferredValue(query)
  const searching = query.trim() !== ''
  const showAdvanced = props.settings.showAdvanced

  // 置き場所(左上の角)と大きさ。動かした・大きさを変えたら覚えておき、次に開いたときも同じ所・大きさで出す
  const dialog = useDialogRect('bbs:settings-dialog-rect2', { w: 896, h: 720, minW: 560, minH: 360 })
  // Esc は、文字を打っている欄の中では 1 回目は欄を抜けるだけ(検索語・URL を打っている途中で設定ごと消えないように)
  useFocusTrap(dialog.boxRef, () => (schemePage ? closeSchemePage() : props.onClose()), { escBlursInputs: true })

  const renderTab = (key: Tab) => {
    switch (key) {
      case 'display':
        return <DisplayTab {...props} onOpenCustomScheme={openSchemePage} />
      case 'threads':
        return <ThreadsTab {...props} />
      case 'posts':
        return <PostsTab {...props} />
      case 'write':
        return <WriteTab {...props} />
      case 'upload':
        return <UploadTab {...props} />
      case 'refresh':
        return <RefreshTab {...props} />
      case 'notify':
        return <NotifyTab {...props} />
      case 'keys':
        return <KeysTab {...props} />
      case 'toolbars':
        return <ToolbarsTab {...props} />
      case 'ng':
        return <NgTab {...props} />
      case 'boardlist':
        return (
          <BoardListTab
            key={listSite}
            sites={props.sites}
            initialSite={listSite}
            favorites={props.favorites}
            loadBoards={props.loadBoards}
            onToggleFavorite={props.onToggleFavorite}
            onOpenBoard={props.onOpenBoard}
          />
        )
      case 'boards':
      case 'menus':
        return (
          <BoardsTab
            {...props}
            part={key === 'boards' ? 'favorites' : 'menus'}
            onShowBoardList={(menuUrl) => {
              setListSite(menuUrl)
              setTab('boardlist')
            }}
          />
        )
      case 'accounts':
        return <AccountsTab {...props} />
      case 'backup':
        return <BackupTab {...props} />
      case 'about':
        return <AboutTab settings={props.settings} update={props.update} />
    }
  }
  /** 検索の結果: すべての分類を並べ、当てはまる Section だけを出す(板一覧は大きいので入れない) */
  const searchResults = (
    <SearchContext.Provider value={deferredQuery}>
      {TABS
        .filter((t) => t.key !== 'boardlist')
        .map((t) => (
          <div key={t.key} className="settings-group">
            <p className="flex items-center gap-2 mb-3 text-xs font-bold text-c-accent">
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.name}
            </p>
            {renderTab(t.key)}
          </div>
        ))}
      <p className="settings-empty text-sm text-c-text-muted">見つかりませんでした</p>
    </SearchContext.Provider>
  )
  const searchBox = (
    <div className="flex items-center gap-2 px-3 h-10 bg-c-surface2 border border-c-border rounded-full focus-within:border-c-accent">
      <span className="material-symbols-outlined text-lg text-c-text-muted">search</span>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSchemePage(false)
          setCameBack(false)
        }}
        placeholder="設定を探す(例: 文字の大きさ・NG・スワイプ)"
        className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-c-text-body placeholder-c-text-muted focus:ring-0"
      />
      {searching && (
        <button type="button" onClick={() => setQuery('')} className="p-0.5 text-c-text-muted" title="検索をやめる">
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      )}
    </div>
  )

  return (
    // 設定画面は「置いたまま使える窓」。後ろは暗くせず、外を押しても閉じない(閉じるのは × と Esc)。
    // 小さくして横に寄せ、後ろの画面で効き具合を見ながら直せる(後ろはスクロールもできる)
    <div className={props.windowed ? 'fixed inset-0 z-[9500]' : 'fixed inset-0 z-[9500] pointer-events-none'}>
      <div
        ref={dialog.boxRef}
        // 自分のウィンドウ(windowed)なら枠いっぱいに描き、動かす・大きさを変えるのは OS のウィンドウに任せる
        className={props.windowed ? 'absolute inset-0 flex bg-c-surface overflow-hidden' : 'absolute flex pointer-events-auto bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl overflow-hidden rise-in'}
        style={props.windowed ? undefined : dialog.style}
        onClick={(e) => e.stopPropagation()}
        onMouseUp={props.windowed ? undefined : dialog.saveSize}
      >
        <nav className="w-52 flex-shrink-0 flex flex-col bg-c-surface2 border-r border-c-border py-3">
          <h2 className="px-5 pb-3 text-lg font-bold text-c-text-strong">設定</h2>
          <div className="px-3 pb-2">{searchBox}</div>
          {/* 分類が多くて入りきらないときは、この並びだけスクロールする(下の「詳しい設定」は動かさない) */}
          <div className="flex-1 min-h-0 overflow-y-auto hover-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setQuery('')
                setTab(t.key)
              }}
              className={`w-full flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                tab === t.key && !searching ? 'active-board text-c-text-strong' : 'text-c-text-body hover:bg-c-surface3'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${tab === t.key && !searching ? 'fill' : ''}`}>{t.icon}</span>
              {t.name}
            </button>
          ))}
          </div>
          {/* 詳しい設定。オフ(はじめ)のときは、よく使う設定だけを見せる */}
          <label className="flex-shrink-0 mt-2 mx-3 px-2 py-2 flex items-center gap-2 rounded-lg cursor-pointer hover:bg-c-surface3 select-none" title="細かい見た目・通信・置き場などの設定も出します">
            <Switch
              checked={props.settings.showAdvanced}
              onChange={(v) => props.update('showAdvanced', v)}
            />
            <span className="text-xs text-c-text-body whitespace-nowrap">詳しい設定を出す</span>
          </label>
        </nav>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className={`flex items-center justify-between px-6 py-3 border-b border-c-border select-none ${props.windowed ? '' : 'cursor-move'}`} onMouseDown={props.windowed ? undefined : dialog.startMove} title={props.windowed ? undefined : 'つかんで動かす'}>
            <h3 className="flex items-center gap-1 text-base font-bold text-c-text-strong">
              {schemePage && (
                <button type="button" onClick={closeSchemePage} className={`${ICON_BTN} -ml-2`} title="表示へ戻る">
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>
              )}
              {searching ? '設定の検索' : schemePage ? '自分の配色' : TABS.find((t) => t.key === tab)?.name}
            </h3>
            <button type="button" onClick={props.onClose} className={ICON_BTN} title="閉じる">
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <AdvancedContext.Provider value={showAdvanced}>
          <div
            ref={bodyRef}
            className={`flex-1 min-h-0 px-6 py-5 ${tab === 'boardlist' && !searching ? 'flex flex-col overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}
          >
            {searching ? (
              searchResults
            ) : schemePage ? (
              // overflow-x-clip: すべっている間に横のスクロールバーを出さない(clip なので sticky は効いたまま)
              <div className="overflow-x-clip">
                <div className="page-in">
                  <CustomSchemeEditor settings={props.settings} update={props.update} stickySample />
                </div>
              </div>
            ) : cameBack ? (
              <div className="overflow-x-clip">
                <div className="page-back">{renderTab(tab)}</div>
              </div>
            ) : (
              renderTab(tab)
            )}
          </div>
          </AdvancedContext.Provider>
        </div>
      </div>
    </div>
  )
}
