// 設定の「キー操作」とマウスジェスチャー。

import { useEffect, useState } from 'react'
import { normalizeForSearch } from '../../utils/postBody'
import { DEFAULT_SETTINGS, MOUSE_GESTURE_TRIGGERS } from '../../ui/settings'
import { Toggle } from '../SettingParts'
import { ICON_BTN, INPUT } from '../DialogParts'
import { MOUSE_LIST_ACTIONS, MOUSE_OPEN_ACTIONS, boardAction, mouseActionName } from '../../utils/gestures'
import { PIE_DIRS, PIE_DIR_NAMES, type PieDir } from '../../hooks/useMouseGesture'
import MouseGesturePie from '../MouseGesturePie'
import { DEFAULT_KEYMAP, FIXED_KEYS, KEY_ACTIONS, keyLabel, keyString, reservedKeyName, resolveKeymap, setActionKeys, type KeyAction, type Keymap } from '../../utils/keymap'
import { type SettingsProps, Section, Choice } from './common'
import { SearchInput } from '../ClearButton'

/**
 * PC: マウスジェスチャー(円盤)。8 方向それぞれに操作を割り当てる。左の円盤の区画を押すと、その方向の行が選ばれる。
 * 操作はキー操作すべてと、画面を開く操作(設定・履歴など)
 */
