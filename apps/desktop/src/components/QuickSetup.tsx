// クイックセットアップ(スマホ版の ui/SetupPanel.kt の写し)。
// 初めて開いたとき(更新のあとの最初の起動も)に、配色 → レスの見た目 → 細かい表示 → ボタンの配置の順に選ぶ。
// どの段でも「スキップ」(×)で飛ばせ、選んだものはその場で効く(設定と同じ値を触るだけなので、あとから設定で変えられる)。
// どの段も一番上に、スレッド表示画面の見本(いまの配置のヘッダー・見本のレス・フッター)を出し、選ぶたびにそこが変わる。
// 設定 → 表示 の一番上「クイックセットアップ」からも開く

import { useState } from 'react'
import { ManagerDialog, SamplePosts, Toggle } from './SettingParts'
import { Choice } from './settings/common'
import { schemeSwatch } from './SkinPicker'
import {
  COLOR_SCHEMES,
  ID_STYLES,
  POST_STYLES,
  effectiveScheme,
  effectivePostStyle,
  pickScheme,
  type AppSettings,
  type ColorScheme,
  type UpdateSetting,
} from '../ui/settings'
import { barActionsFor, resolvePlacements, type BarArea, type BarLayout, type Placement } from '../utils/toolbar'
import { BTN_PRIMARY } from './DialogParts'

const STEPS = ['配色', 'レスの見た目', '細かい表示', 'ボタンの配置']

export function QuickSetupDialog({ settings: s, update, onClose }: { settings: AppSettings; update: UpdateSetting; onClose: () => void }) {
  const [step, setStep] = useState(0)
  /** 段の移る向き(1: 次へ = 右から、-1: 戻る = 左から) */
  const [dir, setDir] = useState<1 | -1>(1)
  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  /** 終えた・飛ばした。次からは出さない */
  const finish = () => {
    update('setupDone', 1)
    onClose()
  }
  const last = step === STEPS.length - 1
  return (
    <ManagerDialog title="クイックセットアップ" onClose={finish} wide closeOnBackdrop={false}>
      {/* 進み具合: 丸と段の名前 */}
      <div className="flex items-center gap-2 mb-3">
        {STEPS.map((name, i) => {
          const on = i === step
          const done = i < step
          return (
            <div key={name} className={`flex items-center gap-2 ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                  on || done ? 'bg-c-accent border-c-accent text-c-accent-text' : 'bg-c-surface2 border-c-border text-c-text-muted'
                }`}
              >
                {done ? <span className="material-symbols-outlined text-[12px] leading-none">check</span> : i + 1}
              </span>
              {on && <span className="text-sm font-bold text-c-text-strong">{name}</span>}
              {i < STEPS.length - 1 && <span className={`flex-1 h-px ${done ? 'bg-c-accent' : 'bg-c-border'}`} />}
            </div>
          )
        })}
        <button type="button" onClick={finish} className="ml-2 text-sm font-bold text-c-accent hover:underline">
          スキップ
        </button>
      </div>
      {/* 段の中身。次へは右から、戻るは左からすべり込む(key で描き直す) */}
      <div key={step} className={dir > 0 ? 'lightbox-slide-in-right' : 'lightbox-slide-in-left'}>
        <ScreenSample settings={s} />
        {step === 0 && <SchemeStep settings={s} update={update} />}
        {step === 1 && <StyleStep settings={s} update={update} />}
        {step === 2 && <DetailStep settings={s} update={update} />}
        {step === 3 && <LayoutStep settings={s} update={update} />}
      </div>
      <div className="flex items-center gap-2 mt-2 pt-3 border-t border-c-border">
        {step > 0 && (
          <button type="button" onClick={() => go(step - 1)} className="px-4 py-2 text-sm text-c-text-muted hover:text-c-text-strong">
            戻る
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => (last ? finish() : go(step + 1))} className={`${BTN_PRIMARY} px-7`}>
          {last ? '完了' : '次へ'}
        </button>
      </div>
    </ManagerDialog>
  )
}

function Lead({ children }: { children: string }) {
  return <p className="text-xs text-c-text-muted mb-3 leading-relaxed">{children}</p>
}

/**
 * スレッド表示画面の見本: いまの配置のヘッダー(題 + ボタン)・見本のレス(普通・自分・自分への返信・人気)・いまの配置のフッター。
 * 配色・レスの見た目・帯・ボタンの配置の、どれを変えてもここに映る(押しても何もしない)
 */
function ScreenSample({ settings: s }: { settings: AppSettings }) {
  const placements = resolvePlacements('thread', s.barLayout)
  const actions = barActionsFor('thread', false)
  const at = (p: Placement) => actions.filter((a) => placements[a.id] === p)
  const icon = (a: { icon: string; name: string }) => (
    <span key={a.name} className="w-8 h-8 flex items-center justify-center text-c-text-muted" title={a.name}>
      <span className="material-symbols-outlined text-[20px] leading-none">{a.icon}</span>
    </span>
  )
  const footer = [...at('footerStart'), ...at('footer')]
  return (
    <div className="mb-4 rounded-[var(--card-radius)] border border-c-border-strong overflow-hidden bg-c-base select-none" aria-hidden>
      <div className="flex items-center h-10 px-2 bg-c-bar border-b border-c-border">
        {at('headerStart').map(icon)}
        <span className="flex-1 px-2 text-sm font-bold text-c-text-strong truncate">スレタイ</span>
        {at('header').map(icon)}
        <span className="w-8 h-8 flex items-center justify-center text-c-text-muted">
          <span className="material-symbols-outlined text-[20px] leading-none">more_vert</span>
        </span>
      </div>
      {/* 見本のレス(題は出さない。枠はこの入れ物の方で) */}
      <div className="[&>div]:mb-0 [&>div>div]:rounded-none [&>div>div]:border-0">
        <SamplePosts settings={s} title="" />
      </div>
      {footer.length > 0 && (
        <div className="flex items-center justify-end h-10 px-2 bg-c-bar border-t border-c-border">{footer.map(icon)}</div>
      )}
    </div>
  )
}

/** 選択肢の札(名前・説明・選んだ印) */
function ChoiceCard({ name, note, on, onClick }: { name: string; note: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left ${on ? 'border-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border hover:border-c-border-strong'}`}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-c-text-strong">{name}</span>
        {note && <span className="block text-xs text-c-text-muted mt-0.5">{note}</span>}
      </span>
      <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${on ? 'bg-c-accent border-c-accent' : 'bg-c-surface2 border-c-border'}`}>
        {on && <span className="material-symbols-outlined text-[14px] leading-none text-c-accent-text">check</span>}
      </span>
    </button>
  )
}

