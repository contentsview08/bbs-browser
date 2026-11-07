// 上限と期間はすべて環境変数で変えられる。読めない値は既定に戻す(設定の誤りで制限が外れないように)
import type { LedgerDO } from './ledger'
import type { SpaceDO } from './space'
import { runtime } from './runtime'

export interface Env {
  SPACE: DurableObjectNamespace<SpaceDO>
  LEDGER: DurableObjectNamespace<LedgerDO>
  RL_IP?: RateLimit
  RL_WIDE?: RateLimit
  RL_AUTH?: RateLimit
  RL_CREATE?: RateLimit
  RL_ADMIN?: RateLimit
  RL_TICKET?: RateLimit
  POW_SECRET?: string
  TURNSTILE_SECRET?: string
  ADMIN_KEYS?: string
  [key: string]: unknown
}

export const DAY = 24 * 60 * 60 * 1000
export const HOUR = 60 * 60 * 1000
export const MINUTE = 60 * 1000

export interface Config {
  spaceLimit: number
  evictIdleDays: number
  idleDeleteDays: number
  /** 0 は使わない */
  emptySpaceDays: number
  tombGcDays: number
  quotaBytes: number
  quotaRecords: number
  maxBodyBytes: number
  maxPushRecords: number
  maxCiphertextBytes: number
  pageRecords: number
  pageBytes: number
  /** 409 に入れるレコードの合計。端末の読み取りの上限(2MB)に収める */
  conflictBytes: number
  /** 0 は数えない */
  ratePerMinute: number
  ratePerDay: number
  /** 1 日に受け付けるレコードの数(領域ごと)。0 は数えない */
  recordsPerDay: number
  /** 端末へ「最低これだけ空ける」と指示する秒。0 は指示しない(端末の既定に任せる) */
  paceHeadSec: number
  pacePushSec: number
  fullPullPerHour: number
  sourceLimit: number
  sourceWindowDays: number
  powBits: number
  powTtlSec: number
  turnstileHostname: string
  turnstileAction: string
  turnstileSitekey: string
  /** 公式のテスト用の秘密を受け入れる。検証用の環境だけで立てる */
  turnstileTestKeys: boolean
  /** JSON の { 鍵 ID: Base64URL }。読むのは作成と発行のときだけ */
  ticketKeys: string
  ticketKid: string
  ticketTtlDays: number
  creationClosed: boolean
  readOnly: boolean
  requireHttps: boolean
  allowedHosts: string[]
  adminSkewSec: number
  adminNonceTtlSec: number
  adminMaxBodyBytes: number
  jobBatch: number
  auditDays: number
  evictVerifyMax: number
}

function int(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string' || !/^[0-9]{1,15}$/.test(raw)) return fallback
  return Number(raw)
}

const flag = (raw: unknown, fallback: boolean): boolean => (raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : fallback)
const text = (raw: unknown, fallback: string): string => (typeof raw === 'string' ? raw : fallback)

export function loadConfig(env: Env): Config {
  const e: Record<string, unknown> = runtime.overrides ? { ...env, ...runtime.overrides } : env
  return {
    spaceLimit: int(e.SPACE_LIMIT, 100),
    evictIdleDays: int(e.EVICT_IDLE_DAYS, 14),
    idleDeleteDays: int(e.IDLE_DELETE_DAYS, 90),
    emptySpaceDays: int(e.EMPTY_SPACE_DAYS, 7),
    tombGcDays: int(e.TOMB_GC_DAYS, 90),
    quotaBytes: int(e.QUOTA_BYTES, 10 * 1024 * 1024),
    quotaRecords: int(e.QUOTA_RECORDS, 50_000),
    maxBodyBytes: int(e.MAX_BODY_BYTES, 1024 * 1024),
    maxPushRecords: int(e.MAX_PUSH_RECORDS, 100),
    maxCiphertextBytes: int(e.MAX_CIPHERTEXT_BYTES, 16 * 1024),
    pageRecords: int(e.PAGE_RECORDS, 500),
    pageBytes: int(e.PAGE_BYTES, 1024 * 1024),
    conflictBytes: int(e.CONFLICT_BYTES, 1536 * 1024),
    ratePerMinute: int(e.RATE_PER_MINUTE, 20),
    // 前面で 30 秒ごとの確認と送信。2 台を 11 時間使って最大 2,640 回なので余裕を持たせる
    ratePerDay: int(e.RATE_PER_DAY, 6000),
    // 正規のアプリは 1 日に数百件(送信は 5 分ごと、1 回に既読と閲覧履歴)。1 件が 2 行なので、要求の上限いっぱいに 100 件ずつ送られると 1 領域で Free の 100,000 行を使い切れてしまう
    recordsPerDay: int(e.RECORDS_PER_DAY, 3000),
    paceHeadSec: int(e.PACE_HEAD_SEC, 0),
    pacePushSec: int(e.PACE_PUSH_SEC, 0),
    fullPullPerHour: int(e.FULL_PULL_PER_HOUR, 3),
    sourceLimit: int(e.SOURCE_LIMIT, 5),
    sourceWindowDays: int(e.SOURCE_WINDOW_DAYS, 7),
    powBits: int(e.POW_BITS, 20),
    powTtlSec: int(e.POW_TTL_SEC, 300),
    turnstileHostname: text(e.TURNSTILE_HOSTNAME, ''),
    turnstileAction: text(e.TURNSTILE_ACTION, 'create-space'),
    turnstileSitekey: text(e.TURNSTILE_SITEKEY, ''),
    turnstileTestKeys: flag(e.TURNSTILE_TEST_KEYS, false),
    ticketKeys: text(e.TICKET_KEYS, ''),
    ticketKid: text(e.TICKET_KID, ''),
    ticketTtlDays: int(e.TICKET_TTL_DAYS, 365),
    creationClosed: flag(e.CREATION_CLOSED, false),
    readOnly: flag(e.READ_ONLY, false),
    requireHttps: flag(e.REQUIRE_HTTPS, true),
    allowedHosts: text(e.ALLOWED_HOSTS, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    adminSkewSec: int(e.ADMIN_SKEW_SEC, 60),
    adminNonceTtlSec: int(e.ADMIN_NONCE_TTL_SEC, 300),
    adminMaxBodyBytes: int(e.ADMIN_MAX_BODY_BYTES, 256 * 1024),
    jobBatch: Math.max(1, int(e.JOB_BATCH, 20)),
    auditDays: int(e.AUDIT_DAYS, 365),
    evictVerifyMax: Math.max(1, int(e.EVICT_VERIFY_MAX, 5)),
  }
}
