// スレを 1 つのファイルに書き出す(テキストか HTML)。中身を作るだけで、ファイルへの書き込みは host/backup.ts

import type { Post } from '@bbs-browser/connectors'

export interface ExportSource {
  title: string
  url: string
  posts: Post[]
  savedAt: Date
}

function header(p: Post): string {
  return `${p.no} ${p.name}${p.mail ? ` [${p.mail}]` : ''} ${p.date}${p.id ? ` ID:${p.id}` : ''}`
}

/** テキスト。レスごとに見出しの行と本文を並べ、空行で区切る */
export function threadToText(s: ExportSource): string {
  const lines = [s.title, s.url, `保存: ${s.savedAt.toLocaleString('ja-JP')}`, '']
  for (const p of s.posts) lines.push(header(p), p.body, '')
  return lines.join('\n')
}

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 本文の URL だけリンクにする(ほかは文字のまま) */
function bodyHtml(body: string): string {
  // 区切りの < > " を見分けられるよう、エスケープする前に URL で分ける(奇数番目が URL)
  return body
    .split(/(https?:\/\/[^\s<>"]+)/)
    .map((part, i) => {
      const t = escapeHtml(part)
      return i % 2 === 1 ? `<a href="${t}">${t}</a>` : t
    })
    .join('')
}

/** HTML。1 つのファイルだけで読めるよう、見た目も中に入れる */
export function threadToHtml(s: ExportSource): string {
  const posts = s.posts
    .map(
      (p) => `<article id="${p.no}"><header><b>${p.no}</b> <span class="name">${escapeHtml(p.name)}</span>${
        p.mail ? ` <span class="mail">[${escapeHtml(p.mail)}]</span>` : ''
      } <span class="date">${escapeHtml(p.date)}</span>${p.id ? ` <span class="id">ID:${escapeHtml(p.id)}</span>` : ''}</header><div class="body">${bodyHtml(
        p.body,
      )}</div></article>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(s.title)}</title>
<style>
body{max-width:52rem;margin:2rem auto;padding:0 1rem;font-family:sans-serif;line-height:1.7;color:#222;background:#fafaf8}
h1{font-size:1.3rem}.meta{color:#777;font-size:.85rem}
article{padding:.6rem 0;border-top:1px solid #e3e1dc}header{font-size:.85rem;color:#666}
.name{color:#2a7a3a;font-weight:bold}.body{white-space:pre-wrap;word-break:break-word;margin-top:.2rem}
@media (prefers-color-scheme:dark){body{background:#1b1d22;color:#ddd}article{border-color:#333}header,.meta{color:#999}.name{color:#7fc48c}a{color:#8ab4f8}}
</style></head><body>
<h1>${escapeHtml(s.title)}</h1>
<p class="meta"><a href="${escapeHtml(s.url)}">${escapeHtml(s.url)}</a> ・ 保存: ${escapeHtml(s.savedAt.toLocaleString('ja-JP'))} ・ ${s.posts.length} レス</p>
${posts}
</body></html>
`
}

/** ファイル名に使えない文字を除いたスレタイ(長すぎるものは切る) */
export function exportFileName(title: string, ext: 'html' | 'txt'): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'thread'
  return `${base}.${ext}`
}