function SchemeStep({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  const current = effectiveScheme(s)
  const pick = (key: ColorScheme) => {
    for (const [k, v] of Object.entries(pickScheme(s, key))) update(k as keyof AppSettings, v as never)
    if (s.lookThemeKey) update('lookThemeKey', '')
  }
  return (
    <>
      <Lead>配色を選んでください。見本がその場で変わります。あとから「設定 → 表示」で、スキンも含めて変えられます</Lead>
      <div className="mb-4">
        <Toggle checked={s.followOsTheme} onChange={(v) => update('followOsTheme', v)} label="OS のダーク・ライトに合わせる" note="暗い配色と明るい配色を 1 つずつ選びます" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
        {COLOR_SCHEMES.map((sc) => {
          const sw = schemeSwatch(sc.key)
          const on = sc.key === current
          return (
            <button
              key={sc.key}
              type="button"
              onClick={() => pick(sc.key)}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border ${on ? 'border-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border hover:border-c-border-strong'}`}
            >
              {/* 丸の中に、その配色の地・面・差し色 */}
              <span className="relative w-11 h-11 rounded-full overflow-hidden border" style={{ background: sw[0], borderColor: sc.border }}>
                <span className="absolute inset-x-0 top-0 h-3" style={{ background: sw[1] }} />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-1 rounded" style={{ background: sw[4], opacity: 0.7 }} />
                <span className="absolute left-1/2 bottom-1.5 -translate-x-1/2 w-2.5 h-2.5 rounded-full" style={{ background: sw[2] }} />
              </span>
              <span className={`text-xs text-center leading-tight ${on ? 'text-c-text-strong font-bold' : 'text-c-text-muted'}`}>{sc.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function StyleStep({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  const cur = effectivePostStyle(s)
  return (
    <>
      <Lead>レスの見た目を選んでください。細かい設定は、あとから「設定 → 表示」と「設定 → レス表示」で</Lead>
      <div className="flex flex-col gap-2">
        {POST_STYLES.map((p) => (
          <ChoiceCard key={p.key} name={p.name} note={p.note} on={cur === p.key} onClick={() => update('postStyle', p.key)} />
        ))}
      </div>
    </>
  )
}

function DetailStep({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  const label = (t: string) => <p className="text-xs font-bold text-c-text-muted mt-3 mb-1.5">{t}</p>
  return (
    <>
      <Lead>細かい表示です。名前・ID・日時の出し方、人気のレスと自分の書き込みの帯などを選んでください。あとからでも「設定 → レス表示」で変えられます</Lead>
      <div className="flex flex-col gap-2">
        <Toggle checked={s.omitNoname} onChange={(v) => update('omitNoname', v)} label="名無しの名前を省く" />
        <Toggle checked={s.nameSubtle} onChange={(v) => update('nameSubtle', v)} label="名前欄を薄く" />
        <Toggle checked={s.idShort} onChange={(v) => update('idShort', v)} label="ID を短く" />
        <Toggle checked={s.highlightOp} onChange={(v) => update('highlightOp', v)} label="スレ主の印" />
        <Toggle checked={s.urlShorten} onChange={(v) => update('urlShorten', v)} label="URL を短く" />
      </div>
      {label('ID の見せ方')}
      <Choice value={s.idStyle} options={ID_STYLES.map((o) => ({ key: o.key, name: o.name }))} onChange={(v) => update('idStyle', v)} />
      {label('日時の出し方')}
      <Choice
        value={s.dateStyle}
        options={[
          { key: 'md_w_hms' as const, name: '11/02(月) 19:01:15' },
          { key: 'md_hm' as const, name: '11/02 19:01' },
          { key: 'full' as const, name: '2026/11/02(月) 19:01:15.032' },
        ]}
        onChange={(v) => update('dateStyle', v)}
      />
      {label('人気のレスの示し方(返信が 3 件から)')}
      <Choice
        value={s.heatStyle}
        options={[
          { key: 'left' as const, name: '左の帯' },
          { key: 'right' as const, name: '右の帯' },
          { key: 'text' as const, name: '本文の色' },
        ]}
        onChange={(v) => update('heatStyle', v)}
      />
      {label('自分の書き込みの帯(人気と同じ側なら自分が勝つ)')}
      <Choice
        value={s.ownStyle}
        options={[
          { key: 'left' as const, name: '左の帯' },
          { key: 'right' as const, name: '右の帯' },
        ]}
        onChange={(v) => update('ownStyle', v)}
      />
    </>
  )
}

/** ボタンの配置の候補(スレ表示とスレ一覧の置き場所。書いていないボタンは既定のまま) */
interface LayoutPreset {
  key: string
  name: string
  desc: string
  thread: Record<string, Placement>
  list: Record<string, Placement>
}
const LAYOUT_PRESETS: LayoutPreset[] = [
  { key: 'standard', name: '標準', desc: 'ヘッダーの右に検索・お気に入り・書き込み欄・ログ削除・更新。スレ一覧は右下に更新', thread: {}, list: {} },
  {
    key: 'lean',
    name: 'すっきり',
    desc: 'ヘッダーには検索と更新だけ。ほかは ︙ の中に',
    thread: { favorite: 'menu', replyLayout: 'menu', delete: 'menu' },
    list: { newThread: 'menu', style: 'menu' },
  },
  {
    key: 'rich',
    name: 'ボタンを多めに',
    desc: '板に戻る・次スレ・画像一覧・実況もヘッダーに',
    thread: { openBoard: 'header', findNext: 'header', gallery: 'header', autoScroll: 'header' },
    list: { fontSize: 'header' },
  },
  {
    key: 'bottom',
    name: '下にまとめる',
    desc: 'ヘッダーは題だけ。ボタンは全部フッターに',
    thread: { search: 'footer', favorite: 'footer', replyToggle: 'footer', replyLayout: 'footer', delete: 'footer', refresh: 'footer' },
    list: { search: 'footer', newThread: 'footer', favorite: 'footer', style: 'footer' },
  },
]

/** いまの置き場所がどの候補と同じか。どれとも違えば undefined */
function currentPreset(s: AppSettings): string | undefined {
  const same = (area: BarArea, preset: Record<string, Placement>) => {
    const cur = resolvePlacements(area, s.barLayout)
    const want = resolvePlacements(area, { [area]: preset } as BarLayout)
    return Object.keys(want).every((id) => cur[id] === want[id])
  }
  return LAYOUT_PRESETS.find((p) => same('thread', p.thread) && same('list', p.list))?.key
}

function LayoutStep({ settings: s, update }: { settings: AppSettings; update: UpdateSetting }) {
  const cur = currentPreset(s)
  const apply = (p: LayoutPreset) => {
    update('barLayout', { thread: p.thread, list: p.list })
    update('barOrder', {})
  }
  return (
    <>
      <Lead>ヘッダー・フッターのボタンの置き方を選んでください。上の見本のヘッダーとフッターが変わります。1 つずつの並びは、あとから「設定 → ボタンの配置」で動かせます</Lead>
      <div className="flex flex-col gap-2">
        {LAYOUT_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => apply(p)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left ${cur === p.key ? 'border-c-accent bg-[var(--c-accent-wash)]' : 'border-c-border hover:border-c-border-strong'}`}
          >
            <MiniScreen area="thread" preset={p.thread} />
            <MiniScreen area="list" preset={p.list} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-c-text-strong">{p.name}</span>
              <span className="block text-xs text-c-text-muted mt-0.5">{p.desc}</span>
            </span>
            <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${cur === p.key ? 'bg-c-accent border-c-accent' : 'bg-c-surface2 border-c-border'}`}>
              {cur === p.key && <span className="material-symbols-outlined text-[14px] leading-none text-c-accent-text">check</span>}
            </span>
          </button>
        ))}
      </div>
      {!cur && <p className="mt-2 text-xs text-c-text-muted">いまは自分で並べた配置です(どれかを選ぶと置き換わります)</p>}
    </>
  )
}

/** 画面の小さな見本(上の帯・行・下の帯)。候補の置き場所のアイコンを小さく並べる */
function MiniScreen({ area, preset }: { area: BarArea; preset: Record<string, Placement> }) {
  const placements = resolvePlacements(area, { [area]: preset } as BarLayout)
  const actions = barActionsFor(area, false)
  const at = (p: Placement) => actions.filter((a) => placements[a.id] === p)
  const bar = (left: { icon: string }[], right: { icon: string }[]) => (
    <span className="flex items-center h-4 px-1 bg-c-bar gap-0.5">
      {left.map((a, i) => (
        <span key={i} className="material-symbols-outlined text-[9px] leading-none text-c-text-muted">
          {a.icon}
        </span>
      ))}
      <span className="flex-1" />
      {right.map((a, i) => (
        <span key={i} className="material-symbols-outlined text-[9px] leading-none text-c-text-muted">
          {a.icon}
        </span>
      ))}
    </span>
  )
  return (
    <span className="flex-shrink-0 w-[4.5rem] flex flex-col rounded border border-c-border-strong bg-c-base overflow-hidden">
      {bar(at('headerStart'), at('header'))}
      <span className="flex flex-col gap-1 p-1.5 h-10">
        {[0.9, 0.6, 0.75].map((w) => (
          <span key={w} className="block h-1 rounded-full bg-c-surface2" style={{ width: `${w * 100}%` }} />
        ))}
      </span>
      {bar(at('footerStart'), at('footer'))}
    </span>
  )
}
