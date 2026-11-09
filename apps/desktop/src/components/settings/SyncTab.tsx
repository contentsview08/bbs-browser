// 同期の分類。鍵は main の窓にあるので、ここは頼むだけ。置き場は Google ドライブだけ(docs/sync-drive.md)
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { encode } from 'uqr'
import { DRIVE_LABELS as D, formatDriveUsage, JOIN_DATA_CONFIRM, PAIRING_SHOW_MS, SYNC_GROUP_LABELS, SYNC_GROUPS, SYNC_INTERVAL_LABELS, SYNC_INTERVALS, SYNC_LABELS as L, SYNC_NOTES, syncMessage, type MismatchSummary, type SyncConfirm, type SyncGroup, type SyncIntervalId, type SyncStatus, type SyncSummary } from '@bbs-browser/sync'
import { callMain } from '../../host/crossWindow'
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, INPUT } from '../DialogParts'
import ConfirmDialog from '../ConfirmDialog'
import { Toggle } from '../SettingParts'
import { Choice, SearchContext, Section } from './common'

const errorCode = (e: unknown) => (e instanceof Error ? e.message.split(':').pop()?.trim() || e.message : String(e))
const errorText = (e: unknown) => syncMessage(errorCode(e))
const clock = (ms: number | null) => (ms === null ? '―' : new Date(ms).toLocaleString())
const JOINED = '同期を始めました'

