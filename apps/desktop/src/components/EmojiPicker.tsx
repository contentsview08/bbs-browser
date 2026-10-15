// 絵文字を選んで書き込み欄に入れる。ボタンの上に一覧を出す(書き込み欄は画面の下にあるので)。
// 2ch 互換の板は Shift_JIS なので、絵文字は送るときに &#数字; になる(sjis.ts)

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GROUPS: { icon: string; name: string; emojis: string }[] = [
  {
    icon: '😀',
    name: '顔',
    emojis:
      '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀👻👽🤖💩',
  },
  { icon: '👍', name: '手', emojis: '👍👎👏🙌👐🤲🤝🙏✌️🤞🤟🤘👌🤌👈👉👆👇☝️✋🤚🖐️🖖👋🤙💪✍️💅' },
  { icon: '❤️', name: 'ハート', emojis: '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝' },
  {
    icon: '🐶',
    name: '動物',
    emojis: '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🦖🐙🦑🦀🐟🐬🐳',
  },
  {
    icon: '🍙',
    name: '食べ物',
    emojis: '🍎🍊🍋🍌🍉🍇🍓🍑🍒🍍🥝🍅🍆🥑🥦🌽🥕🍞🧀🍖🍗🥩🍔🍟🍕🌭🥪🌮🍜🍣🍱🍙🍚🍛🍝🍦🍰🎂🍩🍪🍫🍬🍭☕🍵🍺🍻🍷🥤',
  },
  {
    icon: '✨',
    name: '記号',
    emojis: '🎉🎊✨🔥💯💢💥💦💤🎵🎶⚡☀️🌙⭐🌈☁️❄️⚽⚾🏀🎮🎲📱💻📷📺💡💰📌✅❌⭕❓❗⚠️🚫🆗🆕',
  },
]

/** 絵文字の並びを 1 文字(異体字セレクタや ZWJ を含むまとまり)ずつに分ける */
function splitEmojis(text: string): string[] {
  return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
}

export default function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [pos, setPos] = useState<{ left: number; bottom: number }>()
  const [group, setGroup] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(undefined)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [pos])

  const toggle = () => {
    if (pos) return setPos(undefined)
    const rect = buttonRef.current!.getBoundingClientRect()
    const width = 320
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: window.innerHeight - rect.top + 6 })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`flex-shrink-0 p-1 rounded text-lg leading-none transition-colors hover:bg-c-surface2 disabled:opacity-40 ${pos ? 'bg-c-surface2' : ''}`}
        title="絵文字"
      >
        😊
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[9800] w-80 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl"
            style={pos}
          >
            <div className="flex border-b border-c-border">
              {GROUPS.map((g, i) => (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => setGroup(i)}
                  className={`flex-1 py-1.5 text-lg ${i === group ? 'bg-c-surface2' : 'opacity-60 hover:opacity-100'}`}
                  title={g.name}
                >
                  {g.icon}
                </button>
              ))}
            </div>
            <div className="h-56 overflow-y-auto custom-scrollbar p-1.5 grid grid-cols-8 gap-0.5 content-start">
              {splitEmojis(GROUPS[group].emojis).map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  type="button"
                  onClick={() => onPick(e)}
                  className="h-9 text-xl rounded hover:bg-c-surface2"
                  title={e}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
