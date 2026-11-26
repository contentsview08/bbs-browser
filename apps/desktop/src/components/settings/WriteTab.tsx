import { ListEditor } from '../SettingParts'
import { type SettingsProps, Section, OrderEditor } from './common'

/** 操作バーに並べられるもの(定型文はこのほかに 1 つずつ) */
const TOOLBAR_ITEMS: { key: string; name: string; icon: string }[] = [
  { key: 'reply', name: '返信', icon: 'reply' },
  { key: 'copy', name: '本文のみコピー', icon: 'content_paste' },
  { key: 'copyHeader', name: 'ヘッダ含めてコピー', icon: 'content_copy' },
  { key: 'ng', name: 'NG に追加', icon: 'block' },
  { key: 'tree', name: 'アンカーツリー', icon: 'account_tree' },
  { key: 'share', name: '共有', icon: 'share' },
  { key: 'aa', name: 'AA として表示 / 文字列として表示', icon: 'grid_on' },
  { key: 'markOwn', name: '自分のレスの印を付ける / 外す', icon: 'how_to_reg' },
  { key: 'markOwnId', name: '同じ ID のレスすべてに印を付ける / 外す', icon: 'group' },
  { key: 'postActions', name: '掲示板ごとの操作(通報など)', icon: 'flag' },
  { key: 'delete', name: 'この書き込みを削除(自分の書き込みだけ)', icon: 'delete_forever' },
  { key: 'more', name: 'その他(⋯ のメニュー)', icon: 'more_horiz' },
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
            update('postToolbar2', s.postToolbar2.filter((x) => !x.startsWith('phrase:') || v.includes(x.slice('phrase:'.length))))
          }}
          onRename={(from, to) => update('postToolbar2', s.postToolbar2.map((x) => (x === `phrase:${from}` ? `phrase:${to}` : x)))}
          placeholder="例: ワロタ"
        />
      </Section>

      <Section advanced desktopOnly title="レスの操作バー" note="レスにマウスを乗せたとき、右上に出すボタンです。⋯ のメニューにある操作はどれも並べられ、上から順に左から並びます。⋯ も外せ、全部外すとバーは出ません(そのレスで使えない操作は出ません)">
        <OrderEditor all={all} value={s.postToolbar2} onChange={(v) => update('postToolbar2', v)} restTitle="出していないボタン" />
      </Section>

    </>
  )
}
