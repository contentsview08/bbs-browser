// 設定の「レス表示」。

import { Fragment, useEffect, useState } from 'react'
import { POST_DOUBLE_CLICKS, ID_STYLES, ID_POSITIONS, DEFAULT_SETTINGS, LIGHTBOX_CLOSE_CLICKS } from '../../ui/settings'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import FontSizeSlider, { PostFontSliders, setCssVar } from '../FontSizeSlider'
import { ListEditor, ThumbSample, Toggle, TextSetting } from '../SettingParts'
import { BTN_PRIMARY, ICON_BTN } from '../DialogParts'
import { type SettingsProps, Section, StickySample, Choice } from './common'
import { Segmented } from '../Segmented'
import { previewSavePath, timeVars } from '../../host/saveImage'
import { SAVE_NAME_EXAMPLES, SAVE_NAME_NOTE, SAVE_NAME_SAMPLE, SAVE_NAME_VARS } from '../../utils/saveName'

export function PostsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <StickySample settings={s} />
      <Section title="開く位置">
        <Choice
          value={s.openPosition}
          options={[
            { key: 'unread', name: '最初の未読' },
            { key: 'top', name: '先頭' },
            { key: 'bottom', name: '末尾' },
          ]}
          onChange={(v) => update('openPosition', v)}
        />
      </Section>
      <Section desktopOnly title="アンカー(>>1)のポップアップ" note="レス番号と ID は押すと一覧が出ます">
        <Choice
          value={s.anchorPopup}
          options={[
            { key: 'click', name: '押したら出す' },
            { key: 'hover', name: 'マウスを乗せたら出す' },
          ]}
          onChange={(v) => update('anchorPopup', v)}
        />
      </Section>
      <Section title="名前と ID" note="名前の省き方は、板ごとにも変えられます(設定 → 掲示板ごとの設定)">
        <Toggle
          checked={s.omitNoname}
          onChange={(v) => update('omitNoname', v)}
          label="名無しの名前を省く"
          note="そのスレで一番多い名前(レスの 3 割以上)と、板の既定の名前(「名無しさん」など)を名無しとみなして省きます。後ろのトリップなどは残します"
        />
        <Toggle
          checked={s.highlightOp}
          onChange={(v) => update('highlightOp', v)}
          label="スレ主に「主」の印"
          note=">>1 と同じ ID の書き込みに「主」の印を付けます(ID のない板では付きません)"
        />
        <Toggle
          checked={s.idShort}
          onChange={(v) => update('idShort', v)}
          label="ID を短く出す"
          note="先頭の 6 文字だけにして「ID:」も省きます(数えるのと色は ID 全体で)"
        />
        <p className="text-xs text-c-text-muted mt-3 mb-1.5">ID の見せ方</p>
        <div className="max-w-md">
          <Segmented label="ID の見せ方" value={s.idStyle} options={ID_STYLES} onChange={(v) => update('idStyle', v)} />
        </div>
        <p className="text-[10px] text-c-text-muted mt-1">{ID_STYLES.find((x) => x.key === s.idStyle)?.note}</p>
        <p className="text-xs text-c-text-muted mt-3 mb-1.5">ID の位置</p>
        <div className="max-w-md">
          <Segmented label="ID の位置" value={s.idPosition} options={ID_POSITIONS} onChange={(v) => update('idPosition', v)} />
        </div>
        <div className="mt-3">
          <Toggle checked={s.nameSubtle} onChange={(v) => update('nameSubtle', v)} label="名前欄を目立たなくする" note="名前とワッチョイを、日付や ID と同じ薄い色・同じ大きさにします。オフにすると名前の色で目立たせます" />
          <Toggle checked={s.watchoiShort} onChange={(v) => update('watchoiShort', v)} label="ワッチョイを短く出す" note="「(ワッチョイ 1a2b-3c4d)」を「(1a2b-3c4d)」にします(種類の言葉と IP を省く)" />
          <Toggle
            checked={s.iconFromWatchoi}
            onChange={(v) => update('iconFromWatchoi', v)}
            label="ワッチョイがあるときは、アイコンをワッチョイから作る"
            note="Discord 風・LINE 風・ID の見せ方「模様」のアイコン。ID は日ごとに変わりますが、ワッチョイは週ごとなので同じ人が同じアイコンで続きます"
          />
        </div>
      </Section>
      <Section title="文字の大きさ・余白" note="スレ表示の ︙ の「文字の大きさ・余白」でも、見ながら変えられます。基本の文字の大きさは「表示」にあります">
        <PostFontSliders settings={s} update={update} />
      </Section>
      <Section title="本文">
        <Toggle
          checked={s.tidyBlankLines}
          onChange={(v) => update('tidyBlankLines', v)}
          label="空行を整える"
          note="3 行以上続いた空行を 1 行にまとめ、本文の最後の空行を消します"
        />
        <Toggle
          checked={s.urlShorten}
          onChange={(v) => update('urlShorten', v)}
          label="URL を短く見せる"
          note="https:// を外し、長い URL は後ろを「…」で省きます。画像の URL は「画像」の札にし、続いて並んだものは「画像 ×3」のようにまとめます。押すと元の URL を開きます"
        />
        <Toggle
          checked={s.showLinkPreview}
          onChange={(v) => update('showLinkPreview', v)}
          label="リンクのカードを出す"
          note="画像でも動画でもないリンクに、ページのタイトル・説明・画像のカードを出します(画面に見えたときにページを取りに行きます)"
        />
        <Toggle
          checked={s.openLinksInApp}
          onChange={(v) => update('openLinksInApp', v)}
          label="リンクをアプリの中で開く"
          note="掲示板でないリンクを、外のブラウザではなくアプリの中で開きます。ウェブページは題・本文・画像だけを抜き出して出し(読めないページは右上からブラウザで開けます)、画像・動画・YouTube はそのまま見られます"
        />
      </Section>
      <Section title="日時の出し方" note="レスの頭の日時の形。元の形は、日時にマウスを乗せると出ます">
        {/* 表示スタイルの窓の「細かい表示」と同じ切り替えボタン(狭いと縦に並ぶ) */}
        <div className="max-w-md">
          <Segmented
            label="日時の出し方"
            value={s.dateStyle}
            options={[
              { key: 'md_w_hms' as const, name: '11/02(月) 19:01:15' },
              { key: 'md_hm' as const, name: '11/02 19:01' },
              { key: 'full' as const, name: '2026/11/02(月) 19:01:15.032' },
            ]}
            onChange={(v) => update('dateStyle', v)}
          />
        </div>
      </Section>
      <Section desktopOnly title="レスをダブルクリックしたとき" note="1 回押したときは、今までどおりアンカーツリー(ダブルクリックに操作を割り当てると、1 回の押しは少し遅れます)">
        <Choice value={s.postDoubleClick} options={POST_DOUBLE_CLICKS} onChange={(v) => update('postDoubleClick', v)} />
      </Section>
      <Section title="人気のレスの示し方" note="返信が 3 件からのレス。多いほど赤くします">
        <Choice
          value={s.heatStyle}
          options={[
            { key: 'left' as const, name: '左の帯' },
            { key: 'right' as const, name: '右の帯' },
            { key: 'text' as const, name: '本文の色' },
          ]}
          onChange={(v) => update('heatStyle', v)}
        />
      </Section>
      <Section title="画像とサムネイル" note="本文中の画像 URL(jpg・png・gif・webp)と動画を小さく出します">
        <p className="text-xs text-c-text-muted mb-1.5">サムネイルを読み込む</p>
        <Choice
          value={s.thumbLoad}
          options={[
            { key: 'always' as const, name: 'いつも' },
            { key: 'wifi' as const, name: 'Wi-Fi のときだけ' },
            { key: 'tap' as const, name: '押したら' },
            { key: 'never' as const, name: '出さない' },
          ]}
          onChange={(v) => update('thumbLoad', v)}
        />
        <p className="text-xs text-c-text-muted mt-1">
          読み込まないときは、サムネイルの枠だけを出します。押すと読み込み、もう一度押すと大きく見られます
        </p>
        <div className="mt-4">
        <ThumbSample kind="post" />
        <FontSizeSlider
          label="スレ表示(本文の画像・動画・YouTube)"
          value={s.postThumbSize}
          base={80}
          unset={-1}
          min={48}
          max={240}
          step={4}
          icons={['photo_size_select_small', 'photo_size_select_large']}
          preview={(px) => setCssVar('--post-thumb-size', `${px}px`)}
          onCommit={(px) => update('postThumbSize', px)}
        />
        <div className="mt-3">
          <ThumbSample kind="list" />
        </div>
        <FontSizeSlider
          label="スレ一覧(ふたばのカタログの絵など)"
          value={s.listThumbScale}
          base={1}
          unset={-1}
          min={0.5}
          max={3}
          step={0.25}
          format={(v) => `${v.toFixed(2)} 倍`}
          icons={['photo_size_select_small', 'photo_size_select_large']}
          preview={(v) => setCssVar('--list-thumb-scale', String(v))}
          onCommit={(v) => update('listThumbScale', v)}
        />
        </div>
        <Toggle
          checked={s.blurGross}
          onChange={(v) => update('blurGross', v)}
          label="グロ注意の画像をぼかす"
          note="下の言葉を含む返信が付いたレス(画像を貼った本人がそう書いたレスも)の、サムネイルと画像一覧をぼかします。押せばいつもどおり開けます"
        />
        {s.blurGross && (
          <div className="pl-1 mt-1 mb-3">
            <p className="text-xs text-c-text-muted mb-1.5">目印の言葉</p>
            <ListEditor noun="目印の言葉" items={s.grossWords} onChange={(v) => update('grossWords', v)} placeholder="例: 閲覧注意" />
          </div>
        )}
      </Section>
      <Section title="スレ表示の画面">
        <Toggle
          checked={s.showMinimap}
          onChange={(v) => update('showMinimap', v)}
          label="ミニマップを出す"
          note="スレ表示の右端に、人気レス・自分のレス・画像の位置と、未読の始まりを示します"
        />
        <Toggle
          checked={s.showNextCandidatesAtEnd}
          onChange={(v) => update('showNextCandidatesAtEnd', v)}
          label="スレの最後に次スレの候補を出す"
          note="スレが終わったら(dat 落ち・上限に達した)、-END- の下に次スレの候補を出します。オフでも「次スレを探す」で探せます"
        />
        <Toggle
          checked={s.showNextUnreadAtEnd}
          onChange={(v) => update('showNextUnreadAtEnd', v)}
          label="スレの最後に次の未読スレを出す"
          note="-END- の下に、いまのスレ一覧で次に未読のあるスレへのボタンを出します"
        />
      </Section>
      <Section desktopOnly title="画像ビューワーを閉じるボタン" note="画像ビューワーの上でこのボタンを押すと閉じます。Esc・背景のクリックでも閉じます">
        <Choice value={s.lightboxCloseClick} options={LIGHTBOX_CLOSE_CLICKS} onChange={(v) => update('lightboxCloseClick', v)} />
      </Section>
      <Section advanced desktopOnly title="画像の保存先" note="画像ビューワーの保存ボタンで、このフォルダの下へ保存します。空のときはダウンロードフォルダです。フォルダとファイル名は、板・スレの名前や日付で分けられます">
        <div className="flex items-center gap-2">
          <TextSetting value={s.imageSaveDir} onChange={(v) => update('imageSaveDir', v)} placeholder="ダウンロードフォルダ" className="flex-1" />
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={async () => {
              const dir = await openDialog({ directory: true, title: '画像の保存先を選ぶ' })
              if (typeof dir === 'string') update('imageSaveDir', dir)
            }}
          >
            フォルダを選ぶ
          </button>
          {s.imageSaveDir && (
            <button type="button" className={ICON_BTN} title="ダウンロードフォルダに戻す" onClick={() => update('imageSaveDir', '')}>
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
          )}
        </div>
        <div className="mt-3 text-sm text-c-text-body">フォルダとファイル名</div>
        <div className="mt-1 flex items-center gap-2">
          <TextSetting value={s.imageSaveName} onChange={(v) => update('imageSaveName', v)} placeholder={DEFAULT_SETTINGS.imageSaveName} mono className="flex-1" />
          {s.imageSaveName !== DEFAULT_SETTINGS.imageSaveName && (
            <button type="button" className={ICON_BTN} title="元のファイル名に戻す" onClick={() => update('imageSaveName', DEFAULT_SETTINGS.imageSaveName)}>
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
          )}
        </div>
        <SavePathPreview dir={s.imageSaveDir} pattern={s.imageSaveName} />
        <SaveNameHelp onPick={(p) => update('imageSaveName', p)} />
      </Section>
    </>
  )
}

