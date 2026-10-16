// アプリ内の通知(右下)。裏の処理(既読・下書き・設定の保存など)が失敗したときも、種類ごとに 1 回ここに出す

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppNotification } from '../components/Notifications'
import { onBackgroundError } from '../utils/backgroundError'

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const seq = useRef(0)
  const notify = useCallback((n: Omit<AppNotification, 'id'>) => setNotifications((ns) => [...ns, { ...n, id: ++seq.current }]), [])
  const dismiss = useCallback((id: number) => setNotifications((ns) => ns.filter((n) => n.id !== id)), [])
  useEffect(
    () =>
      onBackgroundError((what, e) =>
        notify({ icon: 'error', title: `${what}に失敗しました`, body: e instanceof Error ? e.message : String(e) }),
      ),
    [notify],
  )
  return { notifications, notify, dismiss }
}
