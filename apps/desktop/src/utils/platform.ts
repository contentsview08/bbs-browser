// 動いている所(PC かスマホか)。スマホ(Tauri の Android・iOS)では、画面の作りと操作を変える:
// 1 画面だけ・サイドバーは引き出し・ウィンドウのボタンなし・ポップアップは押して出す・スワイプで操作する。
// WebView の User-Agent で見分ける(Tauri の plugin-os を足さずに済むように)
export const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** ボタンやメニューの名前に付けた、キーの案内(「(Shift+Delete)」「(5 キー・Esc)」など) */
const KEY_HINT = /\s*[(（][^()（）]*(?:Shift|Ctrl|Alt|Esc|Enter|Delete|Tab|キー|F\d+)[^()（）]*[)）]/g

/** 画面に出す名前。スマホにはキーがないので、キーの案内を外す */
export function uiLabel(label: string): string {
  return isMobile ? label.replace(KEY_HINT, '') : label
}
