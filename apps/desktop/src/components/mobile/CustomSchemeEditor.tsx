// 設定の「自分の配色」の画面。スマホのアプリ(ui/CustomScheme.kt の CustomSchemeEditor)と同じ:
// 見本・6 色・細かい色・読みやすさ(コントラスト比)の判定・「この配色を使う」・JSON をコピー・JSON を貼り付け・もとにする配色を選び直す
import { useMemo, useRef, useState } from 'react'
import { COLOR_SCHEMES, accentKeyOf, effectiveScheme, isDarkScheme, type AppSettings, type UpdateSetting } from '../../ui/settings'
import { CUSTOM_KEYS, CUSTOM_LABELS, EXTRA_COLORS, customOf, customToJson, customVars, extraCount, extraValues, parseCustom, type CustomDef, type ExtraColors, type ExtraKey } from '../../ui/customScheme'

/** 色選びで動かし終えてから、設定に書くまで待つ時間 */
const COLOR_COMMIT_MS = 150

export default function CustomSchemeEditor(props: {
  settings: AppSettings
  update: UpdateSetting
  /** スクロールしても見本を上に残す(PC。色を変えながら見るため) */
  stickySample?: boolean
}) {
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
  // 色選びの中でつまみを動かしている間は、動くたびに色の値が来る。そのたびに設定へ書くとアプリ全体が描き直されるので、
  // ここで持って見本だけを変え、少し止まってから書く
  const [draft, setDraft] = useState<Partial<CustomDef>>({})
  const [extraDraft, setExtraDraft] = useState<ExtraColors>({})
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commitLater = (next: Partial<CustomDef>, nextExtra: ExtraColors) => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      setDraft({})
      setExtraDraft({})
      save({ ...def, ...next, colors: { ...def.colors, ...nextExtra } })
    }, COLOR_COMMIT_MS)
  }
  const pick = (k: keyof CustomDef, v: string) => {
    const next = { ...draft, [k]: v }
    setDraft(next)
    commitLater(next, extraDraft)
  }
  const pickExtra = (k: ExtraKey, v: string) => {
    const next = { ...extraDraft, [k]: v }
    setExtraDraft(next)
    commitLater(draft, next)
  }
  /** 細かい色を選び直す前に戻す */
  const resetExtra = (k: ExtraKey) => {
    const colors = { ...def.colors }
    delete colors[k]
    save({ ...def, colors: Object.keys(colors).length ? colors : undefined })
  }
  const shown: CustomDef = { ...def, ...draft, colors: { ...def.colors, ...extraDraft } }
  const extras = useMemo(() => extraValues(shown), [shown])
  const [moreOpen, setMoreOpen] = useState(extraCount(def) > 0)
  /** コピー・貼り付けの結果 */
  const [notice, setNotice] = useState<string>()
  // 別の端末・別のアプリで「JSON をコピー」したものを取り込む
  const paste = async () => {
    const got = parseCustom((await navigator.clipboard.readText().catch(() => '')).trim())
    if (got) {
      save(got)
      // 一緒に書き出した差し色も戻す(なければテーマの色。差し色が残ると、取り込んだ「強調」の色が隠れる)
      update('accent', accentKeyOf(got.accentPick))
    }
    setNotice(got ? '配色を取り込みました' : 'クリップボードに配色の JSON がありません')
  }
  const vars = customVars(shown)
  const using = s.scheme === 'custom' && !s.followOsTheme
  const BTN = 'px-4 py-2.5 rounded-md text-[14px]'

  return (
    <div className="flex flex-col">
      {/* 見本: 上の帯・スレ一覧の行(読んだ・まだ開いていない)・レス・書き込み欄を、いま作っている色で小さく描く */}
      <div className={`m-4 rounded-lg overflow-hidden border border-c-border ${props.stickySample ? '[@media(min-height:640px)]:sticky [@media(min-height:640px)]:-top-5 z-10' : ''}`} style={{ ...(vars as React.CSSProperties), background: 'var(--c-base)' }}>
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
              value={shown[k]}
              onChange={(e) => pick(k, e.target.value)}
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

      {/* 細かい色(帯・線・字・印・人気・LINE 風 …)。選んでいなければ 6 色から作った値。ふだんは畳んでおく(選んでいれば開いておく) */}
      <button type="button" onClick={() => setMoreOpen(!moreOpen)} className="mx-4 mt-3 flex items-center gap-2 py-2 text-left">
        <span className="flex-1 text-[15px] font-medium text-c-text-strong">細かい色</span>
        {extraCount(def) > 0 && <span className="text-[12px] text-c-text-muted">{extraCount(def)} 色を選んでいます</span>}
        <span className="material-symbols-outlined text-[22px] text-c-text-muted">{moreOpen ? 'expand_less' : 'expand_more'}</span>
      </button>
      {moreOpen && (
        <>
          <p className="px-4 pb-1 text-[12px] text-c-text-muted">選んでいない色は、6 色から作った色(人気・印などは配色の決まりの色)です。選んだ色は「戻す」で元に戻せます</p>
          {[...new Set(EXTRA_COLORS.map((e) => e.group))].map((g) => (
            <div key={g}>
              <p className="px-4 pt-2.5 pb-1 text-[12px] font-bold text-c-text-muted">{g}</p>
              <div className="mx-4 rounded-lg overflow-hidden bg-c-surface border border-c-border">
                {EXTRA_COLORS.filter((e) => e.group === g).map((e) => {
                  const val = extras[e.key]
                  const picked = !!def.colors?.[e.key]
                  return (
                    <label key={e.key} className="flex items-center gap-3 min-h-[46px] pl-3.5 pr-1.5 border-b border-c-border last:border-b-0">
                      <input
                        type="color"
                        value={val}
                        onChange={(ev) => pickExtra(e.key, ev.target.value)}
                        className="w-[22px] h-[22px] p-0 rounded-md border border-c-border-strong cursor-pointer"
                      />
                      <span className={`flex-1 text-[14px] ${picked ? 'text-c-text-strong' : 'text-c-text-body'}`}>{e.label}</span>
                      <input
                        type="text"
                        defaultValue={val.toUpperCase()}
                        key={val}
                        onBlur={(ev) => {
                          const v = ev.target.value.trim()
                          if (/^#[0-9a-f]{6}$/i.test(v)) save({ ...def, colors: { ...def.colors, [e.key]: v.toLowerCase() } })
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') ev.currentTarget.blur()
                        }}
                        className="w-[6.5em] bg-transparent border-0 p-0 text-right font-mono text-[12px] text-c-text-muted focus:ring-0"
                      />
                      {picked ? (
                        <button type="button" onClick={() => resetExtra(e.key)} className="px-2 py-2 text-[12px] font-bold text-c-accent">
                          戻す
                        </button>
                      ) : (
                        <span className="w-[2.9em]" />
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="flex flex-wrap gap-2 px-4 pt-4">
        <button
          type="button"
          disabled={using}
          onClick={() => {
            save(def)
            update('followOsTheme', false)
            update('scheme', 'custom')
            // 自分の配色の「強調」が差し色の役目をするので、別に選んだ差し色は外す
            update('accent', '')
          }}
          className={`${BTN} font-bold ${using ? 'bg-c-surface2 text-c-text-muted' : 'bg-c-accent text-[var(--c-accent-text)]'}`}
        >
          {using ? '使っています' : 'この配色を使う'}
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(customToJson(def, s.accent)).then(() => setNotice('JSON をコピーしました'))}
          className={`${BTN} border border-c-border text-c-text-strong`}
        >
          JSON をコピー
        </button>
        <button type="button" onClick={() => void paste()} className={`${BTN} border border-c-border text-c-text-strong`}>
          JSON を貼り付け
        </button>
      </div>
      {notice && <p className="px-4 pt-2 text-[12px] text-c-text-muted">{notice}</p>}
      {s.accent && (
        <p className="px-4 pt-2 text-[12px] text-c-heat-very-hot">
          差し色を選んでいるので、アプリでは「強調」の代わりに差し色が使われます。
          <button type="button" className="ml-1 underline" onClick={() => update('accent', '')}>
            差し色をテーマの色に戻す
          </button>
        </p>
      )}

      <p className="px-4 pt-4 pb-1.5 text-[12px] text-c-text-muted">もとにする配色を選ぶと、6 色をその配色の色に戻します(細かい色はそのまま)</p>
      <div className="flex gap-2 px-4 overflow-x-auto no-scrollbar">
        {COLOR_SCHEMES.map((c) => (
          <button key={c.key} type="button" onClick={() => save({ ...customOf(c.key, isDarkScheme(c.key)), colors: def.colors })} className="flex-shrink-0 w-14 flex flex-col items-center">
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
