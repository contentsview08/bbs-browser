package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.HonoBbs
import io.github.contentsview08.obb.bbs.Machi
import io.github.contentsview08.obb.bbs.Shitaraba
import io.github.contentsview08.obb.bbs.UrlRoute
import io.github.contentsview08.obb.bbs.isBoardUrl
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard

// この端末で扱える板か。スマホにない掲示板(ふたばなど)は手元に入れず、同期の表にだけ持つ

private val FUTABA = Regex("^https?://([^/]+\\.)?2chan\\.net(/|$)", RegexOption.IGNORE_CASE)

fun resolveSyncBoard(url: String): ResolvedBoard? = when {
    FUTABA.containsMatchIn(url) -> null
    HonoBbs.isBoardUrl(url) -> ResolvedBoard(url, "honobbs")
    Shitaraba.isBoardUrl(url) || Machi.isBoardUrl(url) -> ResolvedBoard(url, "2ch-compat")
    isBoardUrl(url) -> ResolvedBoard(UrlRoute.to5chIo(url), "2ch-compat")
    else -> null
}
