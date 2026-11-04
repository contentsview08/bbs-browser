// スマホの設定画面(PC の SettingsDialog とは別に作ったもの)。Android の設定画面と同じ形:
// トップにまとまりごとの分類を並べ、押すとその分類の画面が右からすべり込む。戻る(← ・戻るボタン・ジェスチャー)で 1 枚ずつ戻る。
// 1 つの画面には、その分類の設定を、まとまり(Group)ごとに全部並べる(1 項目だけの画面を挟んで、段を深くしない)。
// 説明は、スマホで触る人に向けて書く(キー・マウス・ウィンドウの話はしない)。
// NG・板の一覧・アカウント・バックアップなど、作りの大きな部品は、PC の設定画面のものを埋め込んで使う
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getVersion } from '@tauri-apps/api/app'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import {
  FONT_PX_KEY,
  MOBILE_POST_STYLES,
  PICKABLE_SCHEMES,
  ID_STYLES,
  baseFontPx,
  effectivePostStyle,
  effectiveScheme,
  isDarkScheme,
  pickScheme,
  type AppSettings,
  type UpdateSetting,
} from '../../ui/settings'
import { ensureNotifyPermission } from '../../utils/osNotify'
import FontSizeSlider, { BarSliders, cssPx, setCssVar } from '../FontSizeSlider'
import { MOBILE_HEAD_BTN, MOBILE_HEAD_ICON } from '../ActionBar'
import {
  AccountsTab,
  BackupTab,
  BoardListTab,
  BoardsTab,
  GestureSettings,
  ListTabsEditor,
  NgTab,
  SettingsEmbed,
  ToolbarsTab,
  UserhashInput,
  type SettingsProps,
} from '../SettingsDialog'
import { ActionRow, ChoiceRow, Group, NavRow, SwitchRow, TextRow, WordList } from './ui'

type PageId =
  | 'home'
  | 'theme'
  | 'text'
  | 'list'
  | 'listTabs'
  | 'thread'
  | 'media'
  | 'write'
  | 'behavior'
  | 'notify'
  | 'gestures'
  | 'buttons'
  | 'ng'
  | 'boards'
  | 'sites'
  | 'accounts'
  | 'backup'
  | 'about'

const TITLES: Record<PageId, string> = {
  home: '設定',
  theme: 'テーマと色',
  text: '文字と余白',
  list: 'スレ一覧',
  listTabs: 'スレ一覧のタブ',
  thread: 'スレ表示',
  media: '画像と動画',
  write: '書き込み',
  behavior: 'スクロールと更新',
  notify: '通知',
  gestures: 'ジェスチャー',
  buttons: 'ボタンの配置',
  ng: 'NG',
  boards: '板を探す',
  sites: 'お気に入り板とサイト',
  accounts: 'アカウント',
  backup: 'バックアップ',
  about: 'このアプリについて',
}

export default function MobileSettings(props: SettingsProps & { initialPage?: PageId }) {
  const { settings: s, update } = props
  const [stack, setStack] = useState<PageId[]>(props.initialPage && props.initialPage !== 'home' ? ['home', props.initialPage] : ['home'])
  /** 戻ったか(すべりの向きを変える) */
  const [back, setBack] = useState(false)
  const page = stack[stack.length - 1]
  const push = (p: PageId) => {
    setBack(false)
    setStack((st) => [...st, p])
  }
  const pop = () => {
    if (stack.length <= 1) return props.onClose()
    setBack(true)
    setStack((st) => st.slice(0, -1))
  }
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, pop)
  // 画面を移ったら、いちばん上から
  const scrollRef = useRef<HTMLDivElement>(null)
  // 波かっこで包んで何も返さない(新しい WebView の scrollTo は Promise を返し、React が後片付けの関数として呼んで落ちる)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page])

  return createPortal(
    <div
      ref={boxRef}
      className="fixed inset-0 z-[9500] flex flex-col bg-c-surface"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-shrink-0 flex items-center gap-1 px-1 bg-panel-thread-header border-b border-c-border" style={{ height: 'var(--header-height, 72px)' }}>
        <button type="button" onClick={pop} className={MOBILE_HEAD_BTN} title={stack.length > 1 ? '戻る' : '閉じる'}>
          <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>{stack.length > 1 ? 'arrow_back' : 'close'}</span>
        </button>
        <h2 className="flex-1 min-w-0 truncate text-[20px] font-bold text-c-text-strong">{TITLES[page]}</h2>
      </div>
      <div ref={scrollRef} key={page} className={`flex-1 min-h-0 overflow-y-auto pt-5 pb-10 ${back ? 'page-back' : 'page-in'}`}>
        {renderPage(page, props, s, update, push)}
      </div>
    </div>,
    document.body,
  )
}

