import { ListEditor } from '../SettingParts'
import { type SettingsProps, Section, OrderEditor } from './common'

/** 操作バーに並べられるもの(定型文はこのほかに 1 つずつ) */
const TOOLBAR_ITEMS: { key: string; name: string; icon: string }[] = [
  { key: 'reply', name: '返信', icon: 'reply' },
  { key: 'copy', name: 'コピー', icon: 'content_copy' },
  { key: 'ng', name: 'NG に追加', icon: 'block' },
  { key: 'tree', name: 'アンカーツリー', icon: 'account_tree' },
]

export function WriteTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const all = [
    ...TOOLBAR_ITEMS,
    ...s.quickPhrases.map((p) => ({ key: `phrase:${p}`, name: `定型文「${p}」`, icon: 'bolt' })),
  ]
  return (
    <>
      <Section title="定型文" note="レスの操作バーや ⋯ から、そのレスへのアンカーを付けて、押すとすぐ書き込みます">
        <ListEditor
          noun="定型文"
          sortable
          items={s.quickPhrases}
          onChange={(v) => {
            update('quickPhrases', v)
            // 消した定型文は、操作バーからも外す
            update('postToolbar', s.postToolbar.filter((x) => !x.startsWith('phrase:') || v.includes(x.slice('phrase:'.length))))
          }}
          onRename={(from, to) => update('postToolbar', s.postToolbar.map((x) => (x === `phrase:${from}` ? `phrase:${to}` : x)))}
          placeholder="例: ワロタ"
        />
      </Section>

      <Section advanced desktopOnly title="レスの操作バー" note="レスにマウスを乗せたとき、右上に出すボタンです。上から順に左から並びます(⋯ はいつも一番右)">
        <OrderEditor all={all} value={s.postToolbar} onChange={(v) => update('postToolbar', v)} restTitle="出していないボタン" />
      </Section>

    </>
  )
}