function MouseGestureSettings({ settings: s, update, favorites }: Pick<SettingsProps, 'settings' | 'update' | 'favorites'>) {
  const map = s.mouseGestures
  const [picked, setPicked] = useState<PieDir>('n')
  // お気に入り板は別名(boardMeta の alias)があればその名前で
  const favs = favorites.map((b) => ({ url: b.url, name: s.boardMeta[b.url]?.alias || b.name }))
  const labels = Object.fromEntries(PIE_DIRS.map((d) => [d, map[d] ? mouseActionName(map[d], favs) : undefined])) as Partial<Record<PieDir, string | undefined>>
  const groups: { name: string; items: { key: string; name: string }[] }[] = [
    { name: 'キー操作と同じ', items: KEY_ACTIONS },
    { name: '画面を開く', items: MOUSE_OPEN_ACTIONS },
    { name: 'スレ一覧のタブ', items: MOUSE_LIST_ACTIONS },
    { name: 'お気に入り板を開く', items: favs.map((b) => ({ key: boardAction(b.url), name: b.name })) },
  ]
  const setDir = (d: PieDir, action: string) => {
    const next = { ...map }
    if (action) next[d] = action
    else delete next[d]
    update('mouseGestures', next)
  }
  return (
    <Section
      title="マウスジェスチャー"
      note="Ctrl(または右ボタン)を押しながらマウスを少し動かすと、そこを中心に 8 方向の円盤が出ます。向けた区画の操作が、離したときに実行されます(中心に戻して離せば何もしません)。操作はキー操作と同じで、キーを受け取っている方に効きます"
    >
      <Toggle checked={s.mouseGestureEnabled} onChange={(v) => update('mouseGestureEnabled', v)} label="マウスジェスチャーを使う" />
      {s.mouseGestureEnabled && (
      <>
      <div className="mb-3 flex items-center gap-3 text-sm">
        <span className="text-c-text-body">始め方</span>
        <Choice value={s.mouseGestureTrigger} options={MOUSE_GESTURE_TRIGGERS} onChange={(v) => update('mouseGestureTrigger', v)} />
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <MouseGesturePie labels={labels} active={picked} onPick={setPicked} className="flex-shrink-0" />
        <div className="flex-1 min-w-[18rem] flex flex-col divide-y divide-c-border/60">
          {PIE_DIRS.map((d) => (
            <label
              key={d}
              className={`flex items-center gap-3 py-1.5 px-2 -mx-2 rounded text-sm cursor-pointer ${picked === d ? 'bg-[var(--c-accent-wash)]' : ''}`}
              onClick={() => setPicked(d)}
            >
              <span className={`w-10 flex-shrink-0 ${picked === d ? 'text-c-accent font-bold' : 'text-c-text-strong'}`}>{PIE_DIR_NAMES[d]}</span>
              <select value={map[d] ?? ''} onChange={(e) => setDir(d, e.target.value)} onFocus={() => setPicked(d)} className={`${INPUT} flex-1 min-w-0`}>
                <option value="">なし</option>
                {groups.map((g) => (
                  <optgroup key={g.name} label={g.name}>
                    {g.items.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => update('mouseGestures', DEFAULT_SETTINGS.mouseGestures)} className="mt-3 text-xs text-c-text-muted hover:text-c-accent underline">
        すべて既定に戻す
      </button>
      </>
      )}
    </Section>
  )
}

/**
 * キー操作の割り当て(管理画面)。操作の名前・キーで探す、変えたもの・キーのないものだけを出す、押したキーから操作を探す。
 * 同じキーをほかの操作に使っていたら、そちらから外して付け替える(すぐ「元に戻す」で戻せる)。
 * 決め打ちのキー(Esc・Ctrl+W など)には割り当てない
 */
export function KeysTab({ settings: s, update, favorites }: Pick<SettingsProps, 'settings' | 'update' | 'favorites'>) {
  const keymap = resolveKeymap(s.keymap)
  /** キーを待っている操作('find' は押したキーから操作を探す) */
  const [waiting, setWaiting] = useState<KeyAction | 'find'>()
  /** 直前の変更の知らせと、その前の割り当て(元に戻す用) */
  const [notice, setNotice] = useState<{ text: string; before?: Partial<Keymap> }>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'changed' | 'empty'>('all')
  const [found, setFound] = useState<string>()

  const save = (next: Keymap) => {
    // 既定と同じものは保存しない(あとで既定が変わったときに追いつけるように)
    const changed: Partial<Keymap> = {}
    for (const { key } of KEY_ACTIONS) if (next[key].join('\n') !== DEFAULT_KEYMAP[key].join('\n')) changed[key] = next[key]
    update('keymap', changed)
  }
  const isChanged = (a: KeyAction) => keymap[a].join('\n') !== DEFAULT_KEYMAP[a].join('\n')

  useEffect(() => {
    if (!waiting) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setWaiting(undefined)
      const k = keyString(e)
      if (!k) return
      if (waiting === 'find') {
        setFound(k)
        setQuery('')
        setFilter('all')
        setWaiting(undefined)
        return
      }
      const reserved = reservedKeyName(k)
      if (reserved) {
        setNotice({ text: `${keyLabel(k)} は「${reserved}」に決まっているので、割り当てられません` })
        setWaiting(undefined)
        return
      }
      const from = KEY_ACTIONS.filter(({ key }) => key !== waiting && keymap[key].includes(k))
      setNotice({
        text:
          from.length > 0
            ? `${keyLabel(k)} は「${from.map((a) => a.name).join('」「')}」から外して、「${KEY_ACTIONS.find((a) => a.key === waiting)!.name}」に付け替えました`
            : `${keyLabel(k)} を「${KEY_ACTIONS.find((a) => a.key === waiting)!.name}」に割り当てました`,
        before: s.keymap,
      })
      save(setActionKeys(keymap, waiting, [...keymap[waiting].filter((x) => x !== k), k]))
      setWaiting(undefined)
    }
    // 開いているスレのキー操作より先に受け取る
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [waiting, keymap])

  const q = normalizeForSearch(query.trim())
  const rows = KEY_ACTIONS.filter(
    (a) =>
      (filter === 'all' || (filter === 'changed' ? isChanged(a.key) : keymap[a.key].length === 0)) &&
      (!found || keymap[a.key].includes(found)) &&
      (!q || normalizeForSearch(a.name).includes(q) || keymap[a.key].some((k) => normalizeForSearch(keyLabel(k)).includes(q))),
  )
  const changedCount = KEY_ACTIONS.filter((a) => isChanged(a.key)).length

  return (
    <>
      <Section
        title="キーの割り当て"
        note="キーを受け取っている方(2 画面なら上に線が出ている方。既定では Ctrl+E で入れ替え)で効きます。入力欄の中では Ctrl・Alt 付きのキーと F キーだけ効きます(文字の編集と日本語入力のキー(Ctrl+A・Ctrl+Z・Ctrl+T・F6〜F10 など)と、変換中のキーは除く)。「+」を押してから、割り当てたいキーを押してください(Esc でやめる)"
      >
        {notice && (
          <p className="mb-3 px-3 py-2 text-xs rounded-lg border border-c-border bg-c-surface2 text-c-text-body flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-c-accent">swap_horiz</span>
            <span className="flex-1">{notice.text}</span>
            {notice.before !== undefined && (
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-c-border hover:border-c-accent hover:text-c-accent"
                onClick={() => {
                  update('keymap', notice.before!)
                  setNotice(undefined)
                }}
              >
                元に戻す
              </button>
            )}
            <button type="button" onClick={() => setNotice(undefined)} className="p-0.5 rounded-full hover:bg-c-surface3" title="閉じる">
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SearchInput
            type="search"
            value={query}
            onValue={(v) => {
              setQuery(v)
              setFound(undefined)
            }}
            placeholder="操作の名前・キーで探す"
            wrapClassName="flex-1 min-w-48"
            className={`${INPUT} w-full`}
          />
          <button
            type="button"
            onClick={() => setWaiting(waiting === 'find' ? undefined : 'find')}
            className={`px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border ${waiting === 'find' ? 'border-c-accent text-c-accent animate-pulse' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`}
          >
            {waiting === 'find' ? 'キーを押してください' : '押したキーで探す'}
          </button>
          <Choice
            value={filter}
            options={[
              { key: 'all' as const, name: `すべて(${KEY_ACTIONS.length})` },
              { key: 'changed' as const, name: `変えたもの(${changedCount})` },
              { key: 'empty' as const, name: 'キーのないもの' },
            ]}
            onChange={(v) => setFilter(v)}
          />
        </div>
        {found && (
          <p className="mb-2 text-xs text-c-text-body flex items-center gap-2">
            {keyLabel(found)} の割り当て: {rows.length > 0 ? rows.map((a) => `「${a.name}」`).join('') : reservedKeyName(found) ? `決まっているキー(${reservedKeyName(found)})` : 'なし'}
            <button type="button" className="text-c-text-muted hover:text-c-accent underline" onClick={() => setFound(undefined)}>
              解除
            </button>
          </p>
        )}
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {(['view', 'app'] as const).map((where) => {
            const list = rows.filter((a) => a.where === where)
            if (list.length === 0) return null
            return (
              <div key={where}>
                <p className="px-3 py-1.5 text-[11px] font-bold text-c-text-muted bg-c-surface2">
                  {where === 'view' ? 'スレ表示・スレ一覧(キーを受け取っている方)' : 'アプリ全体(どちらを触っていても)'}
                </p>
                {list.map(({ key, name }) => (
                  <div key={key} className="flex items-center gap-3 px-3 py-2 border-t border-c-border">
                    <span className="w-64 flex-shrink-0 text-sm text-c-text-body">
                      {name}
                      {isChanged(key) && <span className="ml-1.5 text-[10px] px-1 rounded border border-c-accent text-c-accent">変更</span>}
                    </span>
                    <div className="flex-1 flex flex-wrap items-center gap-1.5">
                      {keymap[key].map((k) => (
                        <span key={k} className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 text-xs font-mono rounded border border-c-border bg-c-surface2 text-c-text-strong">
                          {keyLabel(k)}
                          <button
                            type="button"
                            className={ICON_BTN}
                            title="外す"
                            onClick={() => {
                              setNotice({ text: `${keyLabel(k)} を「${name}」から外しました`, before: s.keymap })
                              save({ ...keymap, [key]: keymap[key].filter((x) => x !== k) })
                            }}
                          >
                            <span className="material-symbols-outlined text-sm leading-none">close</span>
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setWaiting(waiting === key ? undefined : key)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          waiting === key ? 'border-c-accent text-c-accent animate-pulse' : 'border-dashed border-c-border text-c-text-muted hover:text-c-text-strong'
                        }`}
                      >
                        {waiting === key ? 'キーを押してください' : '+'}
                      </button>
                    </div>
                    {isChanged(key) && (
                      <button
                        type="button"
                        className={ICON_BTN}
                        title={`既定(${DEFAULT_KEYMAP[key].map(keyLabel).join('・') || 'なし'})に戻す`}
                        onClick={() => {
                          const from = KEY_ACTIONS.filter((a) => a.key !== key && keymap[a.key].some((x) => DEFAULT_KEYMAP[key].includes(x)))
                          setNotice({
                            text: `「${name}」を既定に戻しました${from.length > 0 ? `(同じキーは「${from.map((a) => a.name).join('」「')}」から外しました)` : ''}`,
                            before: s.keymap,
                          })
                          save(setActionKeys(keymap, key, DEFAULT_KEYMAP[key]))
                        }}
                      >
                        <span className="material-symbols-outlined text-base">restart_alt</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
          {rows.length === 0 && <p className="px-3 py-3 text-sm text-c-text-muted">見つかりません</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice({ text: 'すべて既定に戻しました', before: s.keymap })
            update('keymap', {})
          }}
          className="mt-3 text-xs text-c-text-muted hover:text-c-accent underline"
        >
          すべて既定に戻す
        </button>
      </Section>
      <MouseGestureSettings settings={s} update={update} favorites={favorites} />
      <Section title="決まっているキー" note="ここは変えられません(? キーの一覧にも出ます)">
        <ul className="text-sm text-c-text-body space-y-1">
          {FIXED_KEYS.map((f) => (
            <li key={f.keys}>
              <span className="font-mono text-xs">{f.keys}</span> … {f.name}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
