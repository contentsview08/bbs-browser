// NG を足す・直す画面。元の文字(スレタイや本文)を入れた状態で開くので、要らない部分を削ってそのまま登録できる。
// 中身の欄は NgEditor(PC の管理表・スマホの NG の画面と共通)

import { useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose, useGuardedClose } from '../hooks/useDialogClose'
import { BTN_PRIMARY, DialogHeader } from './DialogParts'
import { createPortal } from 'react-dom'
import { isValidPattern, newRule, type NgRule, type NgTarget } from '../utils/ng'
import NgEditor, { type NgDraftRule } from './NgEditor'

export interface NgDraft {
  target: NgTarget
  pattern: string
  /** 種類ごとの、元の文字(本文・名前・ID・スレタイ)。種類を切り替えたら、その種類の文字を欄に入れる */
  values?: Partial<Record<NgTarget, string>>
  /** 「この板だけ」にできる板(スレ・スレ一覧から開いたとき) */
  board?: { url: string; name: string }
  /** 直すときの、もとの NG */
  rule?: NgRule
}

export default function NgRuleDialog(props: { draft: NgDraft; board?: { url: string; name: string }; onSubmit: (rule: NgRule) => void; onDelete?: (rule: NgRule) => void; onClose: () => void }) {
  const d = props.draft
  const [rule, setRule] = useState<NgDraftRule>(() => d.rule ?? { target: d.target, pattern: d.pattern, isRegex: false, enabled: true })
  // 試し欄: 元のレスの本文(なければスレタイ・名前など、いまの種類の元の文字)
  const [sample, setSample] = useState(d.values?.content ?? d.values?.[d.target] ?? d.pattern)
  const valid = isValidPattern(rule.pattern.trim(), rule.isRegex)

  const submit = () => {
    if (!valid) return
    const pattern = rule.pattern.trim()
    props.onSubmit(rule.id ? ({ ...rule, pattern } as NgRule) : newRule(rule.target, pattern, { ...rule, pattern }))
    props.onClose()
  }

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める
  const boxRef = useRef<HTMLDivElement>(null)
  // 条件を変えていたら、閉じる前に確かめる(外を押しても閉じない。× と Esc だけ)
  const initial = useRef(JSON.stringify(rule)).current
  const { requestClose, guard } = useGuardedClose(JSON.stringify(rule) !== initial, props.onClose)
  useFocusTrap(boxRef, requestClose, { escBlursInputs: true })
  const backdrop = useBackdropClose(requestClose, false)

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-4" {...backdrop}>
      <div
        ref={boxRef}
        className="w-full max-w-lg max-h-full flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title={d.rule ? 'NG を直す' : 'NG に追加'} onClose={requestClose} />
        <div className="px-5 py-4 overflow-y-auto">
          <NgEditor rule={rule} onChange={setRule} board={d.board ?? props.board} values={d.values} sample={sample} onSampleChange={setSample} onSubmit={submit} />
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-c-border">
          {d.rule && props.onDelete && (
            <button
              type="button"
              className="mr-auto px-3 py-1.5 text-sm rounded border border-c-border text-c-text-body hover:text-mark-danger hover:border-mark-danger"
              onClick={() => {
                props.onDelete!(d.rule!)
                props.onClose()
              }}
            >
              この NG を消す
            </button>
          )}
          <span className="text-[10px] text-c-text-muted">Ctrl+Enter で{d.rule ? '直す' : '追加'}</span>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className={BTN_PRIMARY}
          >
            {d.rule ? '直す' : 'NG に追加'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
