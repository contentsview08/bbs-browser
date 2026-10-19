// 動いている所(PC かスマホか)。スマホ(Tauri の Android・iOS)では、画面の作りと操作を変える:
// 1 画面だけ・サイドバーは引き出し・ウィンドウのボタンなし・ポップアップは押して出す・スワイプで操作する。
// WebView の User-Agent で見分ける(Tauri の plugin-os を足さずに済むように)
export const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
