// 設定の「通知」。

import { NOTIFY_KINDS } from '../../ui/settings'
import { ensureNotifyPermission } from '../../utils/osNotify'
import { NumberField, Toggle } from '../SettingParts'
import { type SettingsProps, Section } from './common'

/** 通知: OS の通知に出すか、知らせる種類、キーワードの見張り */
export function NotifyTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <Section
        title="OS の通知"
        note="オンにすると、知らせをアプリの中だけでなく OS の通知(Windows の通知・Android の通知の欄)にも出します。エラーは出しません。アプリを完全に閉じている間は、新着を確かめられないので知らせません"
      >
        <Toggle
          checked={s.osNotify}
          onChange={(v) => {
            update('osNotify', v)
            // オンにしたら OS に通知の許可を求める(断られたら、OS の設定から許可してもらう)
            if (v) void ensureNotifyPermission().then((ok) => !ok && alert('通知が許可されていません。OS の設定(Windows: 設定 → システム → 通知、Android: アプリ → OBB → 通知)から許可してください'))
          }}
          label="OS の通知にも出す"
        />
      </Section>
      <Section title="知らせる種類" note="オフにした種類は、アプリの中にも OS にも出しません">
        {NOTIFY_KINDS.map((k) => (
          <Toggle key={k.key} checked={s.notifyKinds[k.key] !== false} onChange={(v) => update('notifyKinds', { ...s.notifyKinds, [k.key]: v })} label={k.name} note={k.note} />
        ))}
      </Section>
      <Section title="キーワードに合うスレが立ったら知らせる" note="お気に入り板のスレ一覧をこの間隔で見に行き、「スレ一覧 → キーワード」に合うスレが立っていたら知らせます">
        <NumberField value={s.keywordWatchMin} min={0} max={1440} unit="分ごと" zeroLabel="知らせない" presets={[0, 5, 10, 30, 60]} onChange={(v) => update('keywordWatchMin', v)} />
      </Section>
    </>
  )
}
