// packages/conformance/avatar/parts.json(キャラクターのアイコンの部品)を、PC 版が読む TS に写す。
// JSON を直に import しないのは、Web の写し(hono-bbs)からは bbs-browser の JSON に届かないため(TS のファイルごと写す)。
// 使い方: node scripts/gen-avatar-parts.mjs   (部品を描き直したら打ち直す。test/avatar.test.ts が食い違いを見つける)
import { readFileSync, writeFileSync } from 'node:fs'

const src = new URL('../packages/conformance/avatar/parts.json', import.meta.url)
const out = new URL('../apps/desktop/src/utils/avatarParts.ts', import.meta.url)
const p = JSON.parse(readFileSync(src, 'utf8'))
const part = (x) => `  { key: ${JSON.stringify(x.key)}, name: ${JSON.stringify(x.name)}, rows: [\n${x.rows.map((r) => `    '${r}',`).join('\n')}\n  ] }`
const list = (xs) => `[\n${xs.map((x) => part(x) + ',').join('\n')}\n]`
const ts = `// 自動で作るファイル(scripts/gen-avatar-parts.mjs)。元は packages/conformance/avatar/parts.json。手で直さない
import type { AvatarPart } from './avatar'

export const AVATAR_SIZE = ${p.size}
export const AVATAR_BODY: AvatarPart =${part(p.body).slice(1)}
export const AVATAR_SPECIES: AvatarPart[] = ${list(p.species)}
export const AVATAR_FACES: AvatarPart[] = ${list(p.faces)}
export const AVATAR_CLOTHES: AvatarPart[] = ${list(p.clothes)}
`
writeFileSync(out, ts)
