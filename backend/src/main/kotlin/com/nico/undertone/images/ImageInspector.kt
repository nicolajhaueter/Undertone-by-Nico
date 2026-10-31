package com.nico.undertone.images

import java.io.ByteArrayInputStream
import javax.imageio.ImageIO

enum class ImageFormat(val contentType: String, val extension: String) {
    PNG("image/png", "png"),
    JPEG("image/jpeg", "jpg"),
    WEBP("image/webp", "webp"),
}

data class ImageInfo(val format: ImageFormat, val width: Int, val height: Int)

/**
 * Identifies an upload by its bytes rather than the declared Content-Type and
 * reads its dimensions from the header, without decoding the whole image.
 */
object ImageInspector {

    fun inspect(bytes: ByteArray): ImageInfo? = when {
        bytes.startsWith(PNG_SIGNATURE) -> png(bytes)
        bytes.size > 3 && bytes.u(0) == 0xFF && bytes.u(1) == 0xD8 && bytes.u(2) == 0xFF -> jpeg(bytes)
        bytes.size > 30 && bytes.ascii(0, 4) == "RIFF" && bytes.ascii(8, 4) == "WEBP" -> webp(bytes)
        else -> null
    }

    private fun png(b: ByteArray): ImageInfo? {
        if (b.size < 24 || b.ascii(12, 4) != "IHDR") return null
        return ImageInfo(ImageFormat.PNG, b.int32be(16), b.int32be(20))
    }

    private fun jpeg(b: ByteArray): ImageInfo? = runCatching {
        ImageIO.createImageInputStream(ByteArrayInputStream(b)).use { input ->
            val reader = ImageIO.getImageReaders(input).asSequence().firstOrNull() ?: return null
            try {
                reader.input = input
                ImageInfo(ImageFormat.JPEG, reader.getWidth(0), reader.getHeight(0))
            } finally {
                reader.dispose()
            }
        }
    }.getOrNull()

    private fun webp(b: ByteArray): ImageInfo? {
        val (width, height) = when (b.ascii(12, 4)) {
            // Lossy: 14-bit dimensions after the 9d 01 2a start code.
            "VP8 " -> {
                if (b.u(23) != 0x9D || b.u(24) != 0x01 || b.u(25) != 0x2A) return null
                (b.int16le(26) and 0x3FFF) to (b.int16le(28) and 0x3FFF)
            }
            // Lossless: 14-bit (value - 1) fields packed after the 0x2f signature.
            "VP8L" -> {
                if (b.u(20) != 0x2F) return null
                val bits = b.u(21) or (b.u(22) shl 8) or (b.u(23) shl 16) or (b.u(24) shl 24)
                ((bits and 0x3FFF) + 1) to (((bits shr 14) and 0x3FFF) + 1)
            }
            // Extended (alpha, animation): 24-bit (value - 1) canvas size.
            "VP8X" -> (b.int24le(24) + 1) to (b.int24le(27) + 1)
            else -> return null
        }
        return ImageInfo(ImageFormat.WEBP, width, height)
    }

    private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    private fun ByteArray.startsWith(prefix: ByteArray) =
        size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private fun ByteArray.u(index: Int) = this[index].toInt() and 0xFF
    private fun ByteArray.ascii(offset: Int, length: Int) = String(this, offset, length, Charsets.US_ASCII)
    private fun ByteArray.int16le(offset: Int) = u(offset) or (u(offset + 1) shl 8)
    private fun ByteArray.int24le(offset: Int) = u(offset) or (u(offset + 1) shl 8) or (u(offset + 2) shl 16)
    private fun ByteArray.int32be(offset: Int) =
        (u(offset) shl 24) or (u(offset + 1) shl 16) or (u(offset + 2) shl 8) or u(offset + 3)
}
