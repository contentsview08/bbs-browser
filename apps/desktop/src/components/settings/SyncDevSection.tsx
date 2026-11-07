// 開発用の同期の画面。隠してあり、版を押して開く。鍵は main の窓にあるので、ここは頼むだけ
import { useEffect, useMemo, useRef, useState } from 'react'
import { encode } from 'uqr'
import { PAIRING_SHOW_MS, SYNC_LABELS as L, syncMessage, type SyncStatus } from '@bbs-browser/sync'
import { callMain } from '../../host/crossWindow'
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, INPUT } from '../DialogParts'
import ConfirmDialog from '../ConfirmDialog'
import { Section } from './common'

const errorText = (e: unknown) => syncMessage(e instanceof Error ? e.message.split(':').pop() || e.message : String(e))
const clock = (ms: number | null) => (ms === null ? '―' : new Date(ms).toLocaleString())

export function SyncDevSection() {
  const [st, setSt] = useState<SyncStatus>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [code, setCode] = useState('')
  const [url, setUrl] = useState<string>()
  const [pairing, setPairing] = useState<string>()
  const [ask, setAsk] = useState<'leave' | 'server'>()

  const refresh = () => void callMain<SyncStatus>('syncStatus').then(setSt, () => undefined)
  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 1000)
    return () => window.clearInterval(id)
  }, [])

  const act = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await f()
      // 窓を通っても領域を作れないことがある。その理由は状態の最後のエラーに出る
      if (done && !(await callMain<SyncStatus>('syncStatus')).lastError) setMessage(done)
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const showPairing = () =>
    act(async () => {
      const r = await callMain<{ code: string }>('syncPairingCode')
      setPairing(r.code)
    })

  if (!st) return null
  const needTicket = st.lastError?.startsWith('ticket_')
  return (
    <Section title={L.section} note="お気に入りのスレと板、サイト、上げた画像の履歴、NG を同期します。サーバーは保管庫ではなく、端末の間の中継の置き場です">
      <dl className="text-sm text-c-text-body grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-3">
        <dt className="text-c-text-muted">状態</dt>
        <dd>{st.state}</dd>
        <dt className="text-c-text-muted">{L.status_space}</dt>
        <dd className="font-mono">{st.space ?? '―'}</dd>
        <dt className="text-c-text-muted">{L.status_pending}</dt>
        <dd>{st.pending} 件</dd>
        <dt className="text-c-text-muted">最後の受信</dt>
        <dd>{clock(st.lastPullAt)}</dd>
        <dt className="text-c-text-muted">最後の送信</dt>
        <dd>{clock(st.lastPushAt)}</dd>
        <dt className="text-c-text-muted">{L.status_error}</dt>
        <dd style={st.lastError ? { color: 'var(--c-error)' } : undefined}>{st.lastErrorText ?? '―'}</dd>
      </dl>
      {st.confirm && (
        <div className="mb-3 text-sm text-c-text-body">
          <p className="mb-2">同期のデータで削除された {st.confirm.lost} 件が、この端末からも消えます。</p>
          <div className="flex gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void act(() => callMain('syncConfirm', 'keep_local'))}>
              消さない
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act(() => callMain('syncConfirm', 'accept_removal'))}>
              進める
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        {(!st.enabled || needTicket) && (
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act(() => callMain('syncStart'), '同期を始めました')}>
            {L.start}
          </button>
        )}
        {st.enabled && (
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act(() => callMain('syncNow'))}>
            {L.sync_now}
          </button>
        )}
        {st.enabled && (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void showPairing()}>
            {L.add_device}
          </button>
        )}
        {st.enabled && (
          <button type="button" className={BTN_DANGER} style={{ background: 'var(--c-error)' }} disabled={busy} onClick={() => setAsk('leave')}>
            {L.leave}
          </button>
        )}
      </div>
      {!st.enabled && (
        <div className="flex gap-2 mb-3">
          <input className={`${INPUT} flex-1`} value={code} placeholder="obb1." autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={busy || code.trim() === ''}
            onClick={() =>
              void act(async () => {
                await callMain('syncJoin', code)
                setCode('')
              }, '同期を始めました')
            }
          >
            {L.join}
          </button>
        </div>
      )}
      {pairing && <PairingCode code={pairing} onEnd={() => setPairing(undefined)} />}
      <label className="block text-sm text-c-text-muted mb-1">{L.server_url}</label>
      <div className="flex gap-2 mb-2">
        <input className={`${INPUT} flex-1 font-mono`} value={url ?? st.serverOverride ?? ''} placeholder={st.serverUrl} autoComplete="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className={BTN_SECONDARY} disabled={busy || url === undefined} onClick={() => setAsk('server')}>
          変える
        </button>
      </div>
      {message && <p className="text-sm text-c-text-body">{message}</p>}
      {ask === 'leave' && (
        <ConfirmDialog
          title={L.leave}
          message="この端末の鍵と同期の表を消します。この端末のお気に入りは消えません。サーバーのデータはそのままです。"
          okLabel="同期をやめる"
          onClose={(ok) => {
            setAsk(undefined)
            if (ok) void act(() => callMain('syncLeave'))
          }}
        />
      )}
      {ask === 'server' && (
        <ConfirmDialog
          title={L.server_url}
          message="新しいサーバーに認証の情報を送ります。"
          okLabel="変える"
          onClose={(ok) => {
            setAsk(undefined)
            if (ok)
              void act(async () => {
                await callMain('syncSetServer', url ?? '')
                setUrl(undefined)
              })
          }}
        />
      )}
    </Section>
  )
}

function PairingCode({ code, onEnd }: { code: string; onEnd: () => void }) {
  const [left, setLeft] = useState(PAIRING_SHOW_MS / 1000)
  const copied = useRef(false)
  const end = useRef(onEnd)
  end.current = onEnd
  useEffect(() => {
    const started = Date.now()
    const id = window.setInterval(() => {
      const rest = Math.ceil((PAIRING_SHOW_MS - (Date.now() - started)) / 1000)
      setLeft(rest)
      if (rest <= 0) end.current()
    }, 250)
    return () => {
      window.clearInterval(id)
      // コピーしたものをクリップボードに残さない
      if (copied.current) void navigator.clipboard.writeText('').catch(() => undefined)
    }
  }, [])
  const qr = useMemo(() => encode(code, { ecc: 'L', border: 2 }), [code])
  const path = useMemo(() => {
    let d = ''
    qr.data.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x} ${y}h1v1h-1z` : '')))
    return d
  }, [qr])
  return (
    <div className="mb-3 p-3 rounded-[var(--card-radius)] border border-c-border">
      <p className="text-sm font-bold mb-2" style={{ color: 'var(--c-error)' }}>
        {L.pairing_warning}(あと {Math.max(left, 0)} 秒)
      </p>
      {/* 背景と点の色は読み取りのために固定する */}
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={Math.max(280, qr.size * 4)} height={Math.max(280, qr.size * 4)} shapeRendering="crispEdges" role="img" aria-label="QR" style={{ background: '#fff' }}>
        <path d={path} fill="#000" />
      </svg>
      <textarea className={`${INPUT} w-full h-20 mt-2 font-mono text-xs`} readOnly value={code} />
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() =>
            void navigator.clipboard.writeText(code).then(() => {
              copied.current = true
            })
          }
        >
          {L.copy}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onEnd}>
          閉じる
        </button>
      </div>
    </div>
  )
}
