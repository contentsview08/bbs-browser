export type SyncErrorCode =
  | 'bad_encoding'
  | 'bad_utf8'
  | 'bad_json'
  | 'bad_key'
  | 'bad_aad'
  | 'bad_nonce'
  | 'bad_length'
  | 'too_large'
  | 'bad_padding'
  | 'decrypt_failed'
  | 'bad_hlc'
  | 'bad_order_key'
  | 'bad_id'

/** 文は決まった符号だけ。鍵・トークン・平文が例外の文からログへ流れないようにする */
export class SyncError extends Error {
  readonly code: SyncErrorCode
  constructor(code: SyncErrorCode) {
    super(code)
    this.name = 'SyncError'
    this.code = code
  }
}
