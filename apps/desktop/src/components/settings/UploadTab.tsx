import { UPLOAD_HOSTS, type UploadHost } from '../../host/uploader'
import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ManagerDialog, TextSetting } from '../SettingParts'
import { ICON_BTN } from '../DialogParts'
import { type SettingsProps, Section, Choice } from './common'

/** userhash の入力欄。ふだんは伏せて、目のボタンで見られるようにする */
export function UserhashInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <TextSetting type={shown ? 'text' : 'password'} autoComplete="off" value={value} onChange={onChange} placeholder="登録しない(匿名で上げる)" mono className="flex-1" />
      <button type="button" className={ICON_BTN} title={shown ? '伏せる' : '見る'} onClick={() => setShown((v) => !v)}>
        <span className="material-symbols-outlined text-base">{shown ? 'visibility_off' : 'visibility'}</span>
      </button>
    </div>
  )
}

/** 上げ先ごとの登録(Client-ID・userhash・API キー)の小画面 */
function UploadHostDialog({ host, settings: s, update, onClose }: Pick<SettingsProps, 'settings' | 'update'> & { host: UploadHost; onClose: () => void }) {
  const def = UPLOAD_HOSTS.find((h) => h.key === host)!
  return (
    <ManagerDialog title={`${def.name}(API)の登録`} onClose={onClose}>
      <div className="space-y-3">
        {host === 'imgur' && (
          <>
            <p className="text-sm text-c-text-body">Client-ID</p>
            <TextSetting value={s.imgurClientId} onChange={(v) => update('imgurClientId', v)} placeholder="api.imgur.com で登録した Client-ID" trim mono className="w-full" />
            <p className="text-xs text-c-text-muted leading-relaxed">
              <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://api.imgur.com/oauth2/addclient')}>
                imgur でアプリを登録し
              </button>
              (Authorization type は「Anonymous usage without user authorization」)、出てきた Client-ID を入れます
            </p>
          </>
        )}
        {host === 'catbox' && (
          <>
            <p className="text-sm text-c-text-body">userhash(なくても上げられます)</p>
            <UserhashInput value={s.catboxUserhash} onChange={(v) => update('catboxUserhash', v)} />
            <p className="text-xs text-c-text-muted leading-relaxed">
              <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://catbox.moe/user/register.php')}>
                catbox.moe でアカウントを作り
              </button>
              、ログインしたあとのアカウントの画面にある userhash を貼ります。登録すると、そのアカウントで上げ、履歴から catbox 上のファイルも消せます(登録してから上げたものだけ)。
              userhash はこのパソコンの中に保存し、catbox に送るときだけ使います
            </p>
            <div className="p-3 text-xs leading-relaxed text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
              <p className="font-bold text-c-text-strong mb-1">catbox を使う前に</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>匿名で上げたものはあとから消せません(2 年間アクセスがなければ消えます)</li>
                <li>児童ポルノ・マルウェア・アニメやドラマの丸ごとの配信・ひどいグロなどは禁止です。利用規約: catbox.moe/legal.php</li>
                <li>このアプリから上げられるのは 50MB まで(GIF は 20MB)</li>
              </ul>
            </div>
          </>
        )}
        {host === 'imgbb' && (
          <>
            <p className="text-sm text-c-text-body">API キー</p>
            <TextSetting value={s.imgbbApiKey} onChange={(v) => update('imgbbApiKey', v)} placeholder="api.imgbb.com で発行した API キー" trim mono className="w-full" />
            <p className="text-xs text-c-text-muted leading-relaxed">
              <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://api.imgbb.com/')}>
                imgbb でアカウントを作って API キーを発行し
              </button>
              、ここに入れます。キーはこのパソコンの中に保存し、imgbb に送るときだけ使います
            </p>
          </>
        )}
      </div>
    </ManagerDialog>
  )
}

/** 画像のアップロード: 使う・上げ先(サイトの画面か API。API は上げ先ごとの小画面で登録)・上げる前の処理 */
export function UploadTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const [editing, setEditing] = useState<UploadHost>()
  const registered = (h: (typeof UPLOAD_HOSTS)[number]) => (h.setting ? s[h.setting].trim() !== '' : false)
  return (
    <>
      <Section title="上げ先" note="書き込み欄の画像ボタン・貼り付け・ドラッグで画像を置き場に上げ、本文に URL を入れます。上げた画像は誰でも見られます。hono-bbs の板では、いつもその掲示板の置き場に上げます。「サイトの画面」は、画像ボタンを押すとそのサイトの画面が開き、そこで上げたリンクを本文に入れます。「API」は、キーを登録すると画像ボタンからそのまま上げます">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {UPLOAD_HOSTS.map((h) => {
            const on = s.uploadHost === h.key
            return (
              <div key={h.key} className={`flex items-center gap-3 px-3 py-2 ${on ? 'bg-[var(--c-accent-wash)]' : ''}`}>
                <input type="radio" name="uploadHost" checked={on} onChange={() => update('uploadHost', h.key)} className="accent-[var(--c-accent)]" />
                <button type="button" onClick={() => update('uploadHost', h.key)} className="flex-1 min-w-0 text-left">
                  <span className={`block text-sm ${on ? 'text-c-accent font-bold' : 'text-c-text-strong'}`}>
                    {h.name}
                    <span className="ml-1.5 text-[10px] font-normal px-1 py-px rounded bg-c-surface2 text-c-text-muted">{h.kind === 'web' ? 'サイトの画面' : 'API'}</span>
                    {h.setting && (
                      <span className={`ml-1.5 text-[10px] font-normal ${registered(h) ? 'text-mark-new' : 'text-c-text-muted'}`}>
                        {registered(h) ? `${h.settingName} 登録済み` : h.key === 'catbox' ? `${h.settingName} なし` : `${h.settingName} が要ります`}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-c-text-muted">{h.note}</span>
                </button>
                {h.setting && (
                  <button type="button" onClick={() => setEditing(h.key)} className="flex items-center gap-0.5 px-2 py-1 text-xs rounded border border-c-border text-c-text-body hover:border-c-accent hover:text-c-accent">
                    登録
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      <Section advanced title="上げる前に" note="JPEG・PNG・WebP は描き直して、位置情報など(EXIF)をいつも取り除きます。GIF と動画は描き直すとアニメが崩れるので、そのまま上げます">
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">大きい画像を縮めて上げる(長い辺)</p>
          <Choice
            value={s.uploadMaxDimension}
            options={[0, 1280, 1920, 2560, 4096].map((n) => ({ key: n, name: n === 0 ? '縮めない' : `${n}px まで` }))}
            onChange={(v) => update('uploadMaxDimension', v)}
          />
          <p className="text-[10px] text-c-text-muted mt-1">
            アップローダーの負担を減らすため、ほどほどの大きさにしてから上げます(JPEG・PNG・WebP)。まとめて貼られても 1 枚ずつ、一度に 10 枚まで上げます
          </p>
        </div>
      </Section>
      {editing && <UploadHostDialog host={editing} settings={s} update={update} onClose={() => setEditing(undefined)} />}
    </>
  )
}