export function SyncTab() {
  const [st, setSt] = useState<SyncStatus>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState<string>()
  const [ask, setAsk] = useState<'leave' | 'secret' | 'revoke'>()
  /** ブラウザでの Google のログインを待っている */
  const [loggingIn, setLoggingIn] = useState(false)
  /** ドライブで使っている量。読めなかったら null */
  const [usage, setUsage] = useState<number | null>()
  // 検索の結果にも並ぶので、探している間は読み直さない
  const searching = useContext(SearchContext).trim() !== ''

  const [summary, setSummary] = useState<SyncSummary | null>()
  const [mismatch, setMismatch] = useState<MismatchSummary | null>()
  const refreshSummary = () => void callMain<SyncSummary | null>('syncSummary').then(setSummary, () => undefined)
  const refresh = () => void callMain<SyncStatus>('syncStatus').then(setSt, () => undefined)
  // files.list を辿るので毎秒は読まない。開いたときと、送った後だけ
  const refreshUsage = () => void callMain<number | null>('syncDriveUsage').then(setUsage, () => setUsage(null))
  useEffect(() => {
    refresh()
    refreshSummary()
    if (searching) return
    const id = window.setInterval(refresh, 1000)
    return () => window.clearInterval(id)
  }, [searching])
  // 止まっている(ログインし直しを待つ)間は呼ばない。取り直しに失敗するだけなので
  const usable = !!st?.enabled && !!st.master && st.state !== 'blocked'
  useEffect(() => {
    if (usable) refreshUsage()
    else setUsage(undefined)
  }, [usable, st?.lastPushAt])

  /** quiet は出さない失敗(自分で押した「やめる」など) */
  const act = async (f: () => Promise<unknown>, done?: string, quiet: readonly string[] = []) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await f()
      // 通っても同期できないことがある。その理由は状態の最後のエラーに出る
      if (done && !(await callMain<SyncStatus>('syncStatus')).lastError) setMessage(done)
    } catch (e) {
      if (!quiet.includes(errorCode(e))) setMessage(errorText(e))
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
  /** Google のログインを含む操作。待っている間は「やめる」を出す。やめたことは押した本人が分かっているので出さない */
  const withLogin = (f: () => Promise<unknown>, done?: string) => {
    setLoggingIn(true)
    return act(f, done, ['cancelled']).finally(() => setLoggingIn(false))
  }
  const join = () =>
    void act(async () => {
      // 手元に送るものがあるときは確認で止まる(状態の欄に出る)。「同期を始めました」は参加したときだけ
      const r = await callMain<{ confirm: SyncConfirm | null }>('syncJoin', code)
      setCode('')
      if (!r.confirm && !(await callMain<SyncStatus>('syncStatus')).lastError) setMessage(JOINED)
      refreshUsage()
    })
  const setKind = (group: SyncGroup, on: boolean) => void act(() => callMain('syncSetKind', { group, on })).then(refreshSummary)

  if (!st) return null
  const unavailable = st.drive?.unavailable ?? 'google_unavailable'
  const canUse = st.drive?.unavailable === null
  const needLogin = st.lastError === 'google_auth_failed'
  return (
    <>
      <Section title={L.section} note={D.intro}>
        {/* 切っている間に隠れる項目も検索で見つける */}
        <span hidden>{L.search_note}</span>
        <Toggle checked={st.master} label={L.master} note={D.master_note} onChange={(v) => void act(() => callMain('syncSetMaster', v)).then(refreshSummary)} />
        {message && <p className="text-sm text-c-text-body mt-2">{message}</p>}
      </Section>
      {st.master && (
        <Section title="状態">
          <dl className="text-sm text-c-text-body grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-3">
            <dt className="text-c-text-muted">状態</dt>
            <dd>{st.state}</dd>
            <dt className="text-c-text-muted">{D.store}</dt>
            <dd>{`${D.store_drive}${st.drive?.email ? `(${st.drive.email})` : ''}`}</dd>
            <dt className="text-c-text-muted">{L.status_space}</dt>
            <dd className="font-mono">{st.space ?? '―'}</dd>
            <dt className="text-c-text-muted">{L.status_pending}</dt>
            <dd>{st.pending} 件</dd>
            <dt className="text-c-text-muted">最後の受信</dt>
            <dd>{clock(st.lastPullAt)}</dd>
            <dt className="text-c-text-muted">最後の送信</dt>
            <dd>{clock(st.lastPushAt)}</dd>
            {st.enabled && (
              <>
                <dt className="text-c-text-muted">{D.usage}</dt>
                <dd>{usage == null ? '―' : formatDriveUsage(usage)}</dd>
              </>
            )}
            <dt className="text-c-text-muted">{L.status_error}</dt>
            <dd style={st.lastError ? { color: 'var(--c-error)' } : undefined}>{st.lastErrorText ?? '―'}</dd>
          </dl>
          {st.confirm?.type === JOIN_DATA_CONFIRM && (
            <div className="mb-3 text-sm text-c-text-body">
              <p className="mb-2">{st.confirm.data === false ? D.join_ask_drive : L.join_ask}</p>
              {st.confirm.account && <p className="mb-2">{D.join_ask_account.replace('{email}', st.confirm.account)}</p>}
              <div className="flex gap-2">
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void act(() => callMain('syncConfirm', 'keep_local'))}>
                  {L.join_cancel}
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act(() => callMain('syncConfirm', 'accept_removal'), JOINED).then(refreshUsage)}>
                  {L.join_ok}
                </button>
              </div>
            </div>
          )}
          {st.confirm && st.confirm.type !== JOIN_DATA_CONFIRM && (
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
          {loggingIn && (
            <div className="mb-3 flex items-center gap-2 text-sm text-c-text-body">
              <span>{D.login_waiting}</span>
              <button type="button" className={BTN_SECONDARY} onClick={() => void callMain('syncGoogleCancel').catch(() => undefined)}>
                {D.login_cancel}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mb-3">
            {(!st.enabled || needLogin) && !st.confirm && (
              <button type="button" className={BTN_PRIMARY} disabled={busy || !canUse} onClick={() => void withLogin(() => callMain('syncStart'), needLogin ? undefined : JOINED).then(refreshUsage)}>
                {needLogin ? D.relogin : D.start_drive}
              </button>
            )}
            {st.enabled && (
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void act(() => callMain('syncNow')).then(() => (refreshSummary(), refreshUsage()))}>
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
          {!st.enabled && <p className="text-xs text-c-text-muted mb-3">{canUse ? D.store_note : syncMessage(unavailable)}</p>}
          {/* 2 台目は、1 台目の「端末を追加」のコードを貼って参加する。接続が切れたときは、新しいコードを貼ると鍵と同期の表のままつなぎ直す */}
          {((!st.enabled && !st.confirm) || needLogin) && (
            <div className="flex gap-2 mb-3">
              <input className={`${INPUT} flex-1`} value={code} placeholder={D.join_placeholder} autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className={BTN_SECONDARY} disabled={busy || !canUse || code.trim() === ''} onClick={join}>
                {L.join}
              </button>
            </div>
          )}
          {pairing && <PairingCode code={pairing} onEnd={() => setPairing(undefined)} />}
        </Section>
      )}
      {st.master && (
        <Section title={D.interval} note={D.interval_note}>
          <Choice<SyncIntervalId> value={st.interval} options={SYNC_INTERVALS.map((x) => ({ key: x.id, name: SYNC_INTERVAL_LABELS[x.id] }))} onChange={(v) => void act(() => callMain('syncSetInterval', v))} />
        </Section>
      )}
      <Section title={L.kinds} note={`${D.kinds_note}${L.kinds_resume_note}`}>
        {SYNC_GROUPS.filter((g) => g.id !== 'secret').map((g) => (
          <Toggle key={g.id} checked={st.kinds[g.id]} label={SYNC_GROUP_LABELS[g.id]} onChange={(v) => setKind(g.id, v)} />
        ))}
        <Toggle checked={st.kinds.secret} label={SYNC_GROUP_LABELS.secret} note={D.secret_note} onChange={(v) => (v ? setAsk('secret') : setKind('secret', false))} />
      </Section>
      {st.master && st.enabled && summary && (
        <Section title="同期の要約">
          <SyncSummaryView summary={summary} mismatch={mismatch} busy={busy} onCheck={() => void act(async () => setMismatch(await callMain<MismatchSummary | null>('syncMismatches')))} />
        </Section>
      )}
      {st.enabled && (
        <Section advanced title={L.advanced}>
          <button type="button" className={BTN_DANGER} style={{ background: 'var(--c-error)' }} disabled={busy} onClick={() => setAsk('revoke')}>
            {D.revoke}
          </button>
        </Section>
      )}
      {ask === 'revoke' && (
        <ConfirmDialog
          title={D.revoke}
          message={D.revoke_ask}
          okLabel="接続を切る"
          onClose={(ok) => {
            setAsk(undefined)
            if (ok) void act(() => callMain('syncGoogleRevoke'))
          }}
        />
      )}
      {ask === 'leave' && (
        <ConfirmDialog
          title={L.leave}
          message={D.leave_ask}
          okLabel="同期をやめる"
          onClose={(ok) => {
            setAsk(undefined)
            if (ok) void act(() => callMain('syncLeave'))
          }}
        />
      )}
      {ask === 'secret' && (
        <ConfirmDialog
          title={L.secret_ask_title}
          message={L.secret_ask_body}
          okLabel={L.secret_ask_ok}
          onClose={(ok) => {
            setAsk(undefined)
            if (ok) setKind('secret', true)
          }}
        />
      )}
    </>
  )
}

/** 端末どうしで見比べる値。本文や URL は出さない */
function SyncSummaryView({ summary, mismatch, busy, onCheck }: { summary: SyncSummary; mismatch: MismatchSummary | null | undefined; busy: boolean; onCheck: () => void }) {
  const counts = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${k} ${n}`).join('、') || 'なし'
  return (
    <div className="mb-3 text-sm text-c-text-body">
      <p className="text-c-text-muted mb-1">同期の表(生きている+削除:ハッシュ)</p>
      <ul className="font-mono text-xs mb-2">
        {summary.kinds.map((k) => (
          <li key={k.kind}>{`${k.kind} ${k.live}+${k.tombstones}:${k.hash}`}{k.pending > 0 ? ` 送信待ち ${k.pending}` : ''}{k.needs_apply > 0 ? ` 適用待ち ${k.needs_apply}` : ''}</li>
        ))}
      </ul>
      <p className="text-c-text-muted mb-1">手元(件数:ハッシュ)</p>
      <ul className="font-mono text-xs mb-2">
        {summary.local.map((l) => (
          <li key={l.area}>{`${l.area} ${l.count}:${l.hash}`}</li>
        ))}
      </ul>
      {Object.keys(summary.notes).length > 0 && (
        <>
          <p className="text-c-text-muted mb-1">手元の件数が合わない理由</p>
          <ul className="text-xs mb-2">
            {Object.entries(summary.notes).map(([k, n]) => (
              <li key={k}>{`${SYNC_NOTES[k] ?? k}: ${n} 件`}</li>
            ))}
          </ul>
        </>
      )}
      <div className="flex gap-2 mb-2">
        <button type="button" className={BTN_SECONDARY} onClick={() => void navigator.clipboard.writeText(summary.text)}>
          要約をコピー
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onCheck}>
          不一致の検査
        </button>
      </div>
      {mismatch && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-c-text-muted">違い</dt>
          <dd>{counts(mismatch.differs)}</dd>
          <dt className="text-c-text-muted">表にない手元の行</dt>
          <dd>{counts(mismatch.missing)}</dd>
          {mismatch.samples.length > 0 && (
            <>
              <dt className="text-c-text-muted">レコード</dt>
              <dd className="font-mono text-xs break-all">{mismatch.samples.join(' ')}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}

/**
 * コピーしたコードをクリップボードから消す。今の中身が自分のコードのときだけ(その後に利用者がコピーしたものを消さない)。
 * 読めないときは消さない
 */
async function clearCopied(code: string): Promise<void> {
  try {
    if ((await navigator.clipboard.readText()) === code) await navigator.clipboard.writeText('')
  } catch {
    // 読めない・書けないときは諦める(コピーのボタンの近くに、履歴に残ることを書いてある)
  }
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
    const clear = () => {
      if (copied.current) void clearCopied(code)
    }
    // 60 秒を待たずに窓を閉じたときも消す
    window.addEventListener('beforeunload', clear)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('beforeunload', clear)
      clear()
    }
  }, [code])
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
      <p className="text-xs text-c-text-muted mb-2">{D.pairing_note}</p>
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
      <p className="text-xs text-c-text-muted mt-2">{D.copy_note}</p>
    </div>
  )
}
