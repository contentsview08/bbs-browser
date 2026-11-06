// 復号後の値の検査。AEAD を通っても、乗っ取られた端末が書いた値かもしれないので、型と長さを確かめる
import { DEVICE_ID_RE, isHlc, parseHlc } from './hlc'
import { isOrderKey, type SyncPayload } from './merge'

type Rule =
  | { t: 'str'; max: number; min?: number; req?: boolean; nullable?: boolean }
  | { t: 'url'; req?: boolean }
  | { t: 'int'; req?: boolean }
  | { t: 'bool'; req?: boolean }
  | { t: 'order'; req?: boolean }
  | { t: 'scalar'; req?: boolean }
  | { t: 'steps'; req?: boolean }

const STR = (max: number, req = false): Rule => ({ t: 'str', max, req })
const URL_MAX = 2048
const MAX_STEPS_ACCEPTED = 64
const SCALAR_MAX = 4096
const TITLE_MAX = 1024
const NAME_MAX = 256
const THREAD_MAX = 256
const ID_MAX = 64
const NG_ID_MAX = 128
const NOTE_MAX = 1024
const DATE_MAX = 10
export const POST_BODY_MAX = 4096
// 板ごとの設定は名前に板 URL を含む
const SETTING_KEY_MAX = 128 + URL_MAX

const BOARD: Rule = { t: 'url', req: true }
const THREAD: Rule = { t: 'str', max: THREAD_MAX, min: 1, req: true }
const INT: Rule = { t: 'int' }
const BOOL: Rule = { t: 'bool' }

const SCHEMAS: Record<string, Record<string, Rule>> = {
  read_reset: { board_url: BOARD, thread: THREAD, id: STR(ID_MAX, true), target_res: { t: 'int', req: true } },
  read_dev: { board_url: BOARD, thread: THREAD, base_reset_id: { t: 'str', max: ID_MAX, nullable: true }, pos: { t: 'int', req: true }, steps: { t: 'steps', req: true } },
  last_view: { board_url: BOARD, thread: THREAD, title: STR(TITLE_MAX), board_name: STR(NAME_MAX), created_at: INT, last_viewed_at: { t: 'int', req: true } },
  favorite: { board_url: BOARD, thread: STR(THREAD_MAX), title: STR(TITLE_MAX), board_name: STR(NAME_MAX), created_at: INT },
  order: { board_url: BOARD, thread: STR(THREAD_MAX), key: { t: 'order', req: true } },
  post: { post_id: { t: 'str', max: ID_MAX, min: 1, req: true }, board_url: BOARD, thread: THREAD, title: STR(TITLE_MAX), no: INT, body: STR(POST_BODY_MAX, true), posted_at: { t: 'int', req: true } },
  image: { url: { t: 'url', req: true }, file_name: STR(TITLE_MAX), size: INT, uploaded_at: INT },
  ng: {
    id: { t: 'str', max: NG_ID_MAX, min: 1, req: true },
    type: STR(ID_MAX, true),
    value: STR(SCALAR_MAX, true),
    is_regex: BOOL,
    enabled: BOOL,
    expires_on: STR(DATE_MAX),
    board_url: { t: 'url' },
    board_name: STR(NAME_MAX),
    note: STR(NOTE_MAX),
    created_at: INT,
  },
  setting: { key: STR(SETTING_KEY_MAX, true), value: { t: 'scalar', req: true } },
  site: { menu_url: { t: 'url', req: true }, name: STR(NAME_MAX) },
  secret: { url: { t: 'url', req: true }, value: STR(SCALAR_MAX, true) },
}

const MAX_INT = Number.MAX_SAFE_INTEGER
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_INT
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// http と https だけを通す。javascript: などはここで落ちる。表示の前の safeUrl は別にかける
// eslint-disable-next-line no-control-regex
const isSafeHttpUrl = (v: unknown) => typeof v === 'string' && v.length <= URL_MAX && /^https?:\/\/[^\x00-\x20\x7f]+$/i.test(v)

/** 数は整数だけにする(小数の書き方は言語で違い、並べた JSON が PC とスマホで変わる) */
function onlySafeNumbers(v: unknown): boolean {
  if (typeof v === 'number') return Number.isSafeInteger(v)
  if (Array.isArray(v)) return v.every(onlySafeNumbers)
  if (isPlainObject(v)) return Object.values(v).every(onlySafeNumbers)
  return true
}

function checkRule(rule: Rule, v: unknown): boolean {
  switch (rule.t) {
    case 'str':
      return (rule.nullable === true && v === null) || (typeof v === 'string' && v.length <= rule.max && v.length >= (rule.min ?? 0))
    case 'url':
      return isSafeHttpUrl(v)
    case 'int':
      return isIndex(v)
    case 'bool':
      return typeof v === 'boolean'
    case 'order':
      return isOrderKey(v)
    case 'scalar':
      return typeof v === 'boolean' || isIndex(v) || (typeof v === 'string' && v.length <= SCALAR_MAX)
    case 'steps':
      return Array.isArray(v) && v.length <= MAX_STEPS_ACCEPTED && v.every((s) => isPlainObject(s) && isHlc(s.at) && isIndex(s.pos))
  }
}

/** 正しければ payload を型付きで返し、違えば null。知らない種類とフィールドは、型の決まりの外なので通して持ち続ける */
export function checkPayload(v: unknown): SyncPayload | null {
  if (!isPlainObject(v) || !onlySafeNumbers(v)) return null
  const { kind, hlc, device_id: device, deleted, trim, body } = v
  if (typeof kind !== 'string' || !/^[a-z_]{1,32}$/.test(kind)) return null
  if (typeof device !== 'string' || !DEVICE_ID_RE.test(device) || !isHlc(hlc) || parseHlc(hlc).device !== device) return null
  if (deleted !== undefined && typeof deleted !== 'boolean') return null
  if (trim !== undefined && (trim !== true || deleted !== true)) return null
  if (body !== undefined && !isPlainObject(body)) return null
  const schema = Object.hasOwn(SCHEMAS, kind) ? SCHEMAS[kind] : undefined
  if (schema) {
    if (body === undefined && deleted !== true) return null
    for (const [name, rule] of Object.entries(schema)) {
      const has = body !== undefined && Object.hasOwn(body, name)
      if (has ? !checkRule(rule, body[name]) : rule.req === true && deleted !== true) return null
    }
  }
  return v as SyncPayload
}
