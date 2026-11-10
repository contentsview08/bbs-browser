import { isCustomDark, parseCustom } from '../../ui/customScheme'
import { useEffect, useState } from 'react'
import {
  ACCENTS,
  COLOR_SCHEMES,
  POST_STYLES,
  QUOTE_STYLES,
  QUOTE_STYLE_POSTS,
  TREE_STYLES,
  effectivePostStyle,
  effectiveScheme,
  isDarkScheme,
  pickScheme,
  styleOptionsOf,
  withStyleOption,
  type AppSettings,
} from '../../ui/settings'
import { DepthSlider, postStyleName } from '../StyleMenu'
import { Segmented } from '../Segmented'
import { loadSystemFonts, type SystemFont } from '../../host/systemFonts'
import { BaseFontSlider } from '../FontSizeSlider'
import { ManagerDialog, NumberField, OpenRow, Toggle } from '../SettingParts'
import { BTN_PRIMARY, INPUT } from '../DialogParts'
import { backgroundImageUrl, importBackgroundImage } from '../../host/backgroundImage'
import { pickOpenPath } from '../../host/dialog'
import { FONT_NOTE } from '../../host/fonts'
import { FontRows } from './FontRows'
import { type SettingsProps, Section, StickySample, Choice } from './common'

/**
 * 選んでいる見た目だけの設定(表示スタイルの窓の「スタイル」のタブと、同じ言葉・同じ並び)。値は見た目ごとに別々に覚える
 */
