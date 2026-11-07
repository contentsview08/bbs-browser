import NgManager from '../NgManager'
import AiNgSettings from '../AiNgSettings'
import { isMobile } from '../../utils/platform'
import { ManagerRow, Toggle } from '../SettingParts'
import { canOpenToolWindow, openToolWindow } from '../../host/crossWindow'
import { type SettingsProps, Section, Choice } from './common'

/** NG の設定: 出し方・自動 NG・AI NG・NG の一覧 */
export function NgTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const rules = s.ngRules

  return (
    <>
      <Section title="NG のレス">
        <Choice
          value={s.ngMode}
          options={[
            { key: 'aborn', name: '「あぼーん」と出す' },
            { key: 'hide', name: '何も出さない(透明あぼーん)' },
          ]}
          onChange={(v) => update('ngMode', v)}
        />
        <Toggle
          checked={s.groupNg}
          onChange={(v) => update('groupNg', v)}
          label="2 つ以上続いたあぼーんを 1 行にまとめる"
          note="「あぼーん × 12(自動 NG 10・NG 2)」のように出します。押すと 1 つずつのあぼーんに広がり、そこから中身を見たり「荒らしじゃない」を付けたりできます"
        />
      </Section>
      <Section title="自動 NG(荒らし)">
        <Toggle
          checked={s.autoNg}
          onChange={(v) => update('autoNg', v)}
          label="荒らしらしいレスを自動で畳む"
          note="同じ長い本文の連投・同じ文字の繰り返しばかりのレスを、理由を付けて畳みます。レスのメニューの「荒らしとして NG」「荒らしじゃない」の印が 3 件以上たまると、印から学んで似た荒らしも畳みます"
        />
      </Section>

      <Section
        title="AI NG(条件で見つける)"
        note="「他人を煽っている」のように、当てたい書き込みを文で書くと、端末の中の判定モデルがレスごとに当たり具合を出します。条件ごとに、隠す・畳む・印だけを選べます"
      >
        <AiNgSettings settings={s} update={update} />
      </Section>

      <Section title="NG の一覧" note="レスの ⋯・スレの NG ボタンからも足せます。正規表現・効く板(すべて / この板だけ)・期限・メモを決められます">
        {/* PC: 増えると設定の中では見にくいので、管理表は自分のウィンドウに出す(件数だけここに) */}
        {canOpenToolWindow && !isMobile ? (
          <ManagerRow label="NG の管理表を開く" note="検索・絞り込み・まとめて操作・書き出し。別のウィンドウで開きます" count={rules.length} onOpen={() => void openToolWindow('ng')} />
        ) : (
          <NgManager rules={rules} onChange={(v) => update('ngRules', v, rules)} />
        )}
      </Section>
    </>
  )
}
