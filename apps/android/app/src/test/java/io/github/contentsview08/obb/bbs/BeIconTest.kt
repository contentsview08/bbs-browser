package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Test

class BeIconTest {
    @Test fun 五chのアイコンはhttpsにして本文から除く() {
        assertEquals("https://img.5ch.io/ico/nida.gif" to "本文です", splitBeIcon("sssp://img.5ch.io/ico/nida.gif\n本文です"))
    }

    @Test fun ほかのホストは読みに行かず本文のまま() {
        for (line in listOf(
            "sssp://example.com/x.gif",
            "sssp://192.168.1.1/x.gif",
            "sssp://evil5ch.io/x.gif",
            "sssp://img.5ch.io.example.com/x.gif",
            "sssp://img.5ch.io@example.com/x.gif",
            "sssp://img.5ch.io:8080/x.gif",
        )) {
            val body = "$line\n本文"
            assertEquals(null to body, splitBeIcon(body))
        }
    }
}
