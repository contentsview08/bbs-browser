// 設定の「自分の配色」の画面。スマホのアプリ(ui/CustomScheme.kt の CustomSchemeEditor)と同じ:
// 見本・6 色・読みやすさ(コントラスト比)の判定・「この配色を使う」・JSON をコピー・もとにする配色を選び直す
import { useMemo } from 'react'
import { PICKABLE_SCHEMES, effectiveScheme, isDarkScheme, type AppSettings, type UpdateSetting } from '../../ui/settings'
import { CUSTOM_KEYS, CUSTOM_LABELS, customOf, customToJson, customVars, parseCustom, type CustomDef } from '../../ui/customScheme'

export default function CustomSchemeEditor(props: { settings: AppSettings; update: UpdateSetting }) {
  const { settings: s, update } = props
  const now = effectiveScheme(s)
  // まだ作っていなければ、今の配色(自分の配色でなければ)から 6 色を写して始める
  const def = useMemo(
    () => parseCustom(s.customScheme) ?? customOf(now === 'custom' ? 'soft-dark' : now, now === 'custom' ? true : isDarkScheme(now)),
    // 作っていないときだけ今の配色を見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.customScheme],
  )
  const save = (d: CustomDef) => update('customScheme', customToJson(d))
  const vars = customVars(def)
  const using = s.scheme === 'custom' && !s.followOsTheme
  const BTN = 'px-4 py-2.5 rounded-md text-[14px]'

  return (
    <div className="flex flex-col">
      {/* 見本: 上の帯・スレ一覧の行(読んだ・まだ開いていない)・レス・書き込み欄を、いま作っている色で小さく描く */}
      <div className="m-4 rounded-lg overflow-hidden border border-c-border" style={{ ...(vars as React.CSSProperties), background: 'var(--c-base)' }}>
        <div className="flex items-center px-3 py-2.5" style={{ background: 'var(--c-header-footer)' }}>
          <span className="flex-1 font-bold text-[15px]" style={{ color: 'var(--c-text-strong)' }}>
            ニュー速
          </span>
          <span style={{ color: 'var(--c-text-muted)' }}>︙</span>
        </div>
        <div className="h-px" style={{ background: 'var(--c-border)' }} />
        <div className="flex">
          <span className="w-[3px]" style={{ background: 'var(--c-accent-self)' }} />
          <div className="flex-1 px-3 py-2">
            <div className="text-[14px]" style={{ color: 'var(--c-thread-read-title)' }}>
              読んだスレのスレタイ
            </div>
            <div className="flex items-center">
              <span className="flex-1 text-[11px]" style={{ color: 'var(--c-text-muted)' }}>
                3 時間前
              </span>
              <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}>
                +12
              </span>
            </div>
          </div>
        </div>
        <div className="h-px" style={{ background: 'var(--c-border)' }} />
        <div className="px-[15px] py-2 text-[14px] font-semibold" style={{ color: 'var(--c-text-strong)' }}>
          まだ開いていないスレ
        </div>
        <div className="h-px" style={{ background: 'var(--c-border)' }} />
        <div className="flex" style={{ background: 'var(--c-surface)' }}>
          <span className="w-[3px]" style={{ background: 'var(--c-own)' }} />
          <div className="flex-1 px-3 py-2">
            <div className="text-[12px]">
              <b style={{ color: 'var(--c-text-muted)' }}>12 </b>
              <b style={{ color: 'var(--c-poster-name)' }}> 名無し</b>
              <span className="font-mono text-[11px]" style={{ color: 'var(--c-text-muted)' }}>
                {'  10/31 12:34  ID:AbCd'}
              </span>
            </div>
            <div className="text-[14px]" style={{ color: 'var(--c-link)' }}>
              {'>>10'}
            </div>
            <div className="text-[14px]" style={{ color: 'var(--c-text-body)' }}>
              本文はこの字の色で出ます。
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2" style={{ background: 'var(--c-header-footer)' }}>
          <span className="flex-1 px-3 py-2 rounded-[10px] text-[13px]" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text-muted)' }}>
            書き込む
          </span>
          <span className="w-[34px] h-[34px] rounded-full flex items-center justify-center" style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)' }}>
            <span className="material-symbols-outlined text-[18px]">send</span>
          </span>
        </div>
      </div>

      {/* 6 色。色の札を押すと端末の色選び、右の欄に #RRGGBB を打っても変えられる */}
      <div className="mx-4 rounded-lg overflow-hidden bg-c-surface border border-c-border">
        {CUSTOM_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-3 min-h-[50px] px-3.5 border-b border-c-border last:border-b-0">
            <input
              type="color"
              value={def[k]}
              onChange={(e) => save({ ...def, [k]: e.target.value })}
              className="w-[26px] h-[26px] p-0 rounded-md border border-c-border-strong cursor-pointer"
            />
            <span className="flex-1 text-[15px] text-c-text-strong">{CUSTOM_LABELS[k]}</span>
            <input
              type="text"
              defaultValue={def[k].toUpperCase()}
              key={def[k]}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-f]{6}$/i.test(v)) save({ ...def, [k]: v.toLowerCase() })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              className="w-[6.5em] bg-transparent border-0 p-0 text-right font-mono text-[13px] text-c-text-muted focus:ring-0"
            />
          </label>
        ))}
      </div>

      <div className="flex gap-2 px-4">
        <button
          type="button"
          disabled={using}
          onClick={() => {
            save(def)
            update('followOsTheme', false)
            update('scheme', 'custom')
          }}
          className={`${BTN} font-bold ${using ? 'bg-c-surface2 text-c-text-muted' : 'bg-c-accent text-[var(--c-accent-text)]'}`}
        >
          {using ? '使っています' : 'この配色を使う'}
        </button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(customToJson(def))} className={`${BTN} border border-c-border text-c-text-strong`}>
          JSON をコピー
        </button>
      </div>

      {/* もとにする配色を選び直す(6 色をその配色の色に戻す) */}
      <p className="px-4 pt-4 pb-1.5 text-[12px] text-c-text-muted">もとにする配色を選ぶと、6 色をその配色の色に戻します</p>
      <div className="flex gap-2 px-4 overflow-x-auto no-scrollbar">
        {PICKABLE_SCHEMES.map((c) => (
          <button key={c.key} type="button" onClick={() => save(customOf(c.key, isDarkScheme(c.key)))} className="flex-shrink-0 w-14 flex flex-col items-center">
            <span
              data-scheme={c.key}
              className="w-[34px] h-[34px] rounded-md flex items-center justify-center"
              style={{ background: 'var(--c-base)', border: c.key === def.from ? '2px solid var(--c-accent)' : '1px solid var(--c-border)' }}
            >
              <span className="w-3 h-3 rounded-full" style={{ background: c.accent }} />
            </span>
            <span className="w-14 truncate text-center text-[10px] text-c-text-muted">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
