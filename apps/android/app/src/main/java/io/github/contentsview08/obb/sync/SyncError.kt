package io.github.contentsview08.obb.sync

/** 文は決まった符号だけ。鍵・トークン・平文が例外の文からログへ流れないようにする */
class SyncError(val code: String) : Exception(code)