function StyleOptionSection({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const style = effectivePostStyle(s)
  const o = styleOptionsOf(s, style)
  const set = <K extends keyof typeof o>(key: K, value: (typeof o)[K]) => update('styleOptions', withStyleOption(s, style, key, value))
  return (
    <Section title={`${postStyleName(style)}の設定`} note="見た目ごとに別々に覚えます(ほかの見た目に切り替えても、こちらは変わりません)">
      {TREE_STYLES.has(style) && (
        <>
          <Toggle
            checked={o.tree}
            onChange={(v) => set('tree', v)}
            label="ツリー表示"
            note="返信を、最初のアンカー先のレスの下に字下げして並べます。実況モード・レス検索・絞り込みの間は番号の順です"
          />
          {o.tree && <DepthSlider value={o.treeDepth} onChange={(v) => set('treeDepth', v)} fixedSize />}
        </>
      )}
      {QUOTE_STYLE_POSTS.has(style) && (
        <>
          <p className="text-xs text-c-text-muted mb-1.5">返信先の引用</p>
          <div className="max-w-md">
            <Segmented label="返信先の引用" value={o.quote} options={QUOTE_STYLES} onChange={(v) => set('quote', v)} />
          </div>
          <div className="mt-3">
            <Toggle checked={o.groupRuns} onChange={(v) => set('groupRuns', v)} label="続けて書いたレスをまとめる" note="同じ人が続けて書いたレスの、名前とアイコンを省きます" />
          </div>
        </>
      )}
    </Section>
  )
}

/** OS に入っているフォントから選ぶ。各行をそのフォント自体で描くので、見た目を比べられる */
function SystemFontPicker({ value, onPick }: { value: string; onPick: (family: string) => void }) {
  const [fonts, setFonts] = useState<SystemFont[]>()
  const [query, setQuery] = useState('')
  const [japaneseOnly, setJapaneseOnly] = useState(true)
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    loadSystemFonts().then(setFonts, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
  }, [])

  const q = query.trim().toLowerCase()
  const shown = (fonts ?? []).filter(
    (f) =>
      (!japaneseOnly || f.localName) &&
      (!q || f.family.toLowerCase().includes(q) || (f.localName ?? '').toLowerCase().includes(q)),
  )

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="フォント名で絞り込む"
          className={`${INPUT} flex-1`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none whitespace-nowrap">
          <input type="checkbox" checked={japaneseOnly} onChange={(e) => setJapaneseOnly(e.target.checked)} className="rounded" />
          日本語フォントだけ
        </label>
      </div>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="max-h-64 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
        {!fonts && !message && <p className="px-3 py-2 text-sm text-c-text-muted">フォントを探しています...</p>}
        {shown.map((f) => {
          const active = f.family === value
          return (
            <button
              key={f.family}
              type="button"
              onClick={() => onPick(f.family)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-c-surface2 ${active ? 'bg-[var(--c-accent-wash)]' : ''}`}
            >
              <span className="flex-1 min-w-0 truncate text-base text-c-text-body" style={{ fontFamily: `'${f.family}'` }}>
                {f.localName ?? f.family} あア亜 Aa1
              </span>
              <span className="text-xs text-c-text-muted truncate max-w-[40%]">{f.family}</span>
              {active && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
            </button>
          )
        })}
        {fonts && shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}

/** 背景画像の小画面: 画像を選ぶ・濃さ・パネルごとの不透明度(どれも % の数で) */
function BackgroundDialog({ settings: s, update, onClose }: Pick<SettingsProps, 'settings' | 'update'> & { onClose: () => void }) {
  const pct = (v: number) => Math.round(v * 100)
  return (
    <ManagerDialog title="背景画像と透かし" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div
            className="w-28 h-20 flex-shrink-0 rounded-[var(--card-radius)] border border-c-border bg-c-surface2 bg-cover bg-center"
            style={s.backgroundImage ? { backgroundImage: `url("${backgroundImageUrl(s.backgroundImage)}")` } : undefined}
          />
          <div className="flex-1 space-y-2">
            <p className="text-xs text-c-text-muted">パネルの後ろに置きます。選んだ画像はアプリのフォルダにコピーして使います</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={async () => {
                  const file = await pickOpenPath('画像', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
                  if (file) update('backgroundImage', await importBackgroundImage(file))
                }}
              >
                画像を選ぶ
              </button>
              {s.backgroundImage && (
                <button type="button" className="px-3 py-1.5 text-sm text-c-text-muted hover:text-c-text-strong" onClick={() => update('backgroundImage', '')}>
                  外す
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <p className="text-sm text-c-text-body mb-1.5">画像の濃さ</p>
          <NumberField value={pct(s.backgroundOpacity)} min={0} max={100} unit="%" presets={[100, 70, 40, 20]} onChange={(v) => update('backgroundOpacity', v / 100)} />
        </div>
        <div>
          <p className="text-sm text-c-text-body mb-0.5">パネルの不透明度</p>
          <p className="text-xs text-c-text-muted mb-2">
            {s.backgroundImage ? 'どのパネルも同じ割合で、背景色だけを透かします(文字は透けません)。100 で透かさない' : '画像を選ぶと効きます(画像がないときは透かしません)'}
          </p>
          <NumberField
            value={pct(s.panelOpacity)}
            min={0}
            max={100}
            unit="%"
            presets={[100, 80, 60, 40]}
            disabled={!s.backgroundImage}
            onChange={(v) => update('panelOpacity', v / 100)}
          />
        </div>
      </div>
    </ManagerDialog>
  )
}

export function DisplayTab({ settings: s, update, onOpenCustomScheme }: Pick<SettingsProps, 'settings' | 'update'> & { onOpenCustomScheme: () => void }) {
  const [bgOpen, setBgOpen] = useState(false)
  return (
    <>
      <StickySample settings={s} />
      <Section title="カラーテーマ">
        <Toggle
          checked={s.followOsTheme}
          onChange={(v) => update('followOsTheme', v)}
          label="OS のダーク・ライトに合わせる"
          note="オンのときは、暗い配色と明るい配色を 1 つずつ選びます。Windows の設定を切り替えると、その場で切り替わります"
        />
        <Toggle
          checked={s.reduceMotion}
          onChange={(v) => update('reduceMotion', v)}
          label="動きを減らす"
          note="画面の移り方・新着の光り方・数字の繰り上がりを省きます。OS の「アニメーションを表示しない」がオンでも同じになります"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[...COLOR_SCHEMES, ...(parseCustom(s.customScheme) ? [{ key: 'custom' as const, name: '自分の配色', accent: parseCustom(s.customScheme)!.accent, border: 'var(--c-border)' }] : [])].map((c) => {
            const chosen = s.followOsTheme ? c.key === s.darkScheme || c.key === s.lightScheme : s.scheme === c.key
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  for (const [k, v] of Object.entries(pickScheme(s, c.key))) update(k as keyof AppSettings, v as never)
                }}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm border rounded-[var(--card-radius)] transition-colors ${
                  chosen ? 'border-c-accent text-c-text-strong' : 'border-c-border text-c-text-body hover:border-c-border-strong'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.accent, boxShadow: `inset 0 0 0 1px ${c.border}` }} />
                <span className="flex-1 text-left">{c.name}</span>
                {s.followOsTheme && (
                  <span className="text-[10px] text-c-text-muted">
                    {(c.key === 'custom' ? isCustomDark(parseCustom(s.customScheme)!) : isDarkScheme(c.key)) ? 'ダーク' : 'ライト'}
                    {chosen && 'で使う'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="差し色">
        <p className="text-xs text-c-text-muted mb-2">ボタン・選んだ印・タブの下線などの色。どのテーマの上でも読める濃さにしてあります(スマホのアプリ・web と同じ 8 色)</p>
        <div className="flex flex-wrap gap-3">
          {[{ key: '', name: 'テーマの色', color: '' }, ...ACCENTS.map((a) => ({ key: a.key, name: a.name, color: isDarkScheme(effectiveScheme(s)) ? a.dark : a.light }))].map((a) => {
            const on = s.accent === a.key
            return (
              <button key={a.key || 'theme'} type="button" onClick={() => update('accent', a.key)} className="flex flex-col items-center gap-1 min-w-[3rem]">
                <span
                  data-scheme={a.key ? undefined : effectiveScheme(s)}
                  className="w-7 h-7 rounded-full"
                  style={{ background: a.color || 'var(--c-accent)', border: on ? '3px solid var(--c-text-strong)' : '1px solid var(--c-border)' }}
                />
                <span className={`text-xs ${on ? 'text-c-text-strong font-bold' : 'text-c-text-muted'}`}>{a.name}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section advanced title="自分の配色" note="地・面・字・強調・未読・自分の 6 色を選んで、配色を作れます。見本とコントラストの判定を見ながら決められます(スマホのアプリと同じ JSON)">
        <OpenRow label={parseCustom(s.customScheme) ? '自分の配色を直す' : '自分の配色を作る'} value={effectiveScheme(s) === 'custom' ? '使っています' : undefined} onOpen={onOpenCustomScheme} />
      </Section>
      <Section advanced desktopOnly title="フォント" note={FONT_NOTE}>
        <FontRows settings={s} osFont={true} onPick={(key) => update('fontFamily', key)} />
        {s.fontFamily === 'custom' && (
          <SystemFontPicker
            value={s.customFont}
            onPick={(family) => {
              update('customFont', family)
              update('fontFamily', 'custom')
            }}
          />
        )}
        <p className="mt-3 p-3 text-base text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
          あのイーハトーヴォのすきとおった風、0123456789 ABCabc
        </p>
      </Section>
      <Section advanced desktopOnly title="背景画像" note="パネルの後ろに画像を置き、パネルを透かして見せます">
        <OpenRow
          label="背景画像と透かし"
          value={s.backgroundImage ? `画像あり・濃さ ${Math.round(s.backgroundOpacity * 100)}%・パネル ${Math.round(s.panelOpacity * 100)}%` : 'なし'}
          onOpen={() => setBgOpen(true)}
        />
      </Section>
      {bgOpen && <BackgroundDialog settings={s} update={update} onClose={() => setBgOpen(false)} />}
      <Section
        desktopOnly
        title="画面の分け方"
        note="1 画面にすると、スレ一覧とスレ表示のどちらか一方を画面いっぱいに出します。スレを押すとスレ表示に、上の帯の左のボタンで一覧に戻ります"
      >
        <Choice
          value={s.paneMode}
          options={[
            { key: 'auto' as const, name: '自動(狭いときだけ 1 画面)' },
            { key: 'split' as const, name: '2 画面' },
            { key: 'single' as const, name: '1 画面' },
          ]}
          onChange={(v) => update('paneMode', v)}
        />
      </Section>
      <Section title="文字の大きさ">
        {/* 1px ずつ。スレ一覧・レスの本文・頭は、それぞれの ︙ の「文字の大きさ」でさらに変えられる */}
        <BaseFontSlider settings={s} update={update} fixedSize />
      </Section>
      {/* 表示スタイルの窓の「スタイル」のタブと同じ見出し・同じ部品 */}
      <Section
        title="スタイル"
        note={`${POST_STYLES.find((p) => p.key === effectivePostStyle(s))?.note ?? ''}(Discord 風・LINE 風は一覧表示、ほかは高密度で並べます)`}
      >
        <p className="text-xs text-c-text-muted mb-1.5">レスの見た目</p>
        <div className="max-w-md">
          <Segmented label="レスの見た目" value={effectivePostStyle(s)} options={POST_STYLES} onChange={(v) => update('postStyle', v)} />
        </div>
      </Section>
      <StyleOptionSection settings={s} update={update} />
      <Section desktopOnly title="スレのタブ" note="Ctrl+W で閉じる、Ctrl+Tab で切り替え。開いていたタブは次の起動で戻ります">
        <Toggle checked={s.tabsEnabled} onChange={(v) => update('tabsEnabled', v)} label="タブを使う" note="オフにするとタブの帯を出さず、いつも今のスレを置き換えます(開いているスレ以外のタブは閉じます)" />
        {s.tabsEnabled && (
        <Toggle
          checked={s.openInNewTab}
          onChange={(v) => update('openInNewTab', v)}
          label="スレ一覧から開くときは新しいタブで開く"
          note="オフにすると、いま見ているタブを置き換えます。そのときも、Ctrl を押しながらクリックすると新しいタブで開きます"
        />
        )}
      </Section>
    </>
  )
}
