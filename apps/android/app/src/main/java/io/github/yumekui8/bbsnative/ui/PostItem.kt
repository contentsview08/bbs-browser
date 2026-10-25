package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * レス 1 件。組み立て済み(renderPosts)の頭の行と本文を置くだけ。
 * 頭の行の番号を押すとそのレスへの返信、ID を押すと同じ ID のレス、本文のアンカー・URL も押せる(PostLinks)
 */
@Composable
fun PostItem(r: RenderedPost) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Text(r.header, fontSize = 12.sp, lineHeight = 17.sp)
        Text(r.body, Modifier.padding(top = 4.dp), color = Palette.textBody, fontSize = 15.sp, lineHeight = 22.sp)
    }
}