/** 書き方から、見本の画像の保存先を作る(置き換えは Rust の save_name と同じもの) */
function useSavePath(pattern: string): string[] | undefined {
  const [parts, setParts] = useState<string[]>()
  useEffect(() => {
    let live = true
    previewSavePath(pattern, SAVE_NAME_SAMPLE.url, SAVE_NAME_SAMPLE.ext, { ...SAVE_NAME_SAMPLE.vars, ...timeVars() }).then(
      (p) => live && setParts(p),
      () => live && setParts(undefined),
    )
    return () => {
      live = false
    }
  }, [pattern])
  return parts
}

/** 今の書き方で、見本の画像がどこへ保存されるか */
function SavePathPreview(props: { dir: string; pattern: string }) {
  const parts = useSavePath(props.pattern)
  // Windows の区切りで見せる
  const sep = props.dir.includes('\\') || navigator.userAgent.includes('Windows') ? '\\' : '/'
  return (
    <div className="mt-2 text-xs text-c-text-muted">
      見本(エッヂの「なんでも実況E」の 12 番の abc123.jpg):
      <div className="mt-0.5 font-mono text-c-text-body break-all">{parts ? [props.dir || 'ダウンロード', ...parts].join(sep) : '…'}</div>
    </div>
  )
}

/** 使える変数と例(例を押すとその書き方にする) */
function SaveNameHelp(props: { onPick: (pattern: string) => void }) {
  return (
    <div className="mt-3 text-xs text-c-text-muted leading-relaxed">
      <p>{SAVE_NAME_NOTE}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {SAVE_NAME_VARS.map((v) => (
          <Fragment key={v.name}>
            <dt className="font-mono text-c-text-body">{v.name}</dt>
            <dd>{v.label}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="mt-2">例(押すとその書き方にします)</div>
      <ul className="mt-0.5">
        {SAVE_NAME_EXAMPLES.map((p) => (
          <SaveNameExample key={p} pattern={p} onPick={props.onPick} />
        ))}
      </ul>
    </div>
  )
}

function SaveNameExample(props: { pattern: string; onPick: (pattern: string) => void }) {
  const parts = useSavePath(props.pattern)
  return (
    <li>
      <button type="button" className="font-mono text-c-text-body hover:underline" onClick={() => props.onPick(props.pattern)}>
        {props.pattern}
      </button>
      {parts && <span> → {parts.join('/')}</span>}
    </li>
  )
}
