// 書体を選ぶ行。選んでもすぐ切り替えず、その行に進み具合を出し、取得が終わってから切り替わる
import { FONT_FAMILIES, type AppSettings, type FontFamily } from '../../ui/settings'
import { FONT_DOWNLOADS, cancelFontDownload, chooseFont, useFontStates } from '../../host/fonts'
import { fontNeedsDownload, fontPercent, type FontState } from '../../utils/fontDownload'

function FontRow(props: { name: string; css?: string; chosen: boolean; state: FontState; onPick: () => void; onCancel: () => void }) {
  const { state: st } = props
  const running = st.kind === 'running'
  const percent = running ? fontPercent(st.done, st.total) : undefined
  // 取得が終わるまでは、その書体で描けないし選べない
  const usable = st.kind === 'ready'
  const status =
    st.kind === 'running'
      ? `取得中${percent === undefined ? '' : ` ${percent}%`}。${st.switchTo ? '終わると切り替わります' : 'まだ使えません'}`
      : st.kind === 'none'
        ? '未取得。押すと取得します'
        : undefined
  return (
    <div className={`relative flex items-center gap-2 ${props.chosen ? 'bg-[var(--c-accent-wash)]' : ''}`}>
      <button type="button" disabled={running} onClick={props.onPick} className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left ${running ? 'cursor-default' : 'hover:bg-c-surface2'}`}>
        <span className="flex-1 min-w-0">
          <span className={`block truncate text-sm ${usable ? 'text-c-text-strong' : 'text-c-text-muted'}`} style={usable ? { fontFamily: props.css } : undefined}>
            {props.name}
          </span>
          {status && <span className="block text-xs text-c-text-muted">{status}</span>}
          {st.kind === 'failed' && <span className="block text-xs text-[var(--c-error)]">{st.error}。押すともう一度取得します</span>}
          {running && (
            <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 block h-1 rounded-full overflow-hidden bg-c-surface3">
              <span className={`block h-full rounded-full bg-c-accent ${percent === undefined ? 'animate-pulse w-full' : 'transition-[width] duration-150'}`} style={percent === undefined ? undefined : { width: `${percent}%` }} />
            </span>
          )}
        </span>
        {props.chosen && usable && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
        {!usable && !running && <span className="material-symbols-outlined text-lg text-c-text-muted">download</span>}
      </button>
      {running && (
        <button type="button" onClick={props.onCancel} className="flex-shrink-0 mr-2 px-2 py-1 text-xs rounded border border-c-border text-c-text-muted hover:text-c-text-strong">
          やめる
        </button>
      )}
    </div>
  )
}

export function FontRows(props: { settings: AppSettings; onPick: (key: FontFamily) => void; osFont: boolean }) {
  const { settings: s, onPick } = props
  const states = useFontStates()
  const stateOf = (key: string): FontState => {
    if (!FONT_DOWNLOADS || !fontNeedsDownload(key)) return { kind: 'ready' }
    return states[key] ?? { kind: 'none' }
  }
  return (
    <div className="max-h-80 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
      {FONT_FAMILIES.map((f) => (
        <FontRow
          key={f.key}
          name={f.name}
          css={f.css}
          chosen={s.fontFamily === f.key}
          state={stateOf(f.key)}
          onPick={() => chooseFont(f.key, () => onPick(f.key))}
          onCancel={() => cancelFontDownload(f.key)}
        />
      ))}
      {props.osFont && (
        <FontRow
          name={s.customFont ? `OS のフォント(${s.customFont})` : 'OS のフォント'}
          chosen={s.fontFamily === 'custom'}
          state={stateOf('custom')}
          onPick={() => chooseFont('custom', () => onPick('custom'))}
          onCancel={() => undefined}
        />
      )}
    </div>
  )
}
