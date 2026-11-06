package io.github.contentsview08.obb.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImageSaverTest {
    private fun ascii(s: String) = s.toByteArray(Charsets.ISO_8859_1)

    @Test fun avif_is_recognized() {
        assertEquals("image/avif", sniffImageType(ascii("\u0000\u0000\u0000\u0020ftypavif\u0000\u0000")))
        assertEquals("image/avif", sniffImageType(ascii("\u0000\u0000\u0000\u0020ftypavis\u0000\u0000")))
    }

    @Test fun known_images_are_recognized() {
        assertEquals("image/jpeg", sniffImageType(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())))
        assertEquals("image/png", sniffImageType(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47)))
        assertEquals("image/gif", sniffImageType(ascii("GIF89a")))
        assertEquals("image/webp", sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBP")))
    }

    @Test fun html_and_other_mp4_are_not_images() {
        assertNull(sniffImageType(ascii("<!DOCTYPE html><html>")))
        assertNull(sniffImageType(ascii("\u0000\u0000\u0000\u0020ftypisom\u0000\u0000")))
        assertNull(sniffImageType(ByteArray(0)))
    }

    @Test fun one_failure_does_not_stop_the_rest() = runBlocking {
        val ok = saveEach(listOf("a", "b", "c")) { if (it == "b") error("だめ") }
        assertEquals(2, ok)
    }

    @Test(expected = CancellationException::class)
    fun cancellation_is_not_counted_as_failure(): Unit = runBlocking {
        val seen = ArrayList<String>()
        try {
            saveEach(listOf("a", "b", "c")) { seen += it; if (it == "b") throw CancellationException("閉じた") }
        } finally {
            assertEquals(listOf("a", "b"), seen)
        }
    }
}
