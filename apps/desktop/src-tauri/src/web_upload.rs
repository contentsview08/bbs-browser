//! 画像の置き場(imgur・catbox など)の、ふつうのアップロードの画面を別のウィンドウで開き、
//! 本人が手で上げたあとに画面に出た共有リンクを拾って、書き込み欄へ渡す(API を使わずに上げるため)。
//! 開いたページはアプリの命令を呼べない(capabilities の対象は main だけ)。リンクは、ページに差し込んだ見張りの
//! スクリプトが「https://bbs-upload.invalid/found?u=…」へ移ろうとするのを on_navigation で止めて受け取る。
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "web-upload";
const FOUND: &str = "https://bbs-upload.invalid/found";

/// ページに差し込む見張り。読み込んで 3 秒の間にあったリンクは数えず(見本の画像など)、そのあとに出たものだけを渡す
const WATCH: &str = r#"
(() => {
  if (window.top !== window) return
  const re = new RegExp(__PATTERN__, 'g')
  const seen = new Set()
  let ready = false
  const queue = []
  const scan = () => {
    const texts = []
    document.querySelectorAll('a[href]').forEach((a) => texts.push(a.href))
    document.querySelectorAll('img[src]').forEach((i) => texts.push(i.src))
    document.querySelectorAll('input, textarea').forEach((i) => texts.push(i.value))
    if (document.body) texts.push(document.body.innerText)
    for (const t of texts) for (const m of String(t || '').matchAll(re)) {
      const u = m[0]
      if (seen.has(u)) continue
      seen.add(u)
      if (ready) queue.push(u)
    }
  }
  setTimeout(() => { scan(); ready = true }, 3000)
  setInterval(() => {
    if (ready) scan()
    const u = queue.shift()
    if (u) location.href = '__FOUND__?u=' + encodeURIComponent(u)
  }, 700)
})()
"#;

/// 渡された画像(base64)を、ページが読み込まれたあとに貼り付け・ドロップしたことにする(imgur などは paste/drop で受け付ける)
const PASTE: &str = r#"
(() => {
  if (window.top !== window) return
  const files = __FILES__
  if (!files.length) return
  const build = () => {
    const dt = new DataTransfer()
    for (const f of files) {
      const bin = atob(f.data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    return dt
  }
  const fire = () => {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
    try { document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: build() })) } catch {}
    try {
      const dt = build()
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    } catch {}
  }
  window.addEventListener('load', () => setTimeout(fire, 1500))
})()
"#;

#[derive(serde::Deserialize)]
pub struct PasteFile {
    name: String,
    #[serde(rename = "type")]
    mime: String,
    data: String,
}

/// アップロードの画面を閉じる(上げ終わったとき)
#[tauri::command]
pub async fn close_web_upload(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// アップロードの画面を開く。url は https のページだけ。pattern は拾うリンクの正規表現(JavaScript の形)。
/// files を渡すと、ページに貼り付けたことにして、本人が選び直さなくても上がる
#[tauri::command]
pub async fn open_web_upload(app: AppHandle, url: String, pattern: String, title: String, files: Option<Vec<PasteFile>>) -> Result<(), String> {
    let page: Url = url.parse().map_err(|e| format!("URL が読めません: {e}"))?;
    if page.scheme() != "https" {
        return Err("https のページだけ開けます".into());
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    let script = WATCH
        .replace("__PATTERN__", &serde_json::to_string(&pattern).map_err(|e| e.to_string())?)
        .replace("__FOUND__", FOUND);
    let files_json = serde_json::to_string(
        &files
            .unwrap_or_default()
            .iter()
            .map(|f| serde_json::json!({ "name": f.name, "type": f.mime, "data": f.data }))
            .collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    let paste = PASTE.replace("__FILES__", &files_json);
    let main = app.clone();
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page))
        .title(title)
        .inner_size(960.0, 780.0)
        .initialization_script(&script)
        .initialization_script(&paste)
        .on_navigation(move |u| {
            if u.as_str().starts_with(FOUND) {
                if let Some((_, v)) = u.query_pairs().find(|(k, _)| k == "u") {
                    let _ = main.emit_to("main", "web-upload-link", v.to_string());
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
