// 設定の「スレ一覧」。

import { useState } from 'react'
import { ListFontSliders } from '../FontSizeSlider'
import { ListEditor, NumberField, Toggle } from '../SettingParts'
import { BTN_PRIMARY } from '../DialogParts'
import { type SettingsProps, Section, Choice, ListTabsEditor } from './common'

export function ThreadsTab({ settings: s, update, onPruneLogs }: Pick<SettingsProps, 'settings' | 'update' | 'onPruneLogs'>) {
  const [pruneMessage, setPruneMessage] = useState<string>()
  const [pruning, setPruning] = useState(false)
  return (
    <>
      <Section title="履歴の 1 ページの件数" note="閲覧履歴・未読・お気に入りのスレの一覧をページに分けて出します(板のスレ一覧は分けません)。絞り込み・検索はページをまたいで当たります">
        <Choice
          value={s.listPageSize}
          options={[50, 100, 200, 500, 0].map((n) => ({ key: n, name: n === 0 ? 'すべて(分けない)' : `${n} スレ` }))}
          onChange={(v) => update('listPageSize', v)}
        />
      </Section>
      <Section title="文字の大きさ・余白" note="スレ一覧の ︙ の「文字の大きさ・余白」でも、見ながら変えられます">
        <ListFontSliders settings={s} update={update} />
      </Section>
      <Section title="行の形">
        <Choice
          value={s.listShape}
          options={[
            { key: 'normal' as const, name: 'ふつう' },
            { key: 'compact' as const, name: 'コンパクト(スレタイ 1 行と数だけ)' },
          ]}
          onChange={(v) => update('listShape', v)}
        />
      </Section>
      <Section
        title="キーワード"
        note="スレタイに含むスレを、スレ一覧の上にキーワードの帯をつけてまとめます。上に並んでいるキーワードほど先に出ます"
      >
        <ListEditor noun="キーワード" sortable items={s.keywords} onChange={(v) => update('keywords', v)} placeholder="例: 実況" />
      </Section>
      <Section title="板を開いたときの並び" note="スレ一覧のタブで、その場でも変えられます">
        <Choice
          value={s.threadSort}
          options={[
            { key: 'subject', name: '更新順(掲示板の並び)' },
            { key: 'momentum', name: '勢い順' },
            { key: 'newest', name: '新しい順' },
            { key: 'count', name: 'レス数順' },
          ]}
          onChange={(v) => update('threadSort', v)}
        />
      </Section>
      <Section title="スレ一覧のタブ" note="スレ一覧の上に出すタブと、その並び(上が左)です。数字キーの 1・2・3… は左から順に当たります">
        <ListTabsEditor value={s.listTabs} onChange={(v) => update('listTabs', v)} />
      </Section>
      <Section title="ログの削除">
        <Toggle
          checked={s.confirmDeleteLog}
          onChange={(v) => update('confirmDeleteLog', v)}
          label="ログを消す前に確かめる"
          note="確かめる画面で「次回から表示しない」を選ぶとオフになります。ここで戻せます"
        />
      </Section>
      <Section
        title="閲覧履歴(ログ)を残す日数"
        note="この日数より長く開いていないスレのログを、起動したときに消します。お気に入りのスレ・自分が書き込んだスレ・開いているタブは残します"
      >
        <NumberField
          value={s.logRetentionDays}
          min={0}
          max={3650}
          unit="日"
          zeroLabel="消さない"
          presets={[7, 30, 90, 365, 0]}
          onChange={(v) => update('logRetentionDays', v)}
        />
        {s.logRetentionDays > 0 && (
          <button
            type="button"
            className={`${BTN_PRIMARY} mt-3`}
            disabled={pruning}
            onClick={() => {
              setPruning(true)
              onPruneLogs()
                .then((n) => setPruneMessage(n > 0 ? `${n} スレのログを消しました` : '消すログはありませんでした'))
                .catch((e) => setPruneMessage(e instanceof Error ? e.message : String(e)))
                .finally(() => setPruning(false))
            }}
          >
            今すぐ消す
          </button>
        )}
        {pruneMessage && <p className="mt-2 text-xs text-c-text-muted">{pruneMessage}</p>}
      </Section>
    </>
  )
}
