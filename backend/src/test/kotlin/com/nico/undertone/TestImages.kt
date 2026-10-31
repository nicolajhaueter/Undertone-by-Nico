package com.nico.undertone

import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import javax.imageio.ImageIO

object TestImages {

    /** A PNG whose pixels (and therefore hash) differ for every seed. */
    fun png(width: Int = 40, height: Int = 30, seed: Int = 0): ByteArray = encode("png", width, height, seed, BufferedImage.TYPE_INT_ARGB)

    fun jpeg(width: Int = 40, height: Int = 30, seed: Int = 0): ByteArray = encode("jpg", width, height, seed, BufferedImage.TYPE_INT_RGB)

    // 12 x 7 WebP files in each container variant, generated with libwebp.
    val webpLossy: ByteArray = decode("UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoMAAcAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA")
    val webpLossless: ByteArray = decode("UklGRh4AAABXRUJQVlA4TBEAAAAvC4ABEAdQiirUo4CBiOh/AAA=")
    val webpExtended: ByteArray = decode("UklGRlIAAABXRUJQVlA4WAoAAAAQAAAACwAABgAAQUxQSAoAAAABB1DAiAhERP8DVlA4ICIAAABwAQCdASoMAAcAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA")

    private fun encode(format: String, width: Int, height: Int, seed: Int, type: Int): ByteArray {
        val image = BufferedImage(width, height, type)
        image.createGraphics().run {
            color = Color(seed * 37 % 256, seed * 91 % 256, 128)
            fillRect(0, 0, width, height)
            dispose()
        }
        return ByteArrayOutputStream().also { ImageIO.write(image, format, it) }.toByteArray()
    }

    private fun decode(base64: String) = Base64.getDecoder().decode(base64)
}
