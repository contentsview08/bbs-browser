import { NumberField, Toggle } from '../SettingParts'
import { type SettingsProps, Section } from './common'

export function RefreshTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <Section title="開いているスレの自動更新" note="実況板など、流れの速いスレ向けです。差分だけを取りに行きます">
        <NumberField value={s.autoRefreshSec} min={0} max={3600} unit="秒ごと" zeroLabel="しない" presets={[0, 5, 10, 30, 60]} onChange={(v) => update('autoRefreshSec', v)} />
      </Section>
      <Section
        advanced title="お気に入りのスレの新着"
        note="お気に入りのスレがある板のスレ一覧を取り、新着の数だけ確かめます(本文は、お気に入りのスレの一覧で更新したときに取ります)"
      >
        <NumberField value={s.favCheckMin} min={0} max={1440} unit="分ごと" zeroLabel="しない" presets={[0, 3, 5, 10, 30]} onChange={(v) => update('favCheckMin', v)} />
      </Section>
      <Section
        title="閲覧履歴(既読のスレ)の新着"
        note="閲覧履歴にあるスレの板のスレ一覧を取り、新着の数と dat 落ちを確かめます(本文は開いたときに取ります)。掲示板に負担をかけないよう、5 分より短くはできません"
      >
        <NumberField
          value={s.historyCheckMin}
          min={0}
          minNonZero={5}
          max={1440}
          unit="分ごと"
          zeroLabel="しない"
          presets={[0, 5, 10, 30, 60]}
          onChange={(v) => update('historyCheckMin', v)}
        />
      </Section>
      <Section title="新着">
        <Toggle
          checked={s.autoScrollOnNew}
          onChange={(v) => update('autoScrollOnNew', v)}
          label="いちばん下を見ているときは、新着まで自動でスクロールする"
        />
      </Section>
    </>
  )
}
