import { NumberField, Toggle } from '../SettingParts'
import { Choice, type SettingsProps, Section } from './common'
import { formatLiveSpeed, LIVE_REFRESH_CHOICES } from '../../utils/autoScroll'
import LiveSpeedSlider from '../LiveSpeedSlider'

/** 開いているスレの自動更新の間隔(秒)。スマホ版の選択肢と同じ */
const AUTO_REFRESH_CHOICES = [0, 5, 10, 20, 30, 60].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 秒ごと` }))

export function RefreshTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <Section title="開いているスレの自動更新" note="実況板など、流れの速いスレ向けです。差分だけを取りに行きます">
        {/* 自由な数は入れさせない(1 秒ごとのような設定が掲示板の負担になる)。選択肢はスマホ版と同じ */}
        <Choice value={AUTO_REFRESH_CHOICES.some((o) => o.key === s.autoRefreshSec) ? s.autoRefreshSec : 0} options={AUTO_REFRESH_CHOICES} onChange={(v) => update('autoRefreshSec', v)} />
      </Section>
      <Section
        title="実況モード"
        note="スレ表示の ︙ の「実況モード」(キー A)。入れている間はこの間隔でスレを更新し、読み残しを流す速さで流します。追いついた後は、届いたレスを 1 つずつ下に積みます。流す速さは、スレ表示の右上のつまみでも変えられます"
      >
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-sm text-c-text-body">更新の間隔</p>
            <Choice value={s.liveRefreshSec} options={LIVE_REFRESH_CHOICES.map((n) => ({ key: n, name: `${n} 秒ごと` }))} onChange={(v) => update('liveRefreshSec', v)} />
          </div>
          <div className="max-w-md">
            <p className="mb-1.5 text-sm text-c-text-body">
              流す速さ <span className="ml-1 tabular-nums font-bold text-c-text-strong">{formatLiveSpeed(s.liveScrollSpeed)}</span>
            </p>
            <LiveSpeedSlider value={s.liveScrollSpeed} onChange={(v) => update('liveScrollSpeed', v)} />
          </div>
        </div>
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
