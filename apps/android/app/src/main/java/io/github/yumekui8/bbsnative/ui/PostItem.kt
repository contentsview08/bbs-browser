package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * レス 1 件。組み立て済み(renderPosts)の頭の行と本文を置くだけ。
 * 頭の行の番号を押すとそのレスへの返信、ID を押すと同じ ID のレス、本文のアンカー・URL も押せる(PostLinks)。
 * 自分の書き込みは左に緑の線と「自分」の札、自分への返信は「→あなた宛」の札(今のスマホ版と同じ)
 */
@Composable
fun PostItem(
    r: RenderedPost, own: Boolean = false, toOwn: Boolean = false,
    images: List<String> = emptyList(), autoLoad: Boolean = true, onImage: (String) -> Unit = {},
) {
    val content = @Composable {
        Column(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
            if (own || toOwn) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(r.header, Modifier.weight(1f, fill = false), fontSize = 12.sp, lineHeight = 17.sp)
                    Spacer(Modifier.width(6.dp))
                    OwnChip(if (own) "自分" else "→あなた宛")
                }
            } else Text(r.header, fontSize = 12.sp, lineHeight = 17.sp)
            Text(r.body, Modifier.padding(top = 4.dp), color = Palette.textBody, fontSize = 15.sp, lineHeight = 22.sp)
        }
        if (images.isNotEmpty()) Thumbnails(images, autoLoad, onImage)
        }
    }
    if (!own) return content()
    Row(Modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(Palette.own))
        content()
    }
}

@Composable
private fun OwnChip(label: String) {
    Text(
        label,
        Modifier.border(1.dp, Palette.own, RoundedCornerShape(6.dp)).background(Palette.ownWash, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
        color = Palette.own, fontSize = 10.sp, lineHeight = 14.sp,
    )
}