/** 1 つの画面の中身 */
function renderPage(page: PageId, props: SettingsProps, s: AppSettings, update: UpdateSetting, push: (p: PageId) => void): ReactNode {
  const scheme = PICKABLE_SCHEMES.find((c) => c.key === effectiveScheme(s))
  switch (page) {
    case 'home':
      return (
        <>
          <Group title="見た目">
            <NavRow icon="palette" color="#8b5cf6" label="テーマと色" value={scheme?.name} onClick={() => push('theme')} />
            <NavRow icon="format_size" color="#6366f1" label="文字と余白" value={`${baseFontPx(s)}px`} onClick={() => push('text')} />
          </Group>
          <Group title="読む">
            <NavRow icon="view_list" color="#0ea5e9" label="スレ一覧" desc="並び順・タブ・キーワード・ログ" onClick={() => push('list')} />
            <NavRow icon="forum" color="#3b82f6" label="スレ表示" desc="開いたときの位置・本文・リンク" onClick={() => push('thread')} />
            <NavRow icon="image" color="#06b6d4" label="画像と動画" desc="サムネイル・読み込み・グロ注意" onClick={() => push('media')} />
          </Group>
          <Group title="書く">
            <NavRow icon="edit" color="#f59e0b" label="書き込み" desc="名前・定型文・画像のアップロード" onClick={() => push('write')} />
            <NavRow icon="badge" color="#d97706" label="アカウント" desc="BE などのログイン" onClick={() => push('accounts')} />
          </Group>
          <Group title="操作">
            <NavRow icon="swipe" color="#ec4899" label="ジェスチャー" desc="なぞって操作する形" onClick={() => push('gestures')} />
            <NavRow icon="toolbar" color="#f43f5e" label="ボタンの配置" desc="ヘッダー・フッター・︙ の並び" onClick={() => push('buttons')} />
            <NavRow icon="sync" color="#10b981" label="スクロールと更新" desc="自動更新・引っぱって更新" onClick={() => push('behavior')} />
            <NavRow icon="notifications" color="#22c55e" label="通知" onClick={() => push('notify')} />
          </Group>
          <Group title="NG">
            <NavRow icon="block" color="#ef4444" label="NG" value={`${s.ngRules.length} 件`} onClick={() => push('ng')} />
          </Group>
          <Group title="板とデータ">
            <NavRow icon="star" color="#14b8a6" label="お気に入り板とサイト" value={`${props.favorites.length} 板`} onClick={() => push('sites')} />
            <NavRow icon="travel_explore" color="#0891b2" label="板を探す" desc="BBS メニューから板を選ぶ" onClick={() => push('boards')} />
            <NavRow icon="backup" color="#64748b" label="バックアップ" onClick={() => push('backup')} />
            <NavRow icon="info" color="#6b7280" label="このアプリについて" onClick={() => push('about')} />
          </Group>
        </>
      )

    case 'theme':
      return (
        <>
          <Group>
            <SwitchRow
              label="スマホのダーク・ライトに合わせる"
              desc="オンにすると、暗い配色と明るい配色を 1 つずつ選び、スマホの設定に合わせて切り替えます"
              checked={s.followOsTheme}
              onChange={(v) => update('followOsTheme', v)}
            />
          </Group>
          <Group title="配色" note={s.followOsTheme ? '暗い配色と明るい配色を、それぞれ 1 つ選んでください' : undefined}>
            <div className="grid grid-cols-2 gap-2.5 p-3">
              {PICKABLE_SCHEMES.map((c) => {
                const chosen = s.followOsTheme ? c.key === s.darkScheme || c.key === s.lightScheme : s.scheme === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      for (const [k, v] of Object.entries(pickScheme(s, c.key))) update(k as keyof AppSettings, v as never)
                    }}
                    className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border-2 text-left transition-colors ${chosen ? 'border-c-accent bg-c-surface' : 'border-transparent bg-c-surface/60'}`}
                  >
                    <span className="w-7 h-7 flex-shrink-0 rounded-full" style={{ background: c.accent, boxShadow: `inset 0 0 0 2px ${c.border}` }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] text-c-text-strong truncate">{c.name}</span>
                      <span className="block text-[13px] text-c-text-muted">{isDarkScheme(c.key) ? 'ダーク' : 'ライト'}</span>
                    </span>
                    {chosen && <span className="material-symbols-outlined fill text-xl text-c-accent">check_circle</span>}
                  </button>
                )
              })}
            </div>
          </Group>
          <Group title="レスの見た目">
            <ChoiceRow
              label="見た目"
              value={effectivePostStyle(s)}
              options={MOBILE_POST_STYLES.map((p) => ({ key: p.key, name: p.name, desc: p.note }))}
              onChange={(v) => update('postStyle', v)}
            />
          </Group>
        </>
      )

    case 'text': {
      const base = baseFontPx(s)
      return (
        <>
          <Group title="文字の大きさ" note="動かすと、その場で変わります。「元に戻す」で、画面全体の大きさに合わせます">
            <FontSizeSlider label="画面全体" value={base} base={base} preview={(px) => (document.documentElement.style.fontSize = `${px}px`)} onCommit={(px) => update(FONT_PX_KEY, px)} />
            <FontSizeSlider label="スレ一覧" value={s.listFontPx} base={base} preview={(px) => setCssVar('--list-zoom', String(px / base))} onCommit={(px) => update('listFontPx', px)} resettable />
            <FontSizeSlider label="レスの本文" value={s.postBodyPx} base={base} preview={(px) => setCssVar('--post-body-size', `${px}px`)} onCommit={(px) => update('postBodyPx', px)} resettable />
            <FontSizeSlider label="レスの頭(名前・日付・ID)" value={s.postHeadPx} base={base} preview={(px) => setCssVar('--post-head-zoom', String(px / base))} onCommit={(px) => update('postHeadPx', px)} resettable />
            <FontSizeSlider
              label="レスの本文の行間"
              value={s.postLineHeight}
              base={1.625}
              min={1}
              max={2.4}
              step={0.05}
              format={(v) => `${v.toFixed(2)} 倍`}
              icons={['format_line_spacing', 'format_line_spacing']}
              preview={(v) => setCssVar('--post-line-height', String(v))}
              onCommit={(v) => update('postLineHeight', v)}
              resettable
            />
          </Group>
          <Group title="余白">
            <FontSizeSlider
              label="スレとスレの間"
              value={s.listPadPx}
              unset={-1}
              base={cssPx('--thread-card-padding-y', 8)}
              min={0}
              max={24}
              icons={['density_small', 'density_large']}
              preview={(px) => {
                setCssVar('--list-row-pad', `${px}px`)
                document.documentElement.setAttribute('data-list-pad', '')
              }}
              onCommit={(px) => update('listPadPx', px)}
              resettable
            />
            <FontSizeSlider
              label="レスとレスの間"
              value={s.postPadPx}
              unset={-1}
              base={cssPx('--post-padding-y', 6)}
              min={0}
              max={24}
              icons={['density_small', 'density_large']}
              preview={(px) => setCssVar('--post-padding-y', `${px}px`)}
              onCommit={(px) => update('postPadPx', px)}
              resettable
            />
          </Group>
          <Group title="ヘッダーとフッター">
            <BarSliders settings={s} update={update} />
          </Group>
        </>
      )
    }

    case 'list':
      return (
        <>
          <Group title="並び">
            <ChoiceRow
              label="板を開いたときの並び"
              value={s.threadSort}
              options={[
                { key: 'subject', name: '更新順', desc: '掲示板の並び(書き込みのあった順)' },
                { key: 'momentum', name: '勢い順' },
                { key: 'newest', name: '新しい順' },
                { key: 'count', name: 'レス数順' },
              ]}
              onChange={(v) => update('threadSort', v)}
            />
            <NavRow label="タブ" desc="一覧の下に出すタブと、その並び" value={`${s.listTabs.length} 個`} onClick={() => push('listTabs')} />
          </Group>
          <Group title="キーワード" note="スレタイにこの言葉が入っているスレを、一覧のいちばん上にまとめて出します">
            <WordList items={s.keywords} placeholder="キーワードを足す" empty="まだありません" onChange={(v) => update('keywords', v)} />
          </Group>
          <Group title="ログ" note="お気に入りのスレ・自分が書き込んだスレは消しません。消したスレは、もう一度開けば取り直します">
            <ChoiceRow
              label="開いていないスレのログを消す"
              value={s.logRetentionDays}
              options={[
                { key: 30, name: '30 日たったら' },
                { key: 90, name: '90 日たったら' },
                { key: 180, name: '180 日たったら' },
                { key: 365, name: '1 年たったら' },
                { key: 0, name: '消さない' },
              ]}
              onChange={(v) => update('logRetentionDays', v)}
            />
            <PruneRow onPrune={props.onPruneLogs} />
          </Group>
        </>
      )

    case 'listTabs':
      return (
        <Group note="右のつまみ(⋮⋮)をつかんで上下に動かすと、並びが変わります(上が左)。− で外し、下の ＋ で足します">
          <div className="p-3">
            <ListTabsEditor value={s.listTabs} onChange={(v) => update('listTabs', v)} />
          </div>
        </Group>
      )

    case 'thread':
      return (
        <>
          <Group title="開いたとき">
            <ChoiceRow
              label="開く位置"
              value={s.openPosition}
              options={[
                { key: 'unread', name: '最初の未読', desc: 'まだ読んでいないレスの頭から' },
                { key: 'top', name: '先頭' },
                { key: 'bottom', name: 'いちばん下' },
              ]}
              onChange={(v) => update('openPosition', v)}
            />
          </Group>
          <Group title="本文">
            <SwitchRow label="名無しの名前を省く" desc="板の既定の名前(「名無しさん」など)を出しません" checked={s.omitNoname} onChange={(v) => update('omitNoname', v)} />
            <SwitchRow label="空行を整える" desc="3 行以上続いた空行を 1 行にまとめ、最後の空行を消します" checked={s.tidyBlankLines} onChange={(v) => update('tidyBlankLines', v)} />
          </Group>
          <Group title="印">
            <SwitchRow label="スレ主に「主」の印" desc=">>1 と同じ ID のレス" checked={s.highlightOp} onChange={(v) => update('highlightOp', v)} />
            <ChoiceRow label="ID の見せ方" desc="色は 2 回以上書いた ID を ID ごとの色に。模様は ID から作るアイコンを番号の左と、スレ一覧の立てた人に" value={s.idStyle} options={ID_STYLES.map((x) => ({ key: x.key, name: x.name }))} onChange={(v) => update('idStyle', v)} />
            <SwitchRow label="ミニマップを出す" desc="右端に、人気レス・自分のレス・画像の位置を示します" checked={s.showMinimap} onChange={(v) => update('showMinimap', v)} />
          </Group>
          <Group title="リンク">
            <SwitchRow label="URL を短く見せる" desc="https:// を外し、長いものは後ろを省きます。画像の URL は「画像」の札にし、続いたものは「画像 ×3」のようにまとめます" checked={s.urlShorten} onChange={(v) => update('urlShorten', v)} />
            <SwitchRow label="リンクのカードを出す" desc="ページの題と画像を、本文の下に小さく" checked={s.showLinkPreview} onChange={(v) => update('showLinkPreview', v)} />
            <SwitchRow label="リンクをアプリの中で開く" desc="オフにすると、ブラウザで開きます" checked={s.openLinksInApp} onChange={(v) => update('openLinksInApp', v)} />
          </Group>
        </>
      )

    case 'media':
      return (
        <>
          <Group title="サムネイル">
            <ChoiceRow
              label="サムネイルを読み込む"
              value={s.thumbLoad}
              options={[
                { key: 'always', name: 'いつも' },
                { key: 'wifi', name: 'Wi-Fi のときだけ', desc: 'モバイルの回線では枠だけ出し、押したら読みます' },
                { key: 'tap', name: '押したら', desc: 'いつも枠だけ出し、押したら読みます' },
                { key: 'never', name: '出さない', desc: '本文の画像をサムネイルにしません' },
              ]}
              onChange={(v) => update('thumbLoad', v)}
            />
            <ChoiceRow
              label="大きさ"
              value={s.postThumbSize}
              options={[
                { key: 64, name: '小' },
                { key: 80, name: '標準' },
                { key: 120, name: '大' },
                { key: 160, name: '特大' },
                { key: 220, name: '最大' },
              ]}
              onChange={(v) => update('postThumbSize', v)}
            />
          </Group>
          <Group title="グロ注意" note="この言葉を含む返信が付いた画像は、ぼかして出します(押せば見られます)">
            <SwitchRow label="グロ注意の画像をぼかす" checked={s.blurGross} onChange={(v) => update('blurGross', v)} />
            {s.blurGross && <WordList items={s.grossWords} placeholder="言葉を足す" onChange={(v) => update('grossWords', v)} />}
          </Group>
        </>
      )

    case 'write':
      return (
        <>
          <Group title="ふだん使う名前" note="板ごとの名前は、お気に入り板の設定で変えられます">
            <TextRow label="名前" value={s.postName} placeholder="名無し" onChange={(v) => update('postName', v)} />
            <TextRow label="メール" value={s.postMail} placeholder="sage など" onChange={(v) => update('postMail', v)} />
          </Group>
          <Group title="定型文" note="レスを長押ししたメニューから、そのレスへのアンカーを付けて、すぐ書き込めます">
            <WordList items={s.quickPhrases} placeholder="定型文を足す" empty="まだありません" onChange={(v) => update('quickPhrases', v)} />
          </Group>
          <Group title="画像のアップロード" note="書き込み欄の ＋ → 画像 で選んだ画像を上げ先に上げ、本文に URL を入れます。位置情報など(EXIF)はいつも消してから上げます">
            <ChoiceRow
              label="大きい画像を縮める"
              value={s.uploadMaxDimension}
              options={[0, 1280, 1920, 2560, 4096].map((n) => ({ key: n, name: n === 0 ? '縮めない' : `長い辺 ${n}px まで` }))}
              onChange={(v) => update('uploadMaxDimension', v)}
            />
            <div className="px-4 py-3">
              <p className="mb-2 text-[15px] text-c-text-strong">アカウント(userhash)</p>
              <p className="mb-2 text-[12.5px] leading-relaxed text-c-text-muted">登録すると、上げた画像をあとで消せます(なくても上げられます)</p>
              <UserhashInput value={s.catboxUserhash} onChange={(v) => update('catboxUserhash', v)} />
            </div>
          </Group>
        </>
      )

    case 'behavior':
      return (
        <>
          <Group title="スクロール">
            <SwitchRow label="下へスクロールしたら、ヘッダーとフッターを隠す" desc="上へスクロールすると、すぐ戻ります" checked={s.hideBarsOnScroll} onChange={(v) => update('hideBarsOnScroll', v)} />
            <SwitchRow label="いちばん下を見ているときは、新着まで送る" checked={s.autoScrollOnNew} onChange={(v) => update('autoScrollOnNew', v)} />
          </Group>
          <Group title="更新">
            <SwitchRow label="書き込み欄の右に更新ボタン" checked={s.showRefreshFab} onChange={(v) => update('showRefreshFab', v)} />
            <ChoiceRow
              label="開いているスレの自動更新"
              desc="実況など、流れの速いスレ向け"
              value={s.autoRefreshSec}
              options={[0, 5, 10, 20, 30, 60].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 秒ごと` }))}
              onChange={(v) => update('autoRefreshSec', v)}
            />
            <ChoiceRow
              label="お気に入りのスレの新着を確かめる"
              value={s.favCheckMin}
              options={[0, 3, 5, 10, 30].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 分ごと` }))}
              onChange={(v) => update('favCheckMin', v)}
            />
          </Group>
        </>
      )

    case 'notify':
      return (
        <>
          <Group note="アプリを完全に閉じている間は、新着を確かめられないので知らせません">
            <SwitchRow
              label="スマホの通知の欄にも出す"
              desc="アプリを裏に回しているときは、下の知らせを Android の通知でも出します"
              checked={s.osNotify}
              onChange={(v) => {
                update('osNotify', v)
                if (v)
                  void ensureNotifyPermission().then(
                    (ok) => !ok && alert('通知が許可されていません。Android の設定 → アプリ → OBB → 通知 から許可してください'),
                  )
              }}
            />
          </Group>
          <Group title="知らせること">
            <ChoiceRow
              label="キーワードに合うスレが立った"
              desc="お気に入り板を見に行き、スレ一覧のキーワードを含むスレを知らせます"
              value={s.keywordWatchMin}
              options={[0, 5, 10, 30, 60].map((n) => ({ key: n, name: n === 0 ? '知らせない' : `${n} 分ごとに見る` }))}
              onChange={(v) => update('keywordWatchMin', v)}
            />
          </Group>
        </>
      )

    case 'gestures':
      return (
        <Embed>
          <GestureSettings settings={s} update={update} />
        </Embed>
      )
    case 'buttons':
      return (
        <Embed>
          <ToolbarsTab settings={s} update={update} />
        </Embed>
      )
    case 'ng':
      return (
        <Embed>
          <NgTab settings={s} update={update} />
        </Embed>
      )
    case 'sites':
      return (
        <Embed>
          <BoardsTab {...props} onShowBoardList={() => push('boards')} />
        </Embed>
      )
    case 'boards':
      return (
        <Embed fill>
          <BoardListTab
            sites={props.sites}
            favorites={props.favorites}
            loadBoards={props.loadBoards}
            onToggleFavorite={props.onToggleFavorite}
            onOpenBoard={props.onOpenBoard}
          />
        </Embed>
      )
    case 'accounts':
      return (
        <Embed>
          <AccountsTab {...props} />
        </Embed>
      )
    case 'backup':
      return (
        <Embed>
          <BackupTab {...props} />
        </Embed>
      )
    case 'about':
      return <About />
  }
}

/** PC の設定画面の部品を、スマホの画面の余白で包んで出す */
function Embed(props: { children: ReactNode; fill?: boolean }) {
  return (
    // 前の設定画面の部品は字が小さいので、中身ごと少し拡大する
    <div className={`px-5 ${props.fill ? 'h-full flex flex-col' : ''}`} style={{ zoom: 1.12 }}>
      <SettingsEmbed>{props.children}</SettingsEmbed>
    </div>
  )
}

/** 古いログを今すぐ整理する行 */
function PruneRow(props: { onPrune: () => Promise<number> }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string>()
  return (
    <ActionRow
      label="今すぐ整理する"
      desc={done}
      icon="cleaning_services"
      busy={busy}
      onClick={() => {
        setBusy(true)
        void props
          .onPrune()
          .then((n) => setDone(n > 0 ? `${n} スレのログを消しました` : '消すログはありませんでした'))
          .finally(() => setBusy(false))
      }}
    />
  )
}

function About() {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    void getVersion().then(setVersion, () => undefined)
  }, [])
  return (
    <>
      <div className="flex flex-col items-center gap-2 pt-6 pb-8">
        <span className="w-16 h-16 rounded-2xl bg-c-accent flex items-center justify-center text-[var(--c-accent-text)]">
          <span className="material-symbols-outlined text-4xl">forum</span>
        </span>
        <p className="text-lg font-bold text-c-text-strong">OBB</p>
        {version && <p className="text-sm text-c-text-muted">版 {version}</p>}
      </div>
      <Group>
        <p className="px-4 py-4 text-[13.5px] leading-relaxed text-c-text-body">
          掲示板を読む専用ブラウザです。5ch・エッジ・bbspink などの 2ch 互換の掲示板、したらば、まちBBS、ふたばを読めます。
        </p>
      </Group>
    </>
  )
}
