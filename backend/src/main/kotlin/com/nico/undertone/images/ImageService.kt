package com.nico.undertone.images

import org.springframework.beans.factory.annotation.Value
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.HexFormat
import java.util.UUID

/**
 * Stores image files content-addressed on disk (file name = SHA-256 of the
 * bytes), so identical uploads share one file and one database row.
 *
 * The browser downscales and converts to WebP before uploading; the server
 * only validates, deduplicates and stores what it receives.
 */
@Service
class ImageService(
    private val images: ImageRepository,
    @Value("\${undertone.images.dir}") imagesDir: String,
) {
    val directory: Path = Path.of(imagesDir).toAbsolutePath().normalize().also { Files.createDirectories(it) }

    data class StoreResult(val image: ImageRecord, val created: Boolean)

    fun store(bytes: ByteArray): StoreResult {
        if (bytes.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The image is empty.")
        if (bytes.size > MAX_BYTES) throw ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "Images must be 20 MB or smaller.")

        val info = ImageInspector.inspect(bytes)
            ?: throw ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG or WebP image.")
        if (info.width !in 1..MAX_DIMENSION || info.height !in 1..MAX_DIMENSION) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Image dimensions must be between 1 and $MAX_DIMENSION pixels.")
        }

        val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
        images.findByHash(hash)?.let { return StoreResult(it, created = false) }

        val fileName = "$hash.${info.format.extension}"
        writeAtomically(directory.resolve(fileName), bytes)

        val record = ImageRecord(
            id = UUID.randomUUID(),
            hash = hash,
            fileName = fileName,
            contentType = info.format.contentType,
            width = info.width,
            height = info.height,
            sizeBytes = bytes.size.toLong(),
        )
        return try {
            images.insert(record)
            StoreResult(record, created = true)
        } catch (e: DuplicateKeyException) {
            // A concurrent upload of the same bytes won; the file is identical.
            StoreResult(images.findByHash(hash)!!, created = false)
        }
    }

    fun find(id: UUID): ImageRecord? = images.findById(id)

    fun fileOf(image: ImageRecord): Path = directory.resolve(image.fileName)

    private fun writeAtomically(target: Path, bytes: ByteArray) {
        if (Files.exists(target)) return
        val temp = Files.createTempFile(directory, ".upload-", ".tmp")
        try {
            Files.write(temp, bytes)
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    companion object {
        const val MAX_BYTES = 20 * 1024 * 1024
        const val MAX_DIMENSION = 10_000
    }
}
