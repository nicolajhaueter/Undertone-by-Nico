package com.nico.undertone.images

import com.nico.undertone.TestImages
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ImageInspectorTest {

    @Test
    fun `reads PNG and JPEG dimensions`() {
        assertEquals(ImageInfo(ImageFormat.PNG, 40, 30), ImageInspector.inspect(TestImages.png()))
        assertEquals(ImageInfo(ImageFormat.JPEG, 64, 48), ImageInspector.inspect(TestImages.jpeg(64, 48)))
    }

    @Test
    fun `reads all WebP container variants`() {
        for (webp in listOf(TestImages.webpLossy, TestImages.webpLossless, TestImages.webpExtended)) {
            assertEquals(ImageInfo(ImageFormat.WEBP, 12, 7), ImageInspector.inspect(webp))
        }
    }

    @Test
    fun `rejects unknown and truncated data`() {
        assertNull(ImageInspector.inspect("hello".toByteArray()))
        assertNull(ImageInspector.inspect(TestImages.png().copyOf(12)))
        assertNull(ImageInspector.inspect(TestImages.webpLossy.copyOf(20)))
        assertNull(ImageInspector.inspect(ByteArray(0)))
    }
}
