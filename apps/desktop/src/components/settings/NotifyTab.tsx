import { pickOpenPath } from '../../host/dialog'
import { importNotifySound, playNotifySound } from '../../host/notifySound'
import { NOTIFY_KINDS } from '../../ui/settings'
import { ensureNotifyPermission } from '../../utils/osNotify'
import { isMobile } from '../../utils/platform'
import { NumberField, Toggle } from '../SettingParts'
import { type SettingsProps, Section } from './common'

const BTN = 'px-3 py-1.5 rounded-md text-sm border border-c-border text-c-text-strong hover:bg-c-surface2'

/** 通知: OS の通知に出すか、知らせる種類、キーワードの見張り */
export function NotifyTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <Section
        title="OS の通知"
        note="オンにすると、お気に入りの新着・キーワードに合うスレ・自分への返信・新しい版の知らせを、アプリを見ていないときに OS の通知(Windows の通知・Android の通知の欄)にも出します。Windows では通知を押すとそのスレを開きます。アプリを完全に閉じている間は、新着を確かめられないので知らせません"
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
      {!isMobile && (
        <Section title="通知音" note="知らせのときに鳴らします。自分の音(wav・mp3・ogg・flac・m4a)を選ぶと、アプリのフォルダにコピーして使います">
          <Toggle checked={s.notifySound} onChange={(v) => update('notifySound', v)} label="通知音を鳴らす" />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className={BTN}
              onClick={async () => {
                const file = await pickOpenPath('音', ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'])
                if (file) update('notifySoundPath', await importNotifySound(file))
              }}
            >
              音を選ぶ
            </button>
            <button type="button" className={BTN} onClick={() => void playNotifySound(s.notifySoundPath)}>
              鳴らしてみる
            </button>
            {s.notifySoundPath && (
              <button type="button" className="px-3 py-1.5 text-sm text-c-text-muted hover:text-c-text-strong" onClick={() => update('notifySoundPath', '')}>
                既定の音に戻す
              </button>
            )}
            <span className="text-xs text-c-text-muted">{s.notifySoundPath ? s.notifySoundPath.split(/[\\/]/).pop() : '既定の音'}</span>
          </div>
        </Section>
      )}
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
